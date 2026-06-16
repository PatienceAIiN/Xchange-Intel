import { Injectable, Logger } from '@nestjs/common';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(?:\+?91[-\s]?)?[6-9]\d{9}\b/g;

export interface TracxnResult {
  profileUrl: string;
  website: string | null;
  founders: string[];
  emails: string[];
  phones: string[];
  description: string;
}

/**
 * Best-effort Tracxn public-profile source. Tracxn gates most data behind login and
 * bot protection, so this resolves gracefully to null when blocked. When a public
 * profile loads, founders / website / on-page contacts are extracted (genuine, not AI).
 */
@Injectable()
export class TracxnProvider {
  private readonly log = new Logger('Tracxn');

  async lookup(name: string): Promise<TracxnResult | null> {
    const slug = name
      .toLowerCase()
      .replace(/\(opc\)|private limited|pvt ltd|limited|ltd|llp/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (slug.length < 3) return null;

    const url = `https://tracxn.com/d/companies/${slug}`;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'text/html' },
        redirect: 'follow',
        signal: AbortSignal.timeout(9000),
      });
      if (!res.ok) return null;
      const html = (await res.text()).slice(0, 300_000);
      if (!html.toLowerCase().includes(slug.split('-')[0])) return null;

      const text = html.replace(/<[^>]+>/g, ' ');
      const website =
        (html.match(/"website"\s*:\s*"(https?:\/\/[^"]+)"/i) || [])[1] ||
        (html.match(/href="(https?:\/\/(?!.*tracxn)[^"]+)"[^>]*>\s*Website/i) || [])[1] ||
        null;
      const founders = [
        ...new Set(
          [...html.matchAll(/"foundedBy"\s*:\s*"([^"]+)"/gi)].map((m) => m[1]).filter(Boolean),
        ),
      ].slice(0, 6);
      const emails = [...new Set(text.match(EMAIL_RE) || [])]
        .filter((e) => !/tracxn|\.png|\.jpg|sentry|example/i.test(e))
        .slice(0, 4);
      const phones = [...new Set(text.match(PHONE_RE) || [])].slice(0, 4);

      if (!website && !founders.length && !emails.length && !phones.length) return null;
      this.log.log(`Tracxn profile hit for "${name}"`);
      return { profileUrl: url, website, founders, emails, phones, description: '' };
    } catch (e) {
      this.log.debug(`Tracxn lookup skipped: ${e}`);
      return null;
    }
  }
}
