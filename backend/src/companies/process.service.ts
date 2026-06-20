import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { McaImportService } from './mca-import.service';
import { StartupImportService } from './startup-import.service';
import { IngestionService } from './ingestion.service';
import { ContactFillService } from './contact-fill.service';
import { BackupService } from './backup.service';
import { CompaniesService } from './companies.service';
import { EmailService } from '../common/email.service';

const COMPLETION_EMAIL = process.env.COMPLETION_EMAIL || 'harsh@patienceai.in';
const MCA_TARGET = parseInt(process.env.MCA_IMPORT_TARGET || '300000', 10); // 3 lakh
const SI_TARGET = parseInt(process.env.SI_IMPORT_TARGET || '454000', 10);
const SITE = process.env.SITE_URL || '';

@Injectable()
export class ProcessService implements OnModuleInit {
  private readonly log = new Logger('Process');
  phases = { mcaDone: false, startupDone: false, contactsDone: false, orchestrating: false };

  constructor(
    private mca: McaImportService,
    private startupImport: StartupImportService,
    private ingestion: IngestionService,
    private contactFill: ContactFillService,
    private backup: BackupService,
    private companies: CompaniesService,
    private email: EmailService,
  ) {}

  onModuleInit() {
    if (process.env.AUTO_PROCESS === 'true') {
      this.log.log('AUTO_PROCESS enabled — orchestrating pipeline after boot');
      setTimeout(() => this.orchestrate().catch((e) => this.fail('pipeline', e)), 30000);
    }
  }

  private async fail(phase: string, e: any) {
    const cause = e?.message || String(e);
    this.log.error(`PHASE FAILED [${phase}]: ${cause}`);
    await this.email.send(
      COMPLETION_EMAIL,
      `⚠️ Xchange Intel — ${phase} FAILED`,
      `<h2>Pipeline failure: ${phase}</h2><p><b>Cause:</b></p><pre>${cause}</pre>
       <p>Other phases continue where possible. Check <a href="${SITE}/process">/process</a> logs.</p>`,
    ).catch(() => {});
  }

  private async done(phase: string, summaryHtml: string) {
    await this.email.send(COMPLETION_EMAIL, `✅ Xchange Intel — ${phase} complete`, summaryHtml).catch(() => {});
  }

  /**
   * Launches every phase INDEPENDENTLY (fire-and-forget) so a stalled/blocked phase never
   * holds up the others. Contact filling + backup run continuously regardless of the
   * imports. Each phase self-heals, emails on completion, and emails the cause on failure.
   */
  async orchestrate() {
    if (this.phases.orchestrating) return;
    this.phases.orchestrating = true;

    // MCA bulk import — keep pulling toward target, resuming after rate-limit pauses.
    (async () => {
      for (let i = 0; i < 500; i++) {
        const cov = await this.companies.coverage().catch(() => null);
        if (cov && cov.mca >= MCA_TARGET) {
          this.phases.mcaDone = true;
          await this.done('MCA import', `<p><b>${cov.mca.toLocaleString()}</b> MCA companies in database (target reached).</p>`);
          break;
        }
        try { await this.mca.run(MCA_TARGET); } catch (e) { await this.fail('MCA import', e); }
        const s = this.mca.getStats();
        if (s.blocked) { await new Promise((r) => setTimeout(r, 300000)); continue; } // 429 → retry in 5m
        if (s.added === 0) { // run finished with nothing new → dataset exhausted at this offset
          this.phases.mcaDone = true;
          await this.done('MCA import', `<p>MCA import reached the end of available new records.</p>`);
          break;
        }
        await new Promise((r) => setTimeout(r, 30000)); // brief pause, then continue pulling
      }
    })();

    // Startup India bulk import (independent — never blocks contacts)
    (async () => {
      try {
        await this.startupImport.run(SI_TARGET);
        this.phases.startupDone = true;
        await this.done('Startup India import', `<p>Imported <b>${this.startupImport.getStats().added.toLocaleString()}</b> startups.</p>`);
      } catch (e) { await this.fail('Startup India import', e); }
    })();

    // Contact filling — starts NOW, runs continuously as companies arrive
    (async () => {
      try {
        await this.contactFill.run();
        this.phases.contactsDone = true;
        const cs = this.contactFill.getStats();
        await this.done('Contact filling', `<p>Processed <b>${cs.processed.toLocaleString()}</b>; <b>${cs.withContacts.toLocaleString()}</b> with verified contacts.</p>`);
      } catch (e) { await this.fail('Contact filling', e); }
    })();

    // Backup replication — periodic loop of completed/authentic rows
    (async () => {
      try {
        for (let i = 0; i < 200; i++) {
          await this.backup.run();
          await new Promise((r) => setTimeout(r, 900000)); // re-replicate every 15 min (lighter on DB)
        }
      } catch (e) { await this.fail('Backup replication', e); }
    })();

    this.phases.orchestrating = false;
  }

  private covCache: { at: number; data: any } = { at: 0, data: null };

  async getStatus() {
    // cache the 5 COUNT queries for 20s to spare Neon free-tier transfer under 3-5s polling
    if (!this.covCache.data || Date.now() - this.covCache.at > 20000) {
      this.covCache = { at: Date.now(), data: await this.companies.coverage() };
    }
    const coverage = this.covCache.data;
    const mca = this.mca.getStats(), si = this.startupImport.getStats(), fill = this.contactFill.getStats();
    return {
      connected: true,
      totalCompanies: coverage.total,
      coverage,
      phases: {
        mca: { ...mca, done: this.phases.mcaDone || coverage.mca >= MCA_TARGET },
        startupIndia: { ...si, ingestion: this.ingestion.stats, done: this.phases.startupDone },
        contacts: { ...fill, done: this.phases.contactsDone },
        backup: { ...this.backup.getStats() },
      },
    };
  }
}
