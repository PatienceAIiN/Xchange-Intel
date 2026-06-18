import { Injectable, Logger } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { StartupIndiaProvider } from '../search/providers/startupindia.provider';

const PAGE = 50;

/**
 * Bulk-imports ALL DPIIT-recognised startups from the Startup India directory
 * (≈454k) into our schema, deduped by name. Authentic — genuine SI records only.
 * Logs real-time ETA. This is the proper "pull all startups" job (vs the slow trickle).
 */
@Injectable()
export class StartupImportService {
  private readonly log = new Logger('StartupImport');
  private running = false;

  stats = {
    running: false, target: 0, added: 0, skipped: 0, processed: 0, page: 0,
    ratePerSec: 0, etaSeconds: null as number | null, blocked: false,
    startedAt: null as string | null, finishedAt: null as string | null,
  };

  constructor(
    private companies: CompaniesService,
    private startupIndia: StartupIndiaProvider,
  ) {}

  async run(target = 454000): Promise<void> {
    if (this.running) { this.log.warn('Startup import already running'); return; }
    this.running = true;
    const t0 = Date.now();
    this.stats = {
      running: true, target, added: 0, skipped: 0, processed: 0, page: 0,
      ratePerSec: 0, etaSeconds: null, blocked: false,
      startedAt: new Date().toISOString(), finishedAt: null,
    };
    this.log.log(`Startup India bulk import started — target ${target.toLocaleString()}`);
    const seen = await this.companies.loadSlugSet();
    let page = 0, emptyStreak = 0;
    try {
      while (this.stats.added < target) {
        const records = await this.startupIndia.listPage(page, PAGE);
        if (!records.length) {
          if (++emptyStreak >= 6) { this.log.log('Startup India: end of directory.'); break; }
          page++;
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        emptyStreak = 0;
        const { added, skipped } = await this.companies.seedFromStartupIndia(records, seen);
        page++;
        this.stats.added += added;
        this.stats.skipped += skipped;
        this.stats.processed += records.length;
        this.stats.page = page;
        const el = (Date.now() - t0) / 1000;
        const rate = this.stats.added / Math.max(el, 1);
        this.stats.ratePerSec = +rate.toFixed(1);
        this.stats.etaSeconds = rate > 0 ? Math.round((target - this.stats.added) / rate) : null;
        if (page % 10 === 0) {
          const eta = this.stats.etaSeconds;
          this.log.log(`Startup India: ${this.stats.added.toLocaleString()} new · ${rate.toFixed(1)}/s · ETA ${eta && eta > 3600 ? (eta / 3600).toFixed(1) + 'h' : Math.round((eta || 0) / 60) + 'm'} · page ${page}`);
        }
      }
    } finally {
      this.stats.running = false;
      this.stats.finishedAt = new Date().toISOString();
      this.running = false;
      this.log.log(`Startup India import finished — +${this.stats.added.toLocaleString()} new`);
    }
  }

  getStats() { return this.stats; }
}
