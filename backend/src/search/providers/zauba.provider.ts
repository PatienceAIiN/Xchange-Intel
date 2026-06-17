import { Injectable, Logger } from '@nestjs/common';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const CIN_RE = /[LU]\d{5}[A-Za-z]{2}\d{4}[A-Za-z]{3}\d{6}/i;

function norm(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/private|limited|pvt|ltd|llp|and|&/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Resolves a company's CIN by NAME from ZaubaCorp's public search results — the genuine
 * registry-aggregator source Google also uses. Lets us find CINs for companies that are
 * NOT in the free data.gov MCA snapshot. Returns null if no confident name match.
 */
@Injectable()
export class ZaubaProvider {
  private readonly log = new Logger('Zauba');

  async resolveCin(name: string): Promise<string | null> {
    try {
      const url = `https://www.zaubacorp.com/companysearchresults/${encodeURIComponent(name)}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'text/html' },
        redirect: 'follow',
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) return null;
      const html = await res.text();

      // extract (company-name, CIN) pairs from result links: /company/<NAME>/<CIN>
      const pairs: { name: string; cin: string }[] = [];
      for (const m of html.matchAll(/\/company\/([^/"']+)\/([LU]\d{5}[A-Za-z]{2}\d{4}[A-Za-z]{3}\d{6})/gi)) {
        pairs.push({ name: decodeURIComponent(m[1]).replace(/-/g, ' '), cin: m[2].toUpperCase() });
      }
      if (!pairs.length) {
        // fallback: a lone CIN on the page (exact-name search often lands on one result)
        const lone = html.match(CIN_RE);
        return lone ? lone[0].toUpperCase() : null;
      }

      const q = norm(name);
      const qArr = q.split(' ').filter((w) => w.length > 2);
      const qWords = new Set(qArr);
      let best: { cin: string; score: number } | null = null;
      for (const p of pairs) {
        const c = norm(p.name);
        if (!c) continue;
        let score = c === q ? 1 : 0;
        if (!score) {
          const cWords = c.split(' ');
          let overlap = cWords.filter((w) => qWords.has(w)).length;
          // Allow substring overlap for the first meaningful word (e.g. aaumai vs aumai)
          if (cWords.length > 0 && qArr.length > 0 && !qWords.has(cWords[0])) {
            if (cWords[0].includes(qArr[0]) || qArr[0].includes(cWords[0])) {
              overlap += 1;
            }
          }
          score = overlap / Math.max(qWords.size, 1);
        }
        if (!best || score > best.score) best = { cin: p.cin, score };
      }
      if (best && best.score >= 0.6) {
        this.log.log(`Zauba resolved CIN ${best.cin} for "${name}" (score ${best.score.toFixed(2)})`);
        return best.cin;
      }
      return null;
    } catch (e) {
      this.log.warn(`Zauba resolve failed: ${e}`);
      return null;
    }
  }
}
