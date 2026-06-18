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

  /** MCA import + Startup India import (parallel) -> contact fill. Each phase emails on
   *  completion; any failure emails the cause and the pipeline continues where possible. */
  async orchestrate() {
    if (this.phases.orchestrating) return;
    this.phases.orchestrating = true;
    try {
      // Phase 1 (parallel): MCA bulk import + Startup India bulk import
      await Promise.all([
        (async () => {
          try {
            await this.mca.run(MCA_TARGET);
            const s = this.mca.getStats();
            if (s.blocked) { await this.fail('MCA import', new Error('data.gov key unauthorised/rate-limited')); return; }
            this.phases.mcaDone = true;
            const total = await this.companies.countCompanies();
            await this.done('MCA import',
              `<p>Imported <b>${s.added.toLocaleString()}</b> MCA companies. Total: <b>${total.toLocaleString()}</b>.</p>`);
          } catch (e) { await this.fail('MCA import', e); }
        })(),
        (async () => {
          try {
            await this.startupImport.run(SI_TARGET);
            const s = this.startupImport.getStats();
            this.phases.startupDone = true;
            await this.done('Startup India import',
              `<p>Imported <b>${s.added.toLocaleString()}</b> DPIIT-recognised startups.</p>`);
          } catch (e) { await this.fail('Startup India import', e); }
        })(),
      ]);

      // Phase 2: contact filling (after identities are in)
      try {
        await this.contactFill.run();
        const cs = this.contactFill.getStats();
        this.phases.contactsDone = true;
        await this.done('Contact filling',
          `<p>Processed <b>${cs.processed.toLocaleString()}</b>; <b>${cs.withContacts.toLocaleString()}</b> with verified contacts.</p>`);
      } catch (e) { await this.fail('Contact filling', e); }

      // Phase 3: backup completed/authentic data to the backup DB
      try {
        await this.backup.run();
        const bs = this.backup.getStats();
        await this.done('Backup replication', `<p>Replicated <b>${bs.copied.toLocaleString()}</b> completed companies to the backup database.</p>`);
      } catch (e) { await this.fail('Backup replication', e); }
    } finally {
      this.phases.orchestrating = false;
    }
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
        mca: { ...mca, done: this.phases.mcaDone || (!mca.running && mca.added > 0 && !mca.blocked) },
        startupIndia: { ...si, ingestion: this.ingestion.stats, done: this.phases.startupDone || (!si.running && si.added > 0) },
        contacts: { ...fill, done: this.phases.contactsDone },
        backup: { ...this.backup.getStats() },
      },
    };
  }
}
