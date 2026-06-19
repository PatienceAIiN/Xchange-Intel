import { Injectable, Logger } from '@nestjs/common';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(?:\+?91[-\s]?)?[6-9]\d{9}\b/g;

// drop the aggregators' OWN contact details + junk
const EMAIL_BLOCK =
  /(indiafilings|thecompanycheck|zaubacorp|tofler|instafinancials|cleartax|justdial|sentry|wixpress|example|\.png|\.jpg|\.svg|@2x|schema\.org|w3\.org|googleapis|gstatic|support@|help@|noreply|sales@|care@|contact@instafinancials)/i;

export interface AggregatorResult {
  emails: string[];
  phones: string[];
  directors: string[];
  scrapedFrom: string[];
}

/**
 * Genuine company contacts from public MCA registry-aggregator pages (IndiaFilings,
 * TheCompanyCheck) — the same sources Google's AI Overview cites. Requires a CIN.
 * Nothing is fabricated: only data actually present on those public pages is returned.
 */
@Injectable()
export class AggregatorProvider {
  private readonly log = new Logger('Aggregator');

  async lookup(name: string, cin: string | null): Promise<AggregatorResult | null> {
    if (!cin) return null;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const upper = name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const urls = [
      `https://www.indiafilings.com/search/${slug}-cin-${cin}`,
      `https://www.thecompanycheck.com/company/${slug}/${cin}`,
      `https://www.zaubacorp.com/company/${upper}/${cin}`,
      `https://www.tofler.in/${slug}/${cin}`,
      `https://www.instafinancials.com/company/${slug}/${cin}`,
    ];

    const emails = new Set<string>();
    const phones = new Set<string>();
    const directors = new Set<string>();
    const scrapedFrom: string[] = [];

    const pages = await Promise.all(urls.map((u) => this.fetch(u)));
    pages.forEach((html, i) => {
      if (!html) return;
      // page must actually reference this CIN (avoid a generic/landing page)
      if (!html.includes(cin)) return;
      scrapedFrom.push(urls[i]);
      const txt = html.replace(/<[^>]+>/g, ' ');
      for (const e of txt.match(EMAIL_RE) || []) {
        const v = e.trim().toLowerCase();
        if (v.length < 80 && !EMAIL_BLOCK.test(v)) emails.add(v);
      }
      // NOTE: we do NOT scrape phones from aggregator pages — their header/footer support
      // numbers repeat on every company page (false positives). Company-specific emails on
      // these pages are genuine; phones come only from the company's own website.
      // director names on these pages appear in a "Directors / Signatory" context
      for (const m of txt.matchAll(/([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+){1,3})\s+(?:is|was)\s+(?:the\s+)?(?:a\s+)?Director/g)) {
        directors.add(m[1].trim());
      }
    });

    const found = emails.size + phones.size + directors.size;
    if (!found) return null;
    this.log.log(`Aggregator contacts for ${cin}: ${emails.size} email(s), ${phones.size} phone(s)`);
    return {
      emails: [...emails].slice(0, 6),
      phones: [...phones].slice(0, 6),
      directors: [...directors].slice(0, 8),
      scrapedFrom,
    };
  }

  private async fetch(url: string): Promise<string | null> {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'text/html' },
        redirect: 'follow',
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('html')) return null;
      return (await res.text()).slice(0, 500_000);
    } catch {
      return null;
    }
  }
}
