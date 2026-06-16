import { Injectable, Logger } from '@nestjs/common';
import { StartupIndiaProvider } from './providers/startupindia.provider';
import { McaProvider } from './providers/mca.provider';
import { GoogleProvider } from './providers/google.provider';
import { WikiProvider } from './providers/wiki.provider';
import { WebsiteProvider } from './providers/website.provider';
import { ContactProvider } from './providers/contact.provider';
import { AggregatorProvider } from './providers/aggregator.provider';
import { TracxnProvider } from './providers/tracxn.provider';
import { GroqProvider } from './providers/groq.provider';

// Indian CIN: U/L + 5-digit industry + 2-letter state + 4-digit year + 3-letter type + 6-digit reg
const CIN_RE = /\b([LUu]\d{5}[A-Za-z]{2}\d{4}[A-Za-z]{3}\d{6})\b/;
const LLPIN_RE = /\b([A-Za-z]{3}-\d{4})\b/;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(?:\+91[-\s]?)?[6-9]\d{9}\b/g;

export interface AggregatedCompany {
  name: string;
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
  aiOverview: string;
  sources: string[];
  startupIndiaRecognised: boolean;
  dpiitNumber: string | null;
  industry: string;
  stage: string;
  status: string;
  city: string;
  state: string;
  authorizedCapital: string;
  paidUpCapital: string;
  raw: Record<string, any>;
}

@Injectable()
export class SearchService {
  private readonly log = new Logger('Search');

  constructor(
    private startupIndia: StartupIndiaProvider,
    private mca: McaProvider,
    private google: GoogleProvider,
    private wiki: WikiProvider,
    private websiteResolver: WebsiteProvider,
    private contact: ContactProvider,
    private aggregator: AggregatorProvider,
    private tracxn: TracxnProvider,
    private groq: GroqProvider,
  ) {}

