import { Injectable, Logger } from '@nestjs/common';

export interface McaResult {
  cin: string;
  companyName: string;
  status: string;
  category: string;
  companyClass: string;
  authorizedCapital: string;
  paidUpCapital: string;
  registrationDate: string;
  address: string;
  roc: string;
  state: string;
  classification: string;
  matchedBy: 'cin' | 'name';
  raw: any;
}

/**
 * MCA Company Master Data via data.gov.in (Ministry of Corporate Affairs).
 * The official MCA portal has no open API; this is the authoritative free source.
 * The API supports EXACT filters only (no fuzzy search), so we:
 *   - look up by CIN when one has been discovered elsewhere (most reliable), and
 *   - try the query + common legal-suffix variants for an exact name match.
 */
@Injectable()
export class McaProvider {
  private readonly log = new Logger('MCA');

  private get base() {
    const key = process.env.DATAGOV_API_KEY;
    const rid = process.env.DATAGOV_MCA_RESOURCE;
    const url = process.env.DATAGOV_API_URL || 'https://api.data.gov.in/resource/';
    if (!key || !rid) return null;
    return `${url}${rid}?api-key=${key}&format=json`;
  }

  /** fetch with small retry — data.gov.in occasionally drops connections under load */
  private async fetchJson(url: string, attempts = 3): Promise<any | null> {
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (res.status === 429 || res.status >= 500) throw new Error(`status ${res.status}`);
        if (!res.ok) return null;
        return await res.json();
      } catch (e) {
        if (i === attempts - 1) {
          this.log.warn(`MCA fetch failed after ${attempts} attempts: ${e}`);
          return null;
        }
        await new Promise((r) => setTimeout(r, 400 * (i + 1)));
      }
    }
    return null;
  }

  /**
   * Fetch a raw page of MCA Company Master Data for bulk import.
   * Returns { records, blocked } — blocked=true when the key is unauthorised/rate-limited
   * so the caller can back off (we never fabricate to fill the gap).
   */
  async listPage(offset: number, limit = 100): Promise<{ records: any[]; blocked: boolean; error: boolean }> {
    const base = this.base;
    if (!base) return { records: [], blocked: false, error: false };
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${base}&offset=${offset}&limit=${limit}`, {
          signal: AbortSignal.timeout(25000),
        });
        if (res.status === 403 || res.status === 429) return { records: [], blocked: true, error: false };
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data: any = await res.json();
        return { records: data.records || [], blocked: false, error: false };
      } catch (e) {
        if (attempt === 2) {
          this.log.warn(`MCA listPage offset ${offset} failed after retries: ${e}`);
          return { records: [], blocked: false, error: true }; // transient, not end-of-data
        }
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      }
    }
    return { records: [], blocked: false, error: true };
  }

  private async query(field: 'CIN' | 'CompanyName', value: string): Promise<McaResult | null> {
    const base = this.base;
    if (!base) return null;
    {
      const url = `${base}&filters%5B${field}%5D=${encodeURIComponent(value)}&limit=1`;
      const data = await this.fetchJson(url);
      if (!data) return null;
      const r = (data.records || [])[0];
      if (!r) return null;
      return {
        cin: r.CIN,
        companyName: r.CompanyName,
        status: r.CompanyStatus || '',
        category: r.CompanyCategory || '',
        companyClass: r.CompanyClass || '',
        authorizedCapital: r.AuthorizedCapital || '',
        paidUpCapital: r.PaidupCapital || '',
        registrationDate: r.CompanyRegistrationdate_date || '',
        address: r.Registered_Office_Address || '',
        roc: r.CompanyROCcode || '',
        state: r.CompanyStateCode || '',
        classification: r.CompanyIndustrialClassification || '',
        matchedBy: field === 'CIN' ? 'cin' : 'name',
        raw: r,
      };
    }
  }

  byCin(cin: string) {
    return this.query('CIN', cin.toUpperCase());
  }

  /** Exact-name attempt across common legal-suffix variants. */
  async byName(name: string): Promise<McaResult | null> {
    const n = name.trim().toUpperCase();
    const variants = [
      n,
      `${n} PRIVATE LIMITED`,
      `${n} LIMITED`,
      `${n} PVT LTD`,
      `${n} TECHNOLOGIES PRIVATE LIMITED`,
    ];
    for (const v of variants) {
      const r = await this.query('CompanyName', v);
      if (r) return r;
    }
    return null;
  }
}
