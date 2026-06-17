import { Injectable, Logger } from '@nestjs/common';

export interface GoogleResult {
  organic: { title: string; link: string; snippet: string }[];
  knowledgeGraph: Record<string, any> | null;
  rawSnippets: string;
  // Google's genuine AI Overview block (when the search engine returns it)
  aiOverview?: { text: string; references: string[] } | null;
}

/**
 * Google search. Uses SerpAPI when USE_PAID_SEARCH=true (reliable JSON,
 * includes Knowledge Graph). Falls back to a SearXNG instance otherwise.
 */
@Injectable()
export class GoogleProvider {
  private readonly log = new Logger('Google');

  async search(query: string, rawQuery = false): Promise<GoogleResult> {
    const usePaid = process.env.USE_PAID_SEARCH === 'true' && process.env.SERPAPI_KEY;
    if (usePaid) {
      const r = await this.serpapi(query, rawQuery);
      if (r && (r.organic.length || r.rawSnippets)) return r;
    }
    const sx = await this.searxng(query, rawQuery);
    if (sx && sx.organic.length) return sx;
    
    // Fallback to DuckDuckGo Lite if SearXNG is blocked
    const ddgRes = await this.ddg(query, rawQuery);
    if (ddgRes && ddgRes.organic.length) return ddgRes;

    // No working Google source
    return { organic: [], knowledgeGraph: null, rawSnippets: '' };
  }

  private async serpapi(query: string, rawQuery: boolean): Promise<GoogleResult | null> {
    try {
      const q = rawQuery ? query : query + ' company India';
      const url =
        `https://serpapi.com/search.json?engine=google&gl=in&hl=en` +
        `&q=${encodeURIComponent(q)}&api_key=${process.env.SERPAPI_KEY}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) {
        this.log.warn(`SerpAPI ${res.status}`);
        return null;
      }
      const data: any = await res.json();
      const organic = (data.organic_results || [])
        .slice(0, 8)
        .map((o: any) => ({ title: o.title, link: o.link, snippet: o.snippet || '' }));
      const kg = data.knowledge_graph || null;
      const answerBox = data.answer_box || null;
      const rawSnippets = [
        kg ? JSON.stringify(kg) : '',
        answerBox ? `Answer Box: ${JSON.stringify(answerBox)}` : '',
        ...organic.map((o: any) => `${o.title}: ${o.snippet} (${o.link})`),
      ]
        .filter(Boolean)
        .join('\n');
      return { organic, knowledgeGraph: kg, rawSnippets };
    } catch (e) {
      this.log.warn(`SerpAPI failed: ${e}`);
      return null;
    }
  }

  private async searxng(query: string, rawQuery: boolean): Promise<GoogleResult | null> {
    try {
      const base = process.env.SEARXNG_URL;
      if (!base) return null;
      const q = rawQuery ? query : query + ' company India';
      const url = `${base}/search?q=${encodeURIComponent(q)}&format=json`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return null;
      const data: any = await res.json();
      const organic = (data.results || [])
        .slice(0, 8)
        .map((o: any) => ({ title: o.title, link: o.url, snippet: o.content || '' }));
      return {
        organic,
        knowledgeGraph: null,
        rawSnippets: organic.map((o: any) => `${o.title}: ${o.snippet} (${o.link})`).join('\n'),
      };
    } catch (e) {
      this.log.warn(`SearXNG failed: ${e}`);
      return null;
    }
  }

  private async ddg(query: string, rawQuery: boolean): Promise<GoogleResult | null> {
    try {
      const q = rawQuery ? query : query + ' company India';
      const url = `https://lite.duckduckgo.com/lite/`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `q=${encodeURIComponent(q)}`,
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return null;
      const html = await res.text();
      
      const organic: { title: string; link: string; snippet: string }[] = [];
      const titleMatches = [...html.matchAll(/<a[^>]+class="result-snippet[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gi)];
      const snippetMatches = [...html.matchAll(/<td class="result-snippet">([\s\S]*?)<\/td>/gi)];
      
      for (let i = 0; i < Math.min(titleMatches.length, 8); i++) {
        const link = titleMatches[i][1];
        const title = titleMatches[i][2].replace(/<[^>]+>/g, '').trim();
        const snippetMatch = snippetMatches[i] ? snippetMatches[i][1].replace(/<[^>]+>/g, '').trim() : '';
        organic.push({ title, link, snippet: snippetMatch });
      }

      if (!organic.length) return null;

      return {
        organic,
        knowledgeGraph: null,
        rawSnippets: organic.map(o => `${o.title}: ${o.snippet} (${o.link})`).join('\n'),
      };
    } catch (e) {
      this.log.warn(`DDG failed: ${e}`);
      return null;
    }
  }
}
