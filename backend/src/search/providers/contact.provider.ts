import { Injectable, Logger } from '@nestjs/common';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(?:\+?91[-\s]?)?(?:0)?[6-9]\d{9}\b/g;

// reject obvious non-contact addresses harvested from markup
const EMAIL_BLOCKLIST =
  /(example\.|sentry|wixpress|\.png|\.jpg|\.jpeg|\.gif|\.svg|\.webp|your@|email@|user@|name@|domain\.com|@2x|@sentry|core-js|schema\.org|w3\.org|googleapis|gstatic)/i;

const SOCIAL_PATTERNS: { key: string; re: RegExp }[] = [
  { key: 'linkedin', re: /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:company|in)\/[A-Za-z0-9._-]+/i },
  { key: 'twitter', re: /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[A-Za-z0-9_]+/i },
  { key: 'instagram', re: /https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9._]+/i },
  { key: 'facebook', re: /https?:\/\/(?:www\.)?facebook\.com\/[A-Za-z0-9.\-/]+/i },
  { key: 'youtube', re: /https?:\/\/(?:www\.)?youtube\.com\/(?:@|c\/|channel\/|user\/)[A-Za-z0-9._-]+/i },
];

export interface ContactResult {
  emails: string[];
  phones: string[];
  socials: Record<string, string>;
  scrapedFrom: string[];
}

/**
 * Rigorous, NON-fabricated contact discovery: fetches the company's OWN website
 * and common pages, then extracts real `mailto:`/`tel:` links, on-page emails/phones,
 * and linked social profiles. AI-suggested contacts (candidates) are ONLY included if
 * they literally appear on the site — verified, never trusted blindly.
 */
@Injectable()
export class ContactProvider {
  private readonly log = new Logger('Contact');

  async scrape(
    website: string | null,
    candidates?: { emails?: string[]; phones?: string[] },
  ): Promise<ContactResult | null> {
    if (!website) return null;
    let origin: URL;
    try {
      origin = new URL(website.startsWith('http') ? website : `https://${website}`);
    } catch {
      return null;
    }
    if (!/^https?:$/.test(origin.protocol)) return null;

    const paths = ['', '/contact', '/contact-us', '/contactus', '/about', '/about-us',
      '/support', '/help', '/privacy', '/privacy-policy', '/terms'];
    const urls = paths.map((p) => (p ? new URL(p, origin).href : origin.href));

    const emails = new Set<string>();
    const phones = new Set<string>();
    const socials: Record<string, string> = {};
    const scrapedFrom: string[] = [];
    let combined = '';

    const htmls = await Promise.all(urls.map((u) => this.fetchHtml(u)));
    htmls.forEach((html, i) => {
      if (!html) return;
      scrapedFrom.push(urls[i]);
      const lower = html.toLowerCase();
      combined += '\n' + lower;
      for (const m of html.matchAll(/mailto:([^"'?>\s]+)/gi)) this.addEmail(emails, m[1]);
      for (const m of html.matchAll(/tel:([+\d\-\s()]{8,})/gi)) this.addPhone(phones, m[1]);
      for (const { key, re } of SOCIAL_PATTERNS) {
        if (!socials[key]) {
          const hit = html.match(re);
          // drop tracking-pixel / sharer / generic non-profile links
          if (hit && !/\/(tr|sharer|share|plugins|intent|dialog)\b/i.test(hit[0])) {
            socials[key] = hit[0];
          }
        }
      }
      const text = html.replace(/<[^>]+>/g, ' ');
      for (const e of text.match(EMAIL_RE) || []) this.addEmail(emails, e);
      for (const p of text.match(PHONE_RE) || []) this.addPhone(phones, p);
    });

    // verify AI-suggested candidates against the real site content
    const digitsBlob = combined.replace(/[^\d]/g, '');
    for (const e of candidates?.emails || []) {
      const norm = e.trim().toLowerCase();
      if (combined.includes(norm)) this.addEmail(emails, norm);
    }
    for (const p of candidates?.phones || []) {
      const d = p.replace(/[^\d]/g, '').replace(/^91/, '');
      if (d.length >= 10 && digitsBlob.includes(d.slice(-10))) this.addPhone(phones, p);
    }

    const found = emails.size + phones.size + Object.keys(socials).length;
    if (!found) return null;
    this.log.log(
      `Contacts for ${origin.hostname}: ${emails.size} email(s), ${phones.size} phone(s), ${Object.keys(socials).length} social(s)`,
    );
    return {
      emails: [...emails].slice(0, 8),
      phones: [...phones].slice(0, 8),
      socials,
      scrapedFrom,
    };
  }

  private addEmail(set: Set<string>, raw: string) {
    const e = decodeURIComponent(raw).trim().toLowerCase();
    if (e.length > 6 && e.length < 80 && !EMAIL_BLOCKLIST.test(e)) set.add(e);
  }

  private addPhone(set: Set<string>, raw: string) {
    const digits = raw.replace(/[^\d+]/g, '');
    const bare = digits.replace(/^\+?91/, '').replace(/^0/, '');
    // Indian mobile numbers only — avoids foreign tracking-pixel numbers (e.g. +1…)
    if (/^[6-9]\d{9}$/.test(bare)) set.add('+91' + bare);
  }

  private async fetchHtml(url: string): Promise<string | null> {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'text/html' },
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('html')) return null;
      return (await res.text()).slice(0, 400_000);
    } catch {
      return null;
    }
  }
}
