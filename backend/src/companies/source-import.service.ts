import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client } from 'pg';
import { CompaniesService } from './companies.service';
import { UsersService } from '../users/users.service';

/**
 * One-time (idempotent) import of existing startups from the source DB
 * (SOURCE_DATABASE_URL → startupindia_companies) into our schema. Deduped by slug,
 * startups only, mapped to our columns — never copies the source schema.
 */
@Injectable()
export class SourceImportService implements OnModuleInit {
  private readonly log = new Logger('SourceImport');
  stats = { ran: false, imported: 0, skipped: 0, total: 0, usersImported: 0, at: null as string | null };

  constructor(
    private companies: CompaniesService,
    private users: UsersService,
  ) {}

  onModuleInit() {
    // run ~35s after boot so it doesn't block startup; safe to re-run (dedup by slug)
    setTimeout(() => this.importAll().catch((e) => this.log.warn(`import failed: ${e}`)), 35000);
  }

  async importAll() {
    const url = process.env.SOURCE_DATABASE_URL;
    if (!url) {
      this.log.debug('SOURCE_DATABASE_URL not set — skipping import');
      return;
    }
    const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
    await client.connect();
    try {
      const { rows } = await client.query(
        `SELECT company_name, cin_real, website, contact_email, contact_phone,
                contact_address, industry, sector, stage, state, city, dipp_number,
                dpiit_recognised, linkedin_url, twitter_url, facebook_url, description, raw
         FROM startupindia_companies`,
      );
      this.log.log(`Source has ${rows.length} startups — importing (deduped)…`);
      const { added, skipped } = await this.companies.seedExternalStartups(rows);

      // import users too (deduped by email)
      let usersImported = 0;
      try {
        const { rows: userRows } = await client.query(
          `SELECT email, hashed_password, full_name, is_active, is_admin, created_at FROM users`,
        );
        const u = await this.users.bulkImportExternal(userRows);
        usersImported = u.added;
        this.log.log(`Users import: +${u.added} new, ${u.skipped} skipped`);
      } catch (e) {
        this.log.warn(`users import failed: ${e}`);
      }

      this.stats = { ran: true, imported: added, skipped, total: rows.length, usersImported, at: new Date().toISOString() };
      this.log.log(`Import complete: +${added} companies, +${usersImported} users`);
    } finally {
      await client.end().catch(() => {});
    }
  }
}
