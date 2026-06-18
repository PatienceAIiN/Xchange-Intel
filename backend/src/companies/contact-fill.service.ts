import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Company } from './company.entity';
import { CompaniesService } from './companies.service';

const CONCURRENCY = 6;
const CSV_PATH = process.env.EXPORT_OUT || '/home/harsh/Documents/companies_export.csv';
const CSV_EVERY = 5000; // refresh CSV every N filled (full-table scan — keep infrequent for Neon free tier)

/**
 * Continuously fills GENUINE contact data (website + registry aggregator) into every
 * company that lacks it, writes results into the CSV in the exact template format, and
 * logs live ETA + the filled data per company. 100% authentic — never AI-generated.
 */
@Injectable()
export class ContactFillService {
  private readonly log = new Logger('ContactFill');
  private running = false;

  stats = {
    running: false, processed: 0, withContacts: 0, total: 0,
    ratePerSec: 0, etaSeconds: null as number | null,
    startedAt: null as string | null, lastCompany: '',
  };

  constructor(
    @InjectRepository(Company) private repo: Repository<Company>,
    private companies: CompaniesService,
  ) {}

  async run() {
    if (this.running) { this.log.warn('contact fill already running'); return; }
    this.running = true;
    const t0 = Date.now();
    const pendingTotal = await this.companies.countUnenriched();
    this.stats = {
      running: true, processed: 0, withContacts: 0, total: pendingTotal,
      ratePerSec: 0, etaSeconds: null, startedAt: new Date().toISOString(), lastCompany: '',
    };
    this.log.log(`Contact fill started — ${pendingTotal.toLocaleString()} companies need contacts`);

    try {
      for (;;) {
        const batch = await this.repo
          .createQueryBuilder('c')
          .where("c.raw->>'enrichedAt' IS NULL")
          .orderBy('c.createdAt', 'DESC')
          .limit(CONCURRENCY)
          .getMany();
        if (!batch.length) { this.log.log('All companies processed.'); break; }

        await Promise.all(batch.map(async (c) => {
          try {
            const before = (c.emails?.length || 0) + (c.phones?.length || 0);
            const u = await this.companies.enrichContactsOnly(c, true);
            const got = (u.emails?.length || 0) + (u.phones?.length || 0) > before;
            if (got) this.stats.withContacts++;
            this.stats.lastCompany = u.name;
            const e = (u.emails || [])[0] || '—';
            const p = (u.phones || [])[0] || '—';
            this.log.log(`✓ ${u.name.slice(0, 40)} → email:${e} phone:${p}`);
          } catch (e) {
            this.log.warn(`fill failed for ${c.name}: ${e}`);
            // still mark attempted so we don't loop forever on a bad row
            c.raw = { ...(c.raw || {}), enrichedAt: new Date().toISOString() };
            await this.repo.save(c).catch(() => {});
          }
          this.stats.processed++;
        }));

        const el = (Date.now() - t0) / 1000;
        const rate = this.stats.processed / Math.max(el, 1);
        this.stats.ratePerSec = +rate.toFixed(2);
        this.stats.etaSeconds = rate > 0 ? Math.round((this.stats.total - this.stats.processed) / rate) : null;
        const eta = this.stats.etaSeconds;
        const etaStr = eta == null ? '—' : eta > 3600 ? `${(eta / 3600).toFixed(1)}h` : `${Math.round(eta / 60)}m`;
        this.log.log(
          `FILL ${this.stats.processed}/${this.stats.total} · withContacts ${this.stats.withContacts} · ${rate.toFixed(1)}/s · ETA ${etaStr}`,
        );

        if (this.stats.processed % CSV_EVERY < CONCURRENCY) {
          const n = await this.companies.writeCsvExport(CSV_PATH).catch(() => 0);
          if (n) this.log.log(`CSV updated → ${CSV_PATH} (${n} rows)`);
        }
      }
      await this.companies.writeCsvExport(CSV_PATH).catch(() => 0);
    } finally {
      this.stats.running = false;
      this.running = false;
      this.log.log(`Contact fill finished — ${this.stats.processed} processed, ${this.stats.withContacts} with contacts`);
    }
  }

  getStats() { return this.stats; }
}