  /**
   * Multi-source aggregation, optimised for speed (parallel fan-out) and honesty:
   *   Phase A (parallel): Startup India (DPIIT) · MCA by name · Wikipedia+Wikidata · Google
   *   Phase B: if a CIN surfaced anywhere, fetch the authoritative MCA record by CIN
   *   Phase C: Groq synthesises the AI Overview from all collected real evidence
   *   Phase D: Deep auto-search — targeted Google queries for missing CIN / contacts,
   *            then MCA-validate any discovered CIN and website-verify contacts.
   * Field precedence: MCA (authoritative) > Startup India > Wikidata > Google KG > regex > AI.
   */
  async aggregate(name: string): Promise<AggregatedCompany> {
    const sources: string[] = [];
    const raw: Record<string, any> = {};

    // ---- Phase A: fan out independent sources concurrently ----
    const [si, mcaByName, w, g, tx] = await Promise.all([
      this.startupIndia.lookup(name).catch(() => null),
      this.mca.byName(name).catch(() => null),
      this.wiki.lookup(name).catch(() => null),
      this.google.search(name).catch(() => ({ organic: [], knowledgeGraph: null, rawSnippets: '' })),
      this.tracxn.lookup(name).catch(() => null),
    ]);

    if (si) { sources.push('startup_india'); raw.startupIndia = si.raw; }
    if (tx) { sources.push('tracxn'); raw.tracxn = tx; }
    if (w) {
      sources.push('wikipedia');
      if (w.website || w.founders.length || Object.keys(w.socialLinks).length) sources.push('wikidata');
      raw.wiki = w;
    }
    if (g.organic.length || g.knowledgeGraph) {
      sources.push('google');
      raw.google = { organic: g.organic, knowledgeGraph: g.knowledgeGraph };
    }

    // CIN discovery from any text source (Wikidata/Wikipedia snippets, Google, SI)
    const preBlob = [w?.snippets, g.rawSnippets, si ? JSON.stringify(si.raw) : ''].filter(Boolean).join('\n');
    let cinMatch = preBlob.match(CIN_RE)?.[1] || null;
    const llpinMatch = preBlob.match(LLPIN_RE)?.[1] || null;

    // ---- Phase B: authoritative MCA record (by name hit, else by discovered CIN) ----
    let mca = mcaByName;
    if (!mca && cinMatch) mca = await this.mca.byCin(cinMatch).catch(() => null);
    // AI-assisted resolution: when no direct MCA hit, let the AI suggest the legal name/CIN,
    // then CONFIRM it against MCA (authoritative). Only MCA-verified results are accepted.
    if (!mca) {
      const idr = await this.groq.resolveIdentity(name).catch(() => null);
      if (idr) {
        if (idr.cin) mca = await this.mca.byCin(idr.cin).catch(() => null);
        if (!mca) {
          for (const ln of idr.legalNames) {
            mca = await this.mca.byName(ln).catch(() => null);
            if (mca) break;
          }
        }
        if (mca) raw.identityResolver = idr;
      }
    }
    if (mca) { sources.push('mca'); raw.mca = mca.raw; }

    // resolve the official website now so contacts can be scraped from the real site;
    // if no source provided one, verify a name-derived domain (never fabricated).
    const kg = g.knowledgeGraph || {};
    let website = w?.website || kg.website || tx?.website || this.firstSiteLink(g) || null;
    if (!website) website = await this.websiteResolver.resolve(name).catch(() => null);

    // ---- Phase C (parallel): AI Overview narrative + genuine contact scraping ----
    const context = [
      mca ? `MCA record: ${JSON.stringify(mca.raw)}` : '',
      si ? `Startup India record: ${JSON.stringify(si.raw)}` : '',
      g.rawSnippets,
      w?.snippets || '',
      tx ? `Tracxn: ${JSON.stringify(tx)}` : '',
    ].filter(Boolean).join('\n');
    const ai = await this.groq.extract(name, context).catch(() => null);
    if (ai) { sources.push('ai'); raw.ai = ai; }
    // AI-mentioned contacts (from structured fields + the overview text) become
    // candidates that the scraper VERIFIES against the real website before use.
    const aiText = `${ai?.aiOverview || ''}\n${ai?.description || ''}`;
    const candidates = {
      emails: this.uniq([...(ai?.emails || []), ...(aiText.match(EMAIL_RE) || [])]),
      phones: this.uniq([...(ai?.phones || []), ...(aiText.match(PHONE_RE) || [])]),
    };
    let contacts = await this.contact.scrape(website, candidates).catch(() => null);
    if (contacts) { sources.push('website'); raw.contacts = contacts; }

    // Registry-aggregator contacts (IndiaFilings / TheCompanyCheck) — genuine MCA-derived
    // emails/phones/directors, the same public sources Google's AI Overview cites.
    const aggRes = await this.aggregator.lookup(name, mca?.cin || cinMatch).catch(() => null);
    if (aggRes) { sources.push('aggregator'); raw.aggregator = aggRes; }

    // Tracxn contacts are a genuine (non-AI) source — merge directly with provenance.
    const txEmails = tx?.emails || [];
    const txPhones = tx?.phones || [];
    const aggEmails = aggRes?.emails || [];
    const aggPhones = aggRes?.phones || [];
    const aggDirectors = aggRes?.directors || [];

    // ---- Phase D: Deep auto-search for missing CIN, contacts, and company details ----
    const hasCin = !!(mca?.cin || cinMatch);
    const hasContacts = !!(contacts?.emails?.length || contacts?.phones?.length || txEmails.length || txPhones.length || aggEmails.length || aggPhones.length);
    const hasDirectors = !!(ai?.directors?.length);
    const hasWebsite = !!website;
    const needsFollowup = !hasCin || !hasContacts || !hasDirectors || !hasWebsite;

    // Phase D relies on a working Google search engine. With USE_PAID_SEARCH=false the
    // only option is SearXNG (bot-walled / failing), so skip it to avoid 15s×N timeouts —
    // the registry aggregator + website scrape already supply genuine contacts.
    if (needsFollowup && process.env.USE_PAID_SEARCH === 'true') {
      const deepSearches: Promise<any>[] = [];

      // targeted CIN search
      if (!hasCin) {
        deepSearches.push(
          this.google.search(`${name} CIN number India MCA registration`).catch(() => ({ organic: [], knowledgeGraph: null, rawSnippets: '' })),
        );
        deepSearches.push(
          this.google.search(`"${name}" corporate identification number site:zaubacorp.com OR site:tofler.in`).catch(() => ({ organic: [], knowledgeGraph: null, rawSnippets: '' })),
        );
      } else {
        deepSearches.push(Promise.resolve(null), Promise.resolve(null));
      }

      // targeted contact search
      if (!hasContacts) {
        deepSearches.push(
          this.google.search(`${name} contact email phone number India`).catch(() => ({ organic: [], knowledgeGraph: null, rawSnippets: '' })),
        );
        deepSearches.push(
          this.google.search(`What is the contact email address and phone number for ${name}?`, true).catch(() => ({ organic: [], knowledgeGraph: null, rawSnippets: '' })),
        );
      } else {
        deepSearches.push(Promise.resolve(null), Promise.resolve(null));
      }

      // comprehensive company details search (directors, capital, registration)
      if (!hasDirectors || !hasCin || !hasWebsite) {
        deepSearches.push(
          this.google.search(`"${name}" directors registered address authorized capital email website India`).catch(() => ({ organic: [], knowledgeGraph: null, rawSnippets: '' })),
        );
      } else {
        deepSearches.push(Promise.resolve(null));
      }

      const [deepCin1, deepCin2, deepContact1, deepContact2, deepDetails] = await Promise.all(deepSearches);

      // If we got additional company details, re-run AI extraction with enriched context
      if (deepDetails?.rawSnippets || deepContact1?.rawSnippets || deepContact2?.rawSnippets || deepCin1?.rawSnippets) {
        const enrichedContext = [
          context,
          deepDetails?.rawSnippets ? `Additional details:\n${deepDetails.rawSnippets}` : '',
          deepContact1?.rawSnippets ? `Contact results:\n${deepContact1.rawSnippets}` : '',
          deepContact2?.rawSnippets ? `Contact results (direct QA):\n${deepContact2.rawSnippets}` : '',
          deepCin1?.rawSnippets ? `CIN results:\n${deepCin1.rawSnippets}` : '',
          deepCin2?.rawSnippets ? `CIN results:\n${deepCin2.rawSnippets}` : '',
        ].filter(Boolean).join('\n');
        const aiFollowup = await this.groq.extract(name, enrichedContext).catch(() => null);
        if (aiFollowup) {
          raw.aiFollowup = aiFollowup;
          if (ai) {
            if (!ai.directors?.length && aiFollowup.directors?.length) ai.directors = aiFollowup.directors;
            if (!ai.cin && aiFollowup.cin) ai.cin = aiFollowup.cin;
            if (!ai.website && aiFollowup.website) ai.website = aiFollowup.website;
            if (!ai.emails?.length && aiFollowup.emails?.length) ai.emails = aiFollowup.emails;
            if (!ai.phones?.length && aiFollowup.phones?.length) ai.phones = aiFollowup.phones;
            if (!ai.address && aiFollowup.address) ai.address = aiFollowup.address;
            if (!ai.authorizedCapital && aiFollowup.authorizedCapital) ai.authorizedCapital = aiFollowup.authorizedCapital;
            if (!ai.paidUpCapital && aiFollowup.paidUpCapital) ai.paidUpCapital = aiFollowup.paidUpCapital;
            if (!ai.founders?.length && aiFollowup.founders?.length) ai.founders = aiFollowup.founders;
            if (aiFollowup.socialLinks) ai.socialLinks = { ...(aiFollowup.socialLinks || {}), ...(ai.socialLinks || {}) };
            raw.ai = ai;
          }
          if (!website && aiFollowup.website) website = aiFollowup.website;
          // Try CIN from follow-up AI
          if (!cinMatch && aiFollowup.cin) {
            const followCinMatch = aiFollowup.cin.match(CIN_RE)?.[0];
            if (followCinMatch) {
              const verified = await this.mca.byCin(followCinMatch).catch(() => null);
              if (verified) {
                mca = verified;
                cinMatch = followCinMatch;
                if (!sources.includes('mca')) sources.push('mca');
                raw.mca = verified.raw;
                raw.deepSearchCin = true;
              }
            }
          }
          this.log.log(`Follow-up AI extraction completed for "${name}"`);
        }
      }

      // extract CIN from deep search results and validate against MCA
      if (!hasCin && !cinMatch) {
        const deepCinBlob = [
          deepCin1?.rawSnippets || '',
          deepCin2?.rawSnippets || '',
          deepDetails?.rawSnippets || '',
        ].join('\n');
        const deepCinCandidates = [...deepCinBlob.matchAll(new RegExp(CIN_RE, 'g'))].map(m => m[1]);
        for (const candidate of [...new Set(deepCinCandidates)]) {
          const verified = await this.mca.byCin(candidate).catch(() => null);
          if (verified) {
            const verifiedName = (verified.companyName || '').toLowerCase();
            const queryName = name.toLowerCase().replace(/private|limited|pvt|ltd|llp|technologies|technology|solutions|services|india|inc|corp/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
            const matchWords = queryName.split(' ').filter(w => w.length > 2);
            const nameMatches = matchWords.some(w => verifiedName.includes(w));
            if (nameMatches) {
              mca = verified;
              cinMatch = candidate;
              if (!sources.includes('mca')) sources.push('mca');
              raw.mca = verified.raw;
              raw.deepSearchCin = true;
              this.log.log(`Deep search found verified CIN ${candidate} for "${name}"`);
              break;
            }
          }
        }
      }

      let deepEmails: string[] = [];
      let deepPhones: string[] = [];

      // extract contacts from deep search results and verify against website
      if (!hasContacts && (deepContact1 || deepContact2)) {
        const deepContactBlob = [deepContact1?.rawSnippets, deepContact2?.rawSnippets].filter(Boolean).join('\n');
        deepEmails = this.uniq((deepContactBlob.match(EMAIL_RE) || []).filter(
          (e: string) => !/example|sentry|wixpress|schema\.org|w3\.org/i.test(e),
        ));
        deepPhones = this.uniq(deepContactBlob.match(PHONE_RE) || []);

        if (website && (deepEmails.length || deepPhones.length)) {
          const deepCandidates = { emails: deepEmails, phones: deepPhones };
          const deepVerified = await this.contact.scrape(website, deepCandidates).catch(() => null);
          if (deepVerified && (deepVerified.emails.length || deepVerified.phones.length)) {
            contacts = deepVerified;
            if (!sources.includes('website')) sources.push('website');
            raw.contacts = deepVerified;
            raw.deepSearchContacts = true;
            this.log.log(`Deep search found verified contacts for "${name}"`);
          }
        }
        if (!website) {
          const deepSiteLink = this.firstSiteLink(deepContact1) || this.firstSiteLink(deepContact2);
          if (deepSiteLink) {
            website = deepSiteLink;
            const deepCandidates = { emails: deepEmails, phones: deepPhones };
            const deepVerified = await this.contact.scrape(website, deepCandidates).catch(() => null);
            if (deepVerified && (deepVerified.emails.length || deepVerified.phones.length)) {
              contacts = deepVerified;
              if (!sources.includes('website')) sources.push('website');
              raw.contacts = deepVerified;
              raw.deepSearchContacts = true;
              this.log.log(`Deep search discovered website ${website} and contacts for "${name}"`);
            }
          }
        }
      }

      // NOTE: no AI-fabricated fallback. Contacts are only kept when they come from a
      // genuine source (the company's own website, Tracxn, or a Google AI Overview
      // reference) — never invented by the LLM. If none exist publicly, we show none.
    }

    // Contacts come ONLY from the company's own website scrape, so every email/phone
    // carries a verifiable source URL (raw.contacts.scrapedFrom). Never from the LLM.
    const siAddress = si ? [si.city, si.state].filter(Boolean).join(', ') : '';

    // ---- City / State extraction ----
    // Priority: Startup India > MCA state > parsed from address
    let city = si?.city || '';
    let state = si?.state || mca?.state || '';
    if (!city || !state) {
      const addr = mca?.address || w?.headquarters || kg.address || ai?.address || '';
      const parsed = this.parseCityState(addr);
      if (!city) city = parsed.city;
      if (!state) state = parsed.state;
    }

    // Directors: from MCA data (most authoritative), then AI extraction
    const mcaDirectors: string[] = [];
    if (mca?.raw?.directors) {
      const dirs = Array.isArray(mca.raw.directors) ? mca.raw.directors : [];
      for (const d of dirs) {
        const dName = typeof d === 'string' ? d : d?.name || d?.DIN_Name || '';
        if (dName) mcaDirectors.push(dName);
      }
    }

    const merged: AggregatedCompany = {
      name: mca?.companyName || si?.name || w?.title || name,
      cin: (mca?.cin || cinMatch) ?? null,
      llpin: llpinMatch ?? null,
      website,
      emails: this.uniq([...(contacts?.emails || []), ...aggEmails, ...txEmails]),
      phones: this.uniq([...(contacts?.phones || []), ...aggPhones, ...txPhones]),
      founders: this.uniq([...(w?.founders || []), ...this.kgFounders(kg), ...(tx?.founders || [])]).filter((n) => this.isPersonName(n)),
      directors: this.uniq([...mcaDirectors, ...aggDirectors, ...(ai?.directors || [])]).filter((n) => this.isPersonName(n)),
      address: mca?.address || w?.headquarters || siAddress || kg.address || ai?.address || '',
      socialLinks: { ...this.kgSocial(kg), ...(w?.socialLinks || {}), ...(contacts?.socials || {}), ...(ai?.socialLinks || {}) },
      description: w?.description || kg.description || ai?.description || '',
      aiOverview: ai?.aiOverview || w?.description || kg.description || '',
      sources: this.uniq(sources),
      startupIndiaRecognised: !!si,
      dpiitNumber: si?.dpiitNumber || null,
      industry: si?.industry || mca?.classification || '',
      stage: si?.stage || '',
      status: mca?.status || '',
      city,
      state,
      authorizedCapital: mca?.raw?.AuthorizedCapital || ai?.authorizedCapital || '',
      paidUpCapital: mca?.raw?.PaidupCapital || ai?.paidUpCapital || '',
      raw,
    };
    this.log.log(`Aggregated "${name}" from [${merged.sources.join(', ') || 'none'}]`);
    return merged;
  }

  /** Grounded AI Q&A about a company (used by the modal's Ask bar). */
  ask(name: string, dataJson: string, question: string) {
    return this.groq.ask(name, dataJson, question);
  }

  private firstSiteLink(g: { organic: { link: string }[] } | null | undefined): string | null {
    if (!g || !g.organic) return null;
    const skip = /wikipedia|linkedin|crunchbase|zaubacorp|tofler|facebook|twitter|instagram|indiamart|justdial|ambitionbox|glassdoor|99corporates|cleartax|instancial|thecompanycheck|economictimes|pitchbook|bloomberg|youtube|medium|corpdir|companydetails|tracxn|ycombinator|owler|zoominfo|apollo|lusha|signalhire|dnb\.com|tradeindia|exportersindia|quora|fundoodata|vccircle|entreprenuer|g2\.com|capterra|trustpilot|indeed|naukri|moneycontrol|quickcompany|vakilsearch|indiafilings|sulekha|dialme|yellowpages|yelp|mca\.gov|startupindia|upwork|fiverr|freelancer|owler|goodfirms|clutch\.co|b2b/i;
    
    const hit = g.organic.find((o) => {
      try {
        const url = new URL(o.link);
        if (skip.test(url.hostname)) return false;
        // Official sites usually rank their homepage or a very short path
        if (url.pathname.length > 25) return false;
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts.length > 2) return false;
        return true;
      } catch {
        return false;
      }
    });
    return hit ? new URL(hit.link).origin : null;
  }
  private kgFounders(kg: any): string[] {
    if (kg.founders) return Array.isArray(kg.founders) ? kg.founders : [kg.founders];
    if (kg.founder) return [kg.founder];
    return [];
  }
  private kgSocial(kg: any): Record<string, string> {
    const out: Record<string, string> = {};
    (kg.profiles || []).forEach((p: any) => {
      if (p.name && p.link) out[p.name.toLowerCase()] = p.link;
    });
    return out;
  }
  /** true only for plausible person names (2-4 capitalised words), filters LLM sentences. */
  private isPersonName(s: string): boolean {
    if (!s || s.length > 40) return false;
    if (/not available|context|unknown|n\/a|director|provided/i.test(s)) return false;
    return /^[A-Z][a-zA-Z.]*(?:\s[A-Z][a-zA-Z.]*){1,3}$/.test(s.trim());
  }

