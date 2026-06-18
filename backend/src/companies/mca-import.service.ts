import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CompaniesService } from './companies.service';
import { McaProvider } from '../search/providers/mca.provider';
import { ProcessState } from './process-state.entity';

const PAGE = 100; // data.gov page size

/**
 * Bulk-imports companies from the MCA Company Master Data (data.gov) into our schema.
 * Authentic only — genuine MCA records, no fabricated fields. Logs real-time ETA to the
 * terminal. Stops cleanly if the data.gov key is unauthorised / rate-limited.
 */
@Injectable()
export class McaImportService {
  private readonly log = new Logger('McaImport');
  private running = false;

  stats = {
    running: false,
    target: 0,
    added: 0,
    skipped: 0,
    processed: 0,
    offset: 0,
    etaSeconds: null as number | null,
    ratePerSec: 0,
    blocked: false,
    startedAt: null as string | null,
    finishedAt: null as string | null,
  };

  constructor(
    private companies: CompaniesService,
    private mca: McaProvider,
    @InjectRepository(ProcessState) private state: Repository<ProcessState>,
  ) {}

  private async loadOffset(): Promise<number> {
    const s = await this.state.findOne({ where: { key: 'mca_offset' } }).catch(() => null);
    return s?.value?.offset || 0;
  }
  private async saveOffset(offset: number) {
    await this.state.save({ key: 'mca_offset', value: { offset } }).catch(() => {});
  }

  async run(target = 50000, startOffset?: number): Promise<void> {
    if (this.running) {
      this.log.warn('MCA import already running');
      return;
    }
    this.running = true;
    // resume from the saved offset so a redeploy continues instead of re-scanning dupes
    if (startOffset == null) startOffset = await this.loadOffset();
    const t0 = Date.now();
    this.stats = {
      running: true, target, added: 0, skipped: 0, processed: 0, offset: startOffset,
      etaSeconds: null, ratePerSec: 0, blocked: false,
      startedAt: new Date().toISOString(), finishedAt: null,
    };
    this.log.log(`MCA bulk import started — target ${target.toLocaleString()} companies`);

    let offset = startOffset;
    let emptyStreak = 0;
    try {
      while (this.stats.added < target) {
        const { records, blocked, error } = await this.mca.listPage(offset, PAGE);
        if (blocked) {
          this.stats.blocked = true;
          this.log.warn('Import paused — data.gov key unauthorised/rate-limited. Resume when it resets.');
          break;
        }
        if (!records.length) {
          // transient error OR true end — skip ahead and only give up after many empties
          emptyStreak++;
          if (emptyStreak >= 8) { this.log.log('Reached end of dataset (or persistent gap).'); break; }
          offset += PAGE;
          this.stats.offset = offset;
          if (!error) await new Promise((r) => setTimeout(r, 300));
          continue;
        }
        emptyStreak = 0;
        const { added, skipped } = await this.companies.seedFromMca(records);
        offset += records.length;
        this.stats.added += added;
        this.stats.skipped += skipped;
        this.stats.processed += records.length;
        this.stats.offset = offset;
        if (this.stats.processed % 1000 < PAGE) await this.saveOffset(offset); // checkpoint for resume

        // real-time ETA
        const elapsed = (Date.now() - t0) / 1000;
        const rate = this.stats.added / Math.max(elapsed, 1);
        const remaining = Math.max(target - this.stats.added, 0);
        this.stats.ratePerSec = +rate.toFixed(1);
        this.stats.etaSeconds = rate > 0 ? Math.round(remaining / rate) : null;
        const eta = this.stats.etaSeconds;
        const etaStr = eta == null ? '—' : eta > 3600 ? `${(eta / 3600).toFixed(1)}h` : eta > 60 ? `${Math.round(eta / 60)}m` : `${eta}s`;
        this.log.log(
          `MCA import: ${this.stats.added.toLocaleString()}/${target.toLocaleString()} ` +
          `(${((this.stats.added / target) * 100).toFixed(1)}%) · ${rate.toFixed(1)}/s · ETA ${etaStr} · offset ${offset}`,
        );
      }
    } finally {
      this.stats.running = false;
      this.stats.finishedAt = new Date().toISOString();
      this.running = false;
      this.log.log(`MCA import finished — +${this.stats.added.toLocaleString()} new, ${this.stats.skipped} skipped`);
    }
  }

  getStats() {
    return this.stats;
  }
}
