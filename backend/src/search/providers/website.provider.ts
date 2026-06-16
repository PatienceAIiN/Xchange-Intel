import { Injectable, Logger } from '@nestjs/common';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

/**
 * Resolves a company's official website WITHOUT fabricating it: candidate domains
 * are derived from the name, then each is fetched and only accepted if it actually
 * responds AND its page content references the company name (guards against parked
 * / unrelated domains). Verified, not guessed.
 */
@Injectable()
export class WebsiteProvider {
  private readonly log = new Logger('Website');

  async resolve(name: string): Promise<string | null> {
    const cleaned = name
      .toLowerCase()
      .replace(/\(opc\)|private limited|pvt ltd|pvt\.? ltd\.?|limited|ltd|llp|india|inc|corp/g, ' ')
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const words = cleaned.split(' ').filter((w) => w.length > 1);
    if (!words.length) return null;

    // try meaningful domain tokens: first word, first two words, first three words, full compact
    const compact = words.join('');
    const tokenSet = [
      words[0],
      words.slice(0, 2).join(''),
      words.slice(0, 3).join(''),
      compact,
    ].filter((t, i, a) => t && t.length >= 3 && t.length <= 30 && a.indexOf(t) === i);

    const tlds = ['.com', '.in', '.co.in', '.io', '.net'];
    const matchToken = (words[0].length >= 4 ? words[0] : words.slice(0, 2).join('')).slice(0, 12);

    // build all candidate URLs in priority order, verify them in PARALLEL, and pick the
    // highest-priority one that responds (bounds latency to a single round-trip).
    const candidates: string[] = [];
    for (const token of tokenSet) for (const t of tlds) candidates.push(`https://${token}${t}`);

    const results = await Promise.all(
      candidates.map((url) => this.verify(url, matchToken).then((ok) => (ok ? url : null))),
    );
    const hit = results.find(Boolean);
    if (hit) {
      this.log.log(`Verified website for "${name}": ${hit}`);
      return hit;
    }
    return null;
  }

  /** returns the final URL if it loads and references the name token */
  private async verify(url: string, token: string): Promise<string | null> {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'text/html' },
        redirect: 'follow',
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) return null;
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('html')) return null;
      const html = (await res.text()).slice(0, 80_000).toLowerCase();
      // must reference the company token somewhere on the homepage
      if (!html.includes(token)) return null;
      // reject obvious domain-parking pages
      if (/domain (is )?for sale|buy this domain|parked|godaddy|sedo/.test(html)) return null;
      return res.url || url;
    } catch {
      return null;
    }
  }
}
