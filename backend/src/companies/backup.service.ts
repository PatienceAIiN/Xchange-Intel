import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Client } from 'pg';
import { Company } from './company.entity';

const BATCH = 500;

/**
 * Replicates ONLY completed + authentic companies (raw.enrichedAt set) into a separate
 * backup Neon DB (BACKUP_DATABASE_URL). Deduped by slug (ON CONFLICT DO NOTHING). Runs in
 * batches with live stats for the dashboard. Backup of genuine data only — never AI rows.
 */
@Injectable()
export class BackupService {
  private readonly log = new Logger('Backup');
  private running = false;

  stats = {
    running: false, copied: 0, eligible: 0, ratePerSec: 0,
    etaSeconds: null as number | null, lastAt: null as string | null, enabled: !!process.env.BACKUP_DATABASE_URL,
  };

  constructor(@InjectRepository(Company) private repo: Repository<Company>) {}

  private async client(): Promise<Client> {
    const c = new Client({ connectionString: process.env.BACKUP_DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await c.connect();
    return c;
  }

  private async ensureTable(c: Client) {
    await c.query(`CREATE TABLE IF NOT EXISTS companies (
      slug text PRIMARY KEY, name text, cin text, llpin text, website text,
      emails jsonb, phones jsonb, founders jsonb, directors jsonb, address text,
      "socialLinks" jsonb, description text, sources jsonb,
      "startupIndiaRecognised" boolean, "dpiitNumber" text, industry text, stage text,
      status text, city text, state text, "authorizedCapital" text, "paidUpCapital" text,
      "copiedAt" timestamptz default now())`);
  }

  async run() {
    if (this.running) return;
    if (!process.env.BACKUP_DATABASE_URL) { this.log.debug('BACKUP_DATABASE_URL not set'); return; }
    this.running = true;
    this.stats.running = true;
    const t0 = Date.now();
    let client: Client | null = null;
    try {
      client = await this.client();
      await this.ensureTable(client);
      this.stats.eligible = await this.repo.createQueryBuilder('c').where("c.raw->>'enrichedAt' IS NOT NULL").getCount();
      this.log.log(`Backup started — ${this.stats.eligible} completed companies to replicate`);

      let offset = 0;
      for (;;) {
        const rows = await this.repo.createQueryBuilder('c')
          .where("c.raw->>'enrichedAt' IS NOT NULL")
          .orderBy('c.createdAt', 'ASC').limit(BATCH).offset(offset).getMany();
        if (!rows.length) break;
        const cols = ['slug','name','cin','llpin','website','emails','phones','founders','directors','address','socialLinks','description','sources','startupIndiaRecognised','dpiitNumber','industry','stage','status','city','state','authorizedCapital','paidUpCapital'];
        const values: any[] = [];
        const tuples = rows.map((r, i) => {
          const base = i * cols.length;
          values.push(r.slug, r.name, r.cin, r.llpin, r.website,
            JSON.stringify(r.emails || []), JSON.stringify(r.phones || []),
            JSON.stringify(r.founders || []), JSON.stringify(r.directors || []), r.address,
            JSON.stringify(r.socialLinks || {}), r.description, JSON.stringify(r.sources || []),
            r.startupIndiaRecognised, r.dpiitNumber, r.industry, r.stage, r.status, r.city, r.state,
            r.authorizedCapital, r.paidUpCapital);
          return `(${cols.map((_, j) => `$${base + j + 1}`).join(',')})`;
        });
        const colList = cols.map((c2) => (/[A-Z]/.test(c2) ? `"${c2}"` : c2)).join(',');
        await client.query(`INSERT INTO companies (${colList}) VALUES ${tuples.join(',')} ON CONFLICT (slug) DO NOTHING`, values);
        this.stats.copied += rows.length;
        offset += rows.length;
        const el = (Date.now() - t0) / 1000, rate = this.stats.copied / Math.max(el, 1);
        this.stats.ratePerSec = +rate.toFixed(0);
        this.stats.etaSeconds = rate > 0 ? Math.round((this.stats.eligible - this.stats.copied) / rate) : null;
        this.stats.lastAt = new Date().toISOString();
        if (offset % 5000 < BATCH) this.log.log(`Backup: ${this.stats.copied}/${this.stats.eligible} replicated`);
      }
      this.log.log(`Backup complete — ${this.stats.copied} companies replicated to backup DB`);
    } catch (e) {
      this.log.warn(`Backup failed: ${e}`);
    } finally {
      if (client) await client.end().catch(() => {});
      this.stats.running = false;
      this.running = false;
    }
  }

  getStats() { return this.stats; }
}
