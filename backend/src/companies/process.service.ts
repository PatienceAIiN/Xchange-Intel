import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { McaImportService } from './mca-import.service';
import { IngestionService } from './ingestion.service';
import { ContactFillService } from './contact-fill.service';
import { CompaniesService } from './companies.service';
import { EmailService } from '../common/email.service';

const COMPLETION_EMAIL = process.env.COMPLETION_EMAIL || 'harsh@patienceai.in';
const MCA_TARGET = parseInt(process.env.MCA_IMPORT_TARGET || '50000', 10);

/**
 * Orchestrates the end-to-end pipeline on the server (so it runs on Render, not the
 * user's machine): MCA import → contact fill, emailing on each completion, and exposing
 * a live status for the /process page.
 */
@Injectable()
export class ProcessService implements OnModuleInit {
  private readonly log = new Logger('Process');
  phases = { mcaDone: false, contactsDone: false, orchestrating: false };

  constructor(
    private mca: McaImportService,
    private ingestion: IngestionService,
    private contactFill: ContactFillService,
    private companies: CompaniesService,
    private email: EmailService,
  ) {}

  onModuleInit() {
    if (process.env.AUTO_PROCESS === 'true') {
      this.log.log('AUTO_PROCESS enabled — orchestrating pipeline after boot');
      setTimeout(() => this.orchestrate().catch((e) => this.log.warn(`orchestrate failed: ${e}`)), 30000);
    }
  }

  /** Run MCA import to target, email, then run contact fill, email. Idempotent-ish. */
  async orchestrate() {
    if (this.phases.orchestrating) return;
    this.phases.orchestrating = true;
    try {
      // Phase 1 — MCA bulk import
      if (!this.phases.mcaDone) {
        await this.mca.run(MCA_TARGET);
        const s = this.mca.getStats();
        if (!s.blocked) {
          this.phases.mcaDone = true;
          const total = await this.companies.countCompanies();
          await this.email.send(
            COMPLETION_EMAIL,
            '✅ MCA data import complete — Nexus Exchange',
            `<h2>MCA Company Master Data import complete</h2>
             <p>Imported <b>${s.added.toLocaleString()}</b> companies. Total in database: <b>${total.toLocaleString()}</b>.</p>
             <p>Contact-filling has now started. Watch live at <a href="${process.env.SITE_URL || ''}/process">/process</a>.</p>`,
          );
        }
      }
      // Phase 2 — contact filling
      await this.contactFill.run();
      const cs = this.contactFill.getStats();
      this.phases.contactsDone = true;
      await this.email.send(
        COMPLETION_EMAIL,
        '✅ Contact filling complete — Nexus Exchange',
        `<h2>Contact enrichment complete</h2>
         <p>Processed <b>${cs.processed.toLocaleString()}</b> companies; <b>${cs.withContacts.toLocaleString()}</b> now have verified contacts.</p>
         <p>Export the full dataset in your CSV format from the dashboard.</p>`,
      );
    } finally {
      this.phases.orchestrating = false;
    }
  }

  async getStatus() {
    const total = await this.companies.countCompanies();
    const mca = this.mca.getStats();
    const fill = this.contactFill.getStats();
    return {
      connected: true,
      totalCompanies: total,
      phases: {
        mca: { ...mca, done: this.phases.mcaDone || (!mca.running && mca.added > 0) },
        startupIndia: this.ingestion.stats, // continuous background ingestion
        contacts: { ...fill, done: this.phases.contactsDone },
      },
    };
  }
}
