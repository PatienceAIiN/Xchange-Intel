import { Injectable, Logger } from '@nestjs/common';

export interface WikiResult {
  title: string | null;
  description: string;
  pageUrl: string | null;
  website: string | null;
  founders: string[];
  inception: string | null;
  headquarters: string | null;
  socialLinks: Record<string, string>;
  snippets: string;
}

const UA = 'NexusCompanyIntel/1.0 (company-intelligence; contact: admin@nexus.local)';

/**
 * Free, reliable, no-API-key grounding source.
 * Wikipedia REST summary  -> human description.
 * Wikidata claims         -> structured, citable facts (website, founders,
 *                            inception, HQ, social handles). This is the same
 *                            structured data that powers Google's Knowledge Panel.
 */
@Injectable()
export class WikiProvider {
  private readonly log = new Logger('Wiki');

  async lookup(name: string): Promise<WikiResult | null> {
    const summary = await this.wikipedia(name);
    const wd = await this.wikidata(name);
    if (!summary && !wd) return null;

    const snippets = [
      summary ? `Wikipedia (${summary.title}): ${summary.extract}` : '',
      wd ? `Wikidata: ${JSON.stringify(wd)}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      title: summary?.title || wd?.label || name,
      description: summary?.extract || wd?.description || '',
      pageUrl: summary?.pageUrl || null,
      website: wd?.website || null,
      founders: wd?.founders || [],
      inception: wd?.inception || null,
      headquarters: wd?.headquarters || null,
      socialLinks: wd?.socialLinks || {},
      snippets,
    };
  }

  private async wikipedia(name: string) {
    try {
      const res = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}?redirect=true`,
        { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(12000) },
      );
      if (!res.ok) return null;
      const w: any = await res.json();
      if (w.type === 'disambiguation' || !w.extract) return null;
      return { title: w.title, extract: w.extract, pageUrl: w.content_urls?.desktop?.page || null };
    } catch (e) {
      this.log.warn(`Wikipedia failed: ${e}`);
      return null;
    }
  }

  private async wikidata(name: string) {
    try {
      const s: any = await (
        await fetch(
          `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(
            name,
          )}&language=en&format=json&type=item&limit=1`,
          { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) },
        )
      ).json();
      const hit = s.search?.[0];
      if (!hit) return null;

      const e: any = await (
        await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${hit.id}.json`, {
          headers: { 'User-Agent': UA },
          signal: AbortSignal.timeout(12000),
        })
      ).json();
      const claims = e.entities?.[hit.id]?.claims || {};
      const vals = (p: string) => (claims[p] || []).map((x: any) => x.mainsnak?.datavalue?.value);

      const founderIds = vals('P112').map((v: any) => v?.id).filter(Boolean);
      const hqIds = vals('P159').map((v: any) => v?.id).filter(Boolean);
      const labels = await this.labels([...founderIds, ...hqIds]);

      const social: Record<string, string> = {};
      const tw = vals('P2002')[0];
      const ig = vals('P2003')[0];
      const fb = vals('P2013')[0];
      const li = vals('P4264')[0];
      if (tw) social.twitter = `https://twitter.com/${tw}`;
      if (ig) social.instagram = `https://instagram.com/${ig}`;
      if (fb) social.facebook = `https://facebook.com/${fb}`;
      if (li) social.linkedin = `https://www.linkedin.com/company/${li}`;

      return {
        label: hit.label,
        description: hit.description || '',
        website: vals('P856')[0] || null,
        founders: founderIds.map((id: string) => labels[id]).filter(Boolean),
        inception: (vals('P571')[0]?.time || '').replace(/^\+/, '').slice(0, 10) || null,
        headquarters: hqIds.map((id: string) => labels[id]).filter(Boolean).join(', ') || null,
        socialLinks: social,
      };
    } catch (e) {
      this.log.warn(`Wikidata failed: ${e}`);
      return null;
    }
  }

  /** Resolve a batch of Wikidata QIDs to English labels. */
  private async labels(ids: string[]): Promise<Record<string, string>> {
    const uniq = [...new Set(ids)].slice(0, 50);
    if (!uniq.length) return {};
    try {
      const r: any = await (
        await fetch(
          `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${uniq.join(
            '|',
          )}&props=labels&languages=en&format=json`,
          { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) },
        )
      ).json();
      const out: Record<string, string> = {};
      for (const id of uniq) out[id] = r.entities?.[id]?.labels?.en?.value || '';
      return out;
    } catch {
      return {};
    }
  }
}
