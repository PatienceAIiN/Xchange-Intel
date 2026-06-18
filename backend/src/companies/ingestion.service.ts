import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { CompaniesService } from './companies.service';
import { StartupIndiaProvider } from '../search/providers/startupindia.provider';

const INTERVAL_MS = 12 * 60 * 1000; // ingest new startups every 12 minutes
const ENRICH_INTERVAL_MS = 90 * 1000; // pre-enrich existing companies every 90s
const PAGE_SIZE = 20;
const ENRICH_BATCH = 3; // companies enriched per background pass

/**
 * Auto-ingests recently-registered startups from Startup India every ~12 minutes,
 * seeding genuine records (name, DPIIT no., stage, sector, location) into Postgres.
 * On-demand enrichment (MCA / website / contacts) happens when a user opens a profile.
 */
@Injectable()
export class IngestionService implements OnModuleInit {
  private readonly log = new Logger('Ingestion');
  private page = 0;
  private running = false;

  private enriching = false;

  stats = {
    lastRunAt: null as string | null,
    addedLastRun: 0,
    totalAdded: 0,
    runs: 0,
    page: 0,
    enrichedTotal: 0,
    pendingEnrichment: 0,
    intervalMinutes: INTERVAL_MS / 60000,
    source: 'https://www.startupindia.gov.in/content/sih/en/search.html?roles=Startup',
  };

  constructor(
    private companies: CompaniesService,
    private startupIndia: StartupIndiaProvider,
  ) {}

  onModuleInit() {
    // first run shortly after boot so counts move quickly (non-blocking)
    setTimeout(() => this.runIngest().catch(() => {}), 20000);
  }

  // NOTE: the 12-min trickle ingest and 90s full-aggregate enrich are DISABLED — they
  // hammered the MCA key (429) and produced AI-only rows. Bulk import + ContactFillService
  // (contacts-only, authentic) now own ingestion & enrichment. Kept for manual use only.
  async scheduled() {
    await this.runIngest().catch((e) => this.log.warn(`ingest run failed: ${e}`));
  }

  async scheduledEnrich() {
    if (this.enriching) return;
    this.enriching = true;
    try {
      const done = await this.companies.enrichBatch(ENRICH_BATCH);
      if (done) {
        this.stats.enrichedTotal += done;
        this.log.log(`Background enrichment: ${done} companies enriched`);
      }
    } catch (e) {
      this.log.warn(`enrich pass failed: ${e}`);
    } finally {
      this.enriching = false;
    }
  }

  async runIngest() {
    if (this.running) return;
    this.running = true;
    try {
      let records = await this.startupIndia.listPage(this.page, PAGE_SIZE);
      if (!records.length) {
        this.page = 0; // wrap around to newest
        records = await this.startupIndia.listPage(this.page, PAGE_SIZE);
      }
      const { added, skipped } = await this.companies.seedFromStartupIndia(records);
      this.page += 1;
      this.stats = {
        ...this.stats,
        lastRunAt: new Date().toISOString(),
        addedLastRun: added,
        totalAdded: this.stats.totalAdded + added,
        runs: this.stats.runs + 1,
        page: this.page,
      };
      this.log.log(`Ingest run #${this.stats.runs}: +${added} new, ${skipped} existing (page ${this.page})`);
    } finally {
      this.running = false;
    }
  }

  async getStats() {
    const [totalCompanies, pending] = await Promise.all([
      this.companies.countCompanies(),
      this.companies.countUnenriched().catch(() => 0),
    ]);
    return { ...this.stats, totalCompanies, pendingEnrichment: pending };
  }
}
