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
  private doneThisRun = 0;

  stats = {
    running: false, processed: 0, withContacts: 0, total: 0,
    completed: 0, remaining: 0, grandTotal: 0,
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
    this.doneThisRun = 0;
    const t0 = Date.now();
    const grandTotal = await this.companies.countCompanies();
    const pendingTotal = await this.companies.countUnenriched();
    this.stats = {
      running: true, processed: 0, withContacts: 0, total: pendingTotal,
      completed: grandTotal - pendingTotal, remaining: pendingTotal, grandTotal,
      ratePerSec: 0, etaSeconds: null, startedAt: new Date().toISOString(), lastCompany: '',
    };
    this.log.log(`Contact fill started — ${pendingTotal.toLocaleString()} of ${grandTotal.toLocaleString()} need contacts`);

    try {
      let idleRounds = 0;
      for (;;) {
        // least-tried first → every company gets attempt #1 before any retries
        const batch = await this.repo
          .createQueryBuilder('c')
          .where("c.raw->>'enrichedAt' IS NULL")
          .orderBy("COALESCE((c.raw->>'contactTries')::int, 0)", 'ASC')
          .addOrderBy('c.createdAt', 'DESC')
          .limit(CONCURRENCY)
          .getMany();
        if (!batch.length) {
          // stay alive: new companies keep arriving from the importers. Re-check every 60s;
          // exit only after 30 idle minutes with nothing pending.
          if (++idleRounds >= 30) { this.log.log('Contact fill idle — no pending companies.'); break; }
          await new Promise((r) => setTimeout(r, 60000));
          continue;
        }
        idleRounds = 0;

        // hard per-company timeout so one hung socket can never stall the whole batch
        const withTimeout = <T>(p: Promise<T>, ms: number) =>
          Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('company timeout')), ms))]);

        await Promise.all(batch.map(async (c) => {
          try {
            const before = (c.emails?.length || 0) + (c.phones?.length || 0);
            const u = await withTimeout(this.companies.enrichContactsOnly(c, true), 45000);
            const got = (u.emails?.length || 0) + (u.phones?.length || 0) > before;
            if (got) this.stats.withContacts++;
            if (u.raw?.enrichedAt) this.doneThisRun++; // newly marked done (got contact or 3rd try)
            this.stats.lastCompany = u.name;
            const e = (u.emails || [])[0] || '—';
            const p = (u.phones || [])[0] || '—';
            this.log.log(`✓ ${u.name.slice(0, 40)} → email:${e} phone:${p}`);
          } catch (e) {
            this.log.warn(`fill failed for ${c.name}: ${e}`);
            // count the attempt; only give up (mark done) after 3 tries
            const tries = ((c.raw?.contactTries as number) || 0) + 1;
            c.raw = { ...(c.raw || {}), contactTries: tries, ...(tries >= 3 ? { enrichedAt: new Date().toISOString() } : {}) };
            await this.repo.save(c).catch(() => {});
          }
          this.stats.processed++;
        }));

        // completed/remaining tracked incrementally (accurate, no extra DB load)
        const startCompleted = this.stats.grandTotal - this.stats.total;
        this.stats.completed = startCompleted + this.doneThisRun;
        this.stats.remaining = Math.max(this.stats.grandTotal - this.stats.completed, 0);
        const el = (Date.now() - t0) / 1000;
        const rate = this.doneThisRun / Math.max(el, 1); // genuine companies finished per second
        this.stats.ratePerSec = +rate.toFixed(2);
        this.stats.etaSeconds = rate > 0 && this.doneThisRun > 0 ? Math.round(this.stats.remaining / rate) : null;
        const eta = this.stats.etaSeconds;
        const etaStr = eta == null ? '—' : eta > 3600 ? `${(eta / 3600).toFixed(1)}h` : `${Math.round(eta / 60)}m`;
        this.log.log(
          `FILL completed ${this.stats.completed.toLocaleString()}/${this.stats.grandTotal.toLocaleString()} · remaining ${this.stats.remaining.toLocaleString()} · withContacts ${this.stats.withContacts} · ${rate.toFixed(2)}/s · ETA ${etaStr}`,
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