  private uniq(arr: string[]): string[] {
    return [
      ...new Set(
        arr
          .filter(Boolean)
          .map((s) => String(s).trim())
          .filter((s) => s && !/^(null|undefined|n\/a|-)$/i.test(s)),
      ),
    ];
  }

  /** Best-effort city/state extraction from an Indian address string. */
  private parseCityState(address: string): { city: string; state: string } {
    if (!address) return { city: '', state: '' };

    const INDIAN_STATES: Record<string, string> = {
      'andhra pradesh': 'Andhra Pradesh', 'arunachal pradesh': 'Arunachal Pradesh',
      assam: 'Assam', bihar: 'Bihar', chhattisgarh: 'Chhattisgarh', goa: 'Goa',
      gujarat: 'Gujarat', haryana: 'Haryana', 'himachal pradesh': 'Himachal Pradesh',
      jharkhand: 'Jharkhand', karnataka: 'Karnataka', kerala: 'Kerala',
      'madhya pradesh': 'Madhya Pradesh', maharashtra: 'Maharashtra', manipur: 'Manipur',
      meghalaya: 'Meghalaya', mizoram: 'Mizoram', nagaland: 'Nagaland', odisha: 'Odisha',
      punjab: 'Punjab', rajasthan: 'Rajasthan', sikkim: 'Sikkim', 'tamil nadu': 'Tamil Nadu',
      telangana: 'Telangana', tripura: 'Tripura', 'uttar pradesh': 'Uttar Pradesh',
      uttarakhand: 'Uttarakhand', 'west bengal': 'West Bengal',
      delhi: 'Delhi', 'new delhi': 'Delhi', chandigarh: 'Chandigarh',
      'jammu and kashmir': 'Jammu and Kashmir', 'jammu & kashmir': 'Jammu and Kashmir',
      ladakh: 'Ladakh', puducherry: 'Puducherry', pondicherry: 'Puducherry',
      'andaman and nicobar': 'Andaman and Nicobar', 'dadra and nagar haveli': 'Dadra and Nagar Haveli',
      'daman and diu': 'Daman and Diu', lakshadweep: 'Lakshadweep',
    };

    const MAJOR_CITIES: Record<string, string> = {
      mumbai: 'Maharashtra', bangalore: 'Karnataka', bengaluru: 'Karnataka',
      hyderabad: 'Telangana', chennai: 'Tamil Nadu', kolkata: 'West Bengal',
      pune: 'Maharashtra', ahmedabad: 'Gujarat', jaipur: 'Rajasthan',
      lucknow: 'Uttar Pradesh', noida: 'Uttar Pradesh', gurgaon: 'Haryana',
      gurugram: 'Haryana', chandigarh: 'Chandigarh', kochi: 'Kerala',
      thiruvananthapuram: 'Kerala', coimbatore: 'Tamil Nadu', indore: 'Madhya Pradesh',
      bhopal: 'Madhya Pradesh', nagpur: 'Maharashtra', visakhapatnam: 'Andhra Pradesh',
      surat: 'Gujarat', vadodara: 'Gujarat', patna: 'Bihar', ranchi: 'Jharkhand',
      bhubaneswar: 'Odisha', dehradun: 'Uttarakhand', guwahati: 'Assam',
      new_delhi: 'Delhi',
    };

    const lower = address.toLowerCase();
    let city = '';
    let state = '';

    // try to find state
    for (const [key, val] of Object.entries(INDIAN_STATES)) {
      if (lower.includes(key)) { state = val; break; }
    }

    // try to find city
    for (const [key, val] of Object.entries(MAJOR_CITIES)) {
      const searchKey = key.replace(/_/g, ' ');
      if (lower.includes(searchKey)) {
        city = searchKey.charAt(0).toUpperCase() + searchKey.slice(1);
        if (!state) state = val;
        break;
      }
    }

    return { city, state };
  }
}
