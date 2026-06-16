import { Injectable, Logger } from '@nestjs/common';

export interface StartupIndiaResult {
  name: string;
  dpiitNumber: string | null;
  recognitionStatus: string | null;
  state: string;
  city: string;
  industry: string;
  sector: string;
  stage: string;
  registeredOn: string | null;
  confidence: number;
  raw: any;
}

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const SI_API = 'https://api.startupindia.gov.in/sih/api/noauth/search/profiles';

/** strip common company suffixes/noise for fairer name comparison */
function normalize(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/private|limited|pvt|ltd|llp|technologies|technology|solutions|services|india|inc|corp/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return dp[m][n];
}

/** 0..1 similarity; containment only counts when lengths are comparable, to
 *  avoid false positives like "boat" ⊂ "sunglassboat". */
function similarity(query: string, candidate: string): number {
  const q = normalize(query), c = normalize(candidate);
  if (!q || !c) return 0;
  if (q === c) return 1;
  const ratio = Math.min(q.length, c.length) / Math.max(q.length, c.length);
  if ((c.includes(q) || q.includes(c)) && ratio >= 0.7) return 0.85;
  const dist = levenshtein(q, c);
  return 1 - dist / Math.max(q.length, c.length);
}

/**
 * Live Startup India (DPIIT) recognised-startup search — the public API behind
 * https://www.startupindia.gov.in/content/sih/en/search.html?roles=Startup
 * Returns the best name-matched startup above MATCH_CONFIDENCE_THRESHOLD, else null.
 */
@Injectable()
export class StartupIndiaProvider {
  private readonly log = new Logger('StartupIndia');

  /** Fetch a page of recently-registered startups (newest first) for bulk ingestion. */
  async listPage(page: number, size = 20): Promise<any[]> {
    try {
      const res = await fetch(`${SI_API}?page=${page}&size=${size}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': UA,
          Origin: 'https://www.startupindia.gov.in',
          Referer: 'https://www.startupindia.gov.in/',
        },
        body: JSON.stringify({
          query: '',
          focusSector: false,
          internationalUser: false,
          sort: { orders: [{ field: 'registeredOn', direction: 'DESC' }] },
          roles: ['Startup'],
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        this.log.warn(`Startup India listPage ${res.status}`);
        return [];
      }
      const data: any = await res.json();
      return data.content || [];
    } catch (e) {
      this.log.warn(`Startup India listPage failed: ${e}`);
      return [];
    }
  }

  async lookup(name: string): Promise<StartupIndiaResult | null> {
    try {
      const res = await fetch(`${SI_API}?page=0&size=20`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': UA,
          Origin: 'https://www.startupindia.gov.in',
          Referer: 'https://www.startupindia.gov.in/',
        },
        body: JSON.stringify({
          query: name,
          focusSector: false,
          internationalUser: false,
          dpiitRecogniseUser: true,
          sort: { orders: [{ field: 'registeredOn', direction: 'DESC' }] },
          roles: ['Startup'],
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        this.log.warn(`Startup India API ${res.status}`);
        return null;
      }
      const data: any = await res.json();
      const content: any[] = data.content || [];
      if (!content.length) return null;

      const threshold = parseFloat(process.env.MATCH_CONFIDENCE_THRESHOLD || '0.75');
      const ranked = content
        .map((r) => ({ r, score: similarity(name, r.name) }))
        .sort((a, b) => b.score - a.score);
      const best = ranked[0];
      if (best.score < threshold) {
        this.log.debug(`No SI match >= ${threshold} for "${name}" (best ${best.r.name} @ ${best.score.toFixed(2)})`);
        return null;
      }

      const r = best.r;
      return {
        name: r.name,
        dpiitNumber: r.dippNumber || null,
        recognitionStatus: r.dippRecognitionStatus || null,
        state: r.state || '',
        city: r.city || '',
        industry: (r.industries || []).map((i: any) => i.name || i).join(', '),
        sector: (r.sectors || []).map((s: any) => s.name || s).join(', '),
        stage: (r.stages || []).map((s: any) => s.name || s).join(', '),
        registeredOn: r.registeredOn || null,
        confidence: best.score,
        raw: r,
      };
    } catch (e) {
      this.log.warn(`Startup India lookup failed: ${e}`);
      return null;
    }
  }
}
