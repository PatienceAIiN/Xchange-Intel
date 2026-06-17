import { Injectable, Logger } from '@nestjs/common';

export interface AiExtract {
  aiOverview: string;
  cin: string | null;
  llpin: string | null;
  website: string | null;
  emails: string[];
  phones: string[];
  founders: string[];
  directors: string[];
  address: string;
  socialLinks: Record<string, string>;
  description: string;
  authorizedCapital: string;
  paidUpCapital: string;
}

/**
 * Groq (OpenAI-compatible) LLM. Generates a Google-AI-Overview-style summary
 * and extracts structured company fields from collected search snippets.
 */
@Injectable()
export class GroqProvider {
  private readonly log = new Logger('Groq');

  /**
   * Suggest the likely exact MCA legal name(s) and CIN for a query. These are CANDIDATES
   * only — the caller MUST verify them against MCA before trusting them.
   */
  async resolveIdentity(query: string): Promise<{ legalNames: string[]; cin: string | null } | null> {
    const key = process.env.GROQ_API_KEY;
    if (!key) return null;
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                'For an Indian company/entity, return JSON {"legalNames":[up to 4 EXACT ' +
                'MCA-registered legal names in UPPERCASE incl. suffix like PRIVATE LIMITED / ' +
                'LIMITED / FOUNDATION / LLP], "cin": "<21-char CIN or null>"}. These are ' +
                'best guesses to be verified against MCA — output null cin if unsure.',
            },
            { role: 'user', content: `Entity: ${query}` },
          ],
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return null;
      const data: any = await res.json();
      const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');
      return {
        legalNames: Array.isArray(parsed.legalNames) ? parsed.legalNames.slice(0, 4) : [],
        cin: typeof parsed.cin === 'string' && parsed.cin.length === 21 ? parsed.cin.toUpperCase() : null,
      };
    } catch {
      return null;
    }
  }

  /** Grounded Q&A: answer a user question about a company using its collected data. */
  async ask(companyName: string, contextJson: string, question: string): Promise<string | null> {
    const key = process.env.GROQ_API_KEY;
    if (!key) return null;
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
          temperature: 0.2,
          messages: [
            {
              role: 'system',
              content:
                'You answer questions about an Indian company using ONLY the provided JSON data. ' +
                'Be concise. Rules: ' +
                '(1) For CIN/LLPIN/emails/phones, return ONLY values present in the data — never ' +
                'invent them; if absent, say it is not available in public sources. ' +
                '(2) When asked for contact details, list the emails/phones and cite where they ' +
                'were verified from (contactsVerifiedFrom URLs / tracxnProfile). ' +
                '(3) When asked about authenticity/legitimacy, judge from: cinVerifiedByMCA, the ' +
                "MCA CompanyStatus (e.g. 'Active' vs 'Strike Off'), incorporation date, registered " +
                'office, DPIIT recognition, and which sources corroborate it — state your reasoning. ' +
                '(4) Distinguish MCA-verified facts from AI-summarised ones.',
            },
            {
              role: 'user',
              content: `Company: ${companyName}\nData:\n${contextJson.slice(0, 6000)}\n\nQuestion: ${question}`,
            },
          ],
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) return null;
      const data: any = await res.json();
      return data.choices?.[0]?.message?.content?.trim() || null;
    } catch (e) {
      this.log.warn(`Groq ask failed: ${e}`);
      return null;
    }
  }

  async extract(companyName: string, context: string): Promise<AiExtract | null> {
    const key = process.env.GROQ_API_KEY;
    if (!key) return null;

    const sys =
      'You are a precise company-intelligence extractor for Indian companies. ' +
      'Return STRICT JSON only (no markdown). Base ALL fields including CIN, LLPIN, emails, phones, founders, address, directors ONLY on the ' +
      'provided context. NEVER invent them or use outside knowledge. If absent in context, return null/empty. You may use public knowledge ONLY for aiOverview and description.';
    const user =
      `Company: "${companyName}"\n\nSearch context:\n${context.slice(0, 6000)}\n\n` +
      `Return JSON with exactly these keys: aiOverview (2-4 sentence neutral summary like an ` +
      `AI Web Overview), cin, llpin, website, emails (array), phones (array), ` +
      `founders (array), directors (array of director names from MCA/public records), ` +
      `address (string — registered address), socialLinks (object: keys like linkedin, twitter, ` +
      `facebook, instagram), description (string), ` +
      `authorizedCapital (string — e.g. "500000" or null), paidUpCapital (string — e.g. "50000" or null). ` +
      `Extract ALL available data from the context — especially CIN, directors, emails, phones, capital figures.`;

    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
          temperature: 0.1,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: user },
          ],
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        this.log.warn(`Groq ${res.status}: ${await res.text()}`);
        return null;
      }
      const data: any = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) return null;
      const parsed = JSON.parse(content);
      return {
        aiOverview: parsed.aiOverview || '',
        cin: parsed.cin || null,
        llpin: parsed.llpin || null,
        website: parsed.website || null,
        emails: Array.isArray(parsed.emails) ? parsed.emails : [],
        phones: Array.isArray(parsed.phones) ? parsed.phones : [],
        founders: Array.isArray(parsed.founders) ? parsed.founders : [],
        directors: Array.isArray(parsed.directors) ? parsed.directors : [],
        address: parsed.address || '',
        socialLinks: parsed.socialLinks || {},
        description: parsed.description || '',
        authorizedCapital: parsed.authorizedCapital || '',
        paidUpCapital: parsed.paidUpCapital || '',
      };
    } catch (e) {
      this.log.warn(`Groq extract failed: ${e}`);
      return null;
    }
  }
}
