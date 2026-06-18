import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, In, Repository } from 'typeorm';
import { Company } from './company.entity';
import { SearchLog } from './search-log.entity';
import { SearchService } from '../search/search.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class CompaniesService implements OnModuleInit {
  private readonly log = new Logger('Companies');

  constructor(
    @InjectRepository(Company) private repo: Repository<Company>,
    @InjectRepository(SearchLog) private logRepo: Repository<SearchLog>,
    private search: SearchService,
    private users: UsersService,
  ) {}

  /** Auto-backfill city/state for existing companies on startup. */
  async onModuleInit() {
    // run in background so it doesn't block startup
    this.backfillCityState().catch((e) =>
      this.log.warn(`City/state backfill failed: ${e}`),
    );
  }

  private slugify(name: string) {
    return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  /** Search: check cache (DB) first; else live-aggregate and seed for future use. */
  async searchAndStore(query: string, userId: string, refresh = false) {
    const slug = this.slugify(query);
    let cacheHit = false;

    // always look up the existing row (by slug, then fuzzily) so refresh UPDATES it
    // instead of inserting a duplicate slug.
    let company = await this.repo.findOne({ where: { slug } });
    if (!company) {
      const cleanQuery = query.trim();
      company = await this.repo.findOne({
        where: [
          { name: ILike(`%${cleanQuery}%`) },
          { cin: ILike(`%${cleanQuery}%`) },
        ],
      });
    }

    if (company && !refresh) {
      cacheHit = true;
    } else {
      const agg = await this.search.aggregate(query);
      const payload = this.toPayload(agg, slug);
      company = company
        ? await this.repo.save(this.repo.merge(company, payload))
        : await this.repo.save(this.repo.create(payload));
    }

    await this.users.incrementSearch(userId);
    await this.logRepo.save(
      this.logRepo.create({
        userId,
        query,
        cacheHit,
        sources: company.sources,
        companyId: company.id,
      }),
    );

    return { company, cacheHit };
  }

  /** Bulk-seed startups from Startup India records. Returns counts of new vs existing. */
  async seedFromStartupIndia(records: any[]): Promise<{ added: number; skipped: number }> {
    let added = 0;
    let skipped = 0;
    for (const r of records) {
      const name = (r.name || '').trim();
      if (!name) { skipped++; continue; }
      const slug = this.slugify(name);
      const existing = await this.repo.findOne({ where: { slug }, select: ['id'] });
      if (existing) { skipped++; continue; }
      const names = (a: any[]) => (a || []).map((x) => x?.name || x).filter(Boolean).join(', ');
      await this.repo.save(
        this.repo.create({
          name,
          slug,
          dpiitNumber: r.dippNumber || null,
          industry: names(r.industries),
          stage: names(r.stages),
          city: r.city || '',
          state: r.state || '',
          address: [r.city, r.state].filter(Boolean).join(', '),
          startupIndiaRecognised: true,
          sources: ['startup_india'],
          raw: { startupIndia: r },
        }),
      );
      added++;
    }
    return { added, skipped };
  }

  /**
   * Bulk-import external Startup India rows (from the source DB) into OUR schema.
   * Dedupes by slug (skips companies we already have). Maps source columns → our fields.
   */
  async seedExternalStartups(rows: any[]): Promise<{ added: number; skipped: number }> {
    if (!rows?.length) return { added: 0, skipped: 0 };

    // load existing slugs once for fast dedup
    const existing = new Set(
      (await this.repo.find({ select: ['slug'] })).map((c) => c.slug),
    );

    const toInsert: Partial<Company>[] = [];
    let skipped = 0;
    for (const r of rows) {
      const name = (r.company_name || '').trim();
      if (!name) { skipped++; continue; }
      const slug = this.slugify(name);
      if (!slug || existing.has(slug)) { skipped++; continue; }
      existing.add(slug);

      const social: Record<string, string> = {};
      if (r.linkedin_url) social.linkedin = r.linkedin_url;
      if (r.twitter_url) social.twitter = r.twitter_url;
      if (r.facebook_url) social.facebook = r.facebook_url;

      const emails = r.contact_email ? [String(r.contact_email).trim()] : [];
      const phones = r.contact_phone ? [String(r.contact_phone).trim()] : [];
      // only mark enriched if the source already had the CIN (full identity). Otherwise
      // leave it for enrichment so we still fetch the MCA CIN / financials.
      const alreadyEnriched = !!r.cin_real;

      toInsert.push({
        name,
        slug,
        cin: r.cin_real || null,
        website: r.website || null,
        emails,
        phones,
        address: r.contact_address || [r.city, r.state].filter(Boolean).join(', '),
        socialLinks: social,
        description: r.description || '',
        industry: r.industry || '',
        stage: r.stage || '',
        city: r.city || '',
        state: r.state || '',
        dpiitNumber: r.dipp_number || null,
        startupIndiaRecognised: r.dpiit_recognised ?? true,
        sources: ['startup_india', 'imported'],
        raw: {
          startupIndia: r.raw || { sectors: r.sector ? [r.sector] : [] },
          imported: true,
          ...(alreadyEnriched ? { enrichedAt: new Date().toISOString() } : {}),
        },
      });
    }

    // bulk insert in chunks
    let added = 0;
    for (let i = 0; i < toInsert.length; i += 100) {
      const chunk = toInsert.slice(i, i + 100);
      await this.repo.save(chunk.map((p) => this.repo.create(p)));
      added += chunk.length;
    }
    return { added, skipped };
  }

  /**
   * Bulk-import raw MCA Company Master Data rows into our schema (deduped by slug).
   * Maps ONLY genuine MCA fields — CIN, status, address, capital, class, ROC. Contacts
   * are left empty (extracted later by the background job from real sources). No fabrication.
   */
  async seedFromMca(rows: any[]): Promise<{ added: number; skipped: number }> {
    if (!rows?.length) return { added: 0, skipped: 0 };
    const existing = new Set((await this.repo.find({ select: ['slug'] })).map((c) => c.slug));
    const toInsert: Partial<Company>[] = [];
    let skipped = 0;
    for (const r of rows) {
      const name = (r.CompanyName || '').trim();
      const cin = (r.CIN || '').trim();
      if (!name || !cin) { skipped++; continue; }
      const slug = this.slugify(name);
      if (!slug || existing.has(slug)) { skipped++; continue; }
      existing.add(slug);
      toInsert.push({
        name,
        slug,
        cin,
        address: r.Registered_Office_Address || '',
        state: r.CompanyStateCode || '',
        status: r.CompanyStatus || '',
        industry: r.CompanyIndustrialClassification || '',
        authorizedCapital: r.AuthorizedCapital || '',
        paidUpCapital: r.PaidupCapital || '',
        startupIndiaRecognised: false,
        sources: ['mca', 'imported'],
        raw: { mca: r }, // genuine MCA record; NO enrichedAt → contacts extracted later
      });
    }
    let added = 0;
    for (let i = 0; i < toInsert.length; i += 200) {
      await this.repo.save(toInsert.slice(i, i + 200).map((p) => this.repo.create(p)));
      added += Math.min(200, toInsert.length - i);
    }
    return { added, skipped };
  }

  private toPayload(agg: any, slug: string): Partial<Company> {
    return {
      name: agg.name, slug, cin: agg.cin, llpin: agg.llpin, website: agg.website,
      emails: agg.emails, phones: agg.phones, founders: agg.founders, directors: agg.directors || [],
      address: agg.address, socialLinks: agg.socialLinks, description: agg.description,
      aiOverview: agg.aiOverview, sources: agg.sources, raw: agg.raw,
      startupIndiaRecognised: agg.startupIndiaRecognised, dpiitNumber: agg.dpiitNumber,
      industry: agg.industry, stage: agg.stage, status: agg.status,
      city: agg.city || '', state: agg.state || '',
      authorizedCapital: agg.authorizedCapital || '', paidUpCapital: agg.paidUpCapital || '',
    };
  }

  async findOne(id: string) {
    const c = await this.repo.findOne({ where: { id } });
    if (!c) throw new NotFoundException('Company not found');
    return c;
  }

  findByIds(ids: string[]) {
    if (!ids?.length) return [];
    return this.repo.find({ where: { id: In(ids) } });
  }

  /** Write ALL companies to a CSV at `path` in the EXACT template format
   *  (Name,CIN,LLPIN,Website,Emails,Phones,Founders,Address,Social,StartupIndia,DPIIT,
   *   Industry,Stage,MCAStatus,Sources,Description). Genuine data only. */
  async writeCsvExport(path: string): Promise<number> {
    const fs = await import('fs');
    const H = ['Name','CIN','LLPIN','Website','Emails','Phones','Founders','Address','Social',
      'StartupIndia','DPIIT','Industry','Stage','MCAStatus','Sources','Description'];
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const arr = (a: any) => (Array.isArray(a) ? a.join('; ') : '');
    const soc = (o: any) => (o && typeof o === 'object'
      ? Object.entries(o).map(([k, v]) => `${k}:${v}`).join('; ') : '');
    const tmp = `${path}.tmp`;
    fs.writeFileSync(tmp, H.join(',') + '\n');
    const PAGE = 2000;
    let off = 0, total = 0;
    for (;;) {
      const rows = await this.repo.find({ order: { updatedAt: 'DESC' }, take: PAGE, skip: off });
      if (!rows.length) break;
      const lines = rows.map((c) => [
        c.name, c.cin || '', c.llpin || '', c.website || '', arr(c.emails), arr(c.phones),
        arr(c.founders), c.address || '', soc(c.socialLinks),
        c.startupIndiaRecognised ? 'Yes' : 'No', c.dpiitNumber || '', c.industry || '',
        c.stage || '', c.status || '', arr(c.sources), c.description || '',
      ].map(esc).join(','));
      fs.appendFileSync(tmp, lines.join('\n') + '\n');
      total += rows.length;
      off += PAGE;
    }
    fs.renameSync(tmp, path); // atomic swap so readers never see a partial file
    return total;
  }

  /** Re-run live aggregation for a stored company and persist any newly found data.
   *  PRESERVES existing data: new findings are unioned in, never overwriting populated
   *  fields with empty ones (so older enriched data never vanishes). */
  private async refresh(c: Company): Promise<Company> {
    const agg = await this.search.aggregate(c.name);
    const uni = (a?: string[], b?: string[]) =>
      [...new Set([...(a || []), ...(b || [])].filter(Boolean).map((s) => String(s).trim()))];

    // Overwrite to remove old fabricated AI data with fresh pulled data
    c.cin = agg.cin;
    c.llpin = agg.llpin;
    c.website = agg.website;
    c.emails = agg.emails;
    c.phones = agg.phones;
    c.founders = agg.founders;
    c.directors = agg.directors;
    c.socialLinks = { ...(c.socialLinks || {}), ...(agg.socialLinks || {}) };
    c.address = agg.address;
    c.industry = agg.industry;
    c.stage = agg.stage;
    c.status = agg.status;
    c.city = agg.city;
    c.state = agg.state;
    c.dpiitNumber = agg.dpiitNumber;
    c.authorizedCapital = agg.authorizedCapital;
    c.paidUpCapital = agg.paidUpCapital;
    c.description = agg.description;
    c.aiOverview = agg.aiOverview;
    c.startupIndiaRecognised = c.startupIndiaRecognised || agg.startupIndiaRecognised;
    c.sources = uni(c.sources, agg.sources);
    // merge raw so prior source payloads (startupIndia, etc.) are kept alongside new ones
    c.raw = { ...(c.raw || {}), ...(agg.raw || {}), enrichedAt: new Date().toISOString() };
    return this.repo.save(c);
  }

  /** True until a company has been through full enrichment at least once. */
  needsEnrichment(c: Company): boolean {
    return !c.raw?.enrichedAt;
  }

  /** True when key fields are still missing (CIN or any contact). */
  private incomplete(c: Company): boolean {
    return !c.cin || !(c.emails?.length || c.phones?.length);
  }

  /** On-demand enrichment — refreshes when never enriched OR still missing key data,
   *  so opening a company keeps filling gaps. Preserves existing data (never wipes). */
  async enrich(id: string): Promise<Company> {
    const c = await this.findOne(id);
    return this.refresh(c);
  }

  /** Contacts-only enrichment (website + aggregator) for an identified company.
   *  Authentic, preserves existing data, stamps raw.enrichedAt. Fast (no MCA/LLM). */
  async enrichContactsOnly(c: Company, bulk = false): Promise<Company> {
    const r = await this.search.extractContacts(c.name, c.cin, c.website, !bulk);
    const uni = (a?: string[], b?: string[]) =>
      [...new Set([...(a || []), ...(b || [])].filter(Boolean).map((s) => String(s).trim()))];
    c.website = c.website || r.website;
    c.emails = uni(c.emails, r.emails);
    c.phones = uni(c.phones, r.phones);
    c.socialLinks = { ...(c.socialLinks || {}), ...r.socials };
    c.directors = uni(c.directors, r.directors);
    if (r.contactsRaw && !c.sources.includes('website')) c.sources = [...c.sources, 'website'];
    if (r.aggRaw && !c.sources.includes('aggregator')) c.sources = [...c.sources, 'aggregator'];
    // Startup India DPIIT recognition (genuine) — fills StartupIndia/DPIIT/stage; preserves existing
    const si: any = r.startupIndia;
    if (si) {
      c.startupIndiaRecognised = true;
      c.dpiitNumber = c.dpiitNumber || si.dpiitNumber || null;
      c.stage = c.stage || si.stage || '';
      c.industry = c.industry || si.industry || '';
      if (!c.sources.includes('startup_india')) c.sources = [...c.sources, 'startup_india'];
    }
    c.raw = {
      ...(c.raw || {}),
      ...(r.contactsRaw ? { contacts: r.contactsRaw } : {}),
      ...(r.aggRaw ? { aggregator: r.aggRaw } : {}),
      ...(si ? { startupIndia: si.raw || si } : {}),
      enrichedAt: new Date().toISOString(),
    };
    return this.repo.save(c);
  }

  /** Continuously cycles through companies to re-enrich and correct data in the background. */
  findUnenriched(limit: number): Promise<Company[]> {
    return this.repo
      .createQueryBuilder('c')
      .orderBy('c.updatedAt', 'ASC')
      .limit(limit)
      .getMany();
  }

  /** Cheap COUNT of un-enriched companies (no row hydration). */
  countUnenriched(): Promise<number> {
    return this.repo
      .createQueryBuilder('c')
      .where("c.raw->>'enrichedAt' IS NULL")
      .getCount();
  }

  /** Enrich a batch of un-enriched companies (background pre-fill). Returns count enriched. */
  async enrichBatch(limit: number): Promise<number> {
    const pending = await this.findUnenriched(limit);
    let done = 0;
    for (const c of pending) {
      try { await this.refresh(c); done++; } catch { /* skip on failure */ }
    }
    return done;
  }

  private norm(s: string) {
    return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  /** assemble the grounded data + provenance from a Company entity or an aggregate */
  private buildAskData(x: any) {
    return {
      name: x.name, cin: x.cin, llpin: x.llpin, status: x.status, website: x.website,
      founders: x.founders, directors: x.directors, address: x.address,
      emails: x.emails, phones: x.phones,
      socialLinks: x.socialLinks, industry: x.industry, stage: x.stage,
      dpiitNumber: x.dpiitNumber, startupIndiaRecognised: x.startupIndiaRecognised,
      description: x.description, authorizedCapital: x.authorizedCapital, paidUpCapital: x.paidUpCapital,
      mca: x.raw?.mca || null,
      startupIndia: x.raw?.startupIndia || null,
      sources: x.sources,
      cinVerifiedByMCA: !!x.raw?.mca,
      contactsVerifiedFrom: x.raw?.contacts?.scrapedFrom || [],
      contactsFromAI: !!x.raw?.contactsFromAI,
      tracxnProfile: x.raw?.tracxn?.profileUrl || null,
    };
  }

  /**
   * Grounded AI answer. The chat understands questions about ANOTHER entity named in the
   * question ("give cin OF Kashi Integrated…") and runs a fresh, genuine lookup on it.
   * For the opened company, missing CIN/contact fields trigger a live re-lookup.
   * Answers are never fabricated — verified data only.
   */
  async ask(id: string, question: string) {
    let c = await this.findOne(id);
    const q = question.toLowerCase();

    // extract a company name referenced in the question, if any
    const m = question.match(/(?:of|for|about)\s+([A-Za-z0-9 .,&()'-]{3,})$/i);
    const target = m ? m[1].replace(/[?.\s]+$/g, '').trim() : '';
    const wantsCin = /\bcin\b|llpin|registration|incorporat|\broc\b|director|capital|registered/.test(q);
    const wantsContact = /contact|e-?mail|phone|mobile|reach|call|number/.test(q);

    let source: any = c;
    if (target && this.norm(target) !== this.norm(c.name)) {
      // a different entity was named — fresh genuine lookup (MCA/website/Tracxn/AI)
      source = await this.search.aggregate(target).catch(() => null);
      if (!source) source = c;
    } else {
      const needRefresh =
        (wantsCin && !c.cin) ||
        (wantsContact && !(c.emails?.length || c.phones?.length)) ||
        /latest|fresh|update|re-?search|google/.test(q);
      if (needRefresh) {
        try { c = await this.refresh(c); source = c; } catch { /* keep existing */ }
      }
    }

    // Deterministic answers for structured questions — straight from verified data,
    // no LLM needed (works even when Groq is rate-limited). 100% genuine.
    const direct = this.directAnswer(source, q);
    const answer = direct
      || (await this.search.ask(source.name, JSON.stringify(this.buildAskData(source)), question))
      || 'No answer could be generated from the available data.';
    // return the (re-seeded) company so the modal can refresh its fields in place
    return { answer, subject: source.name, company: source?.id ? source : null };
  }

  /** Answer common factual questions directly from verified fields; null = defer to AI. */
  private directAnswer(c: any, q: string): string | null {
    const has = (a?: any[]) => Array.isArray(a) && a.length;
    if (/\bcin\b|identification number/.test(q)) {
      return c.cin
        ? `The CIN of ${c.name} is ${c.cin}${c.status ? ` (MCA status: ${c.status})` : ''}. Verified from MCA company master data.`
        : `No CIN is available for "${c.name}" in MCA / public sources.`;
    }
    if (/llpin/.test(q)) {
      return c.llpin ? `The LLPIN of ${c.name} is ${c.llpin}.` : `No LLPIN found for "${c.name}".`;
    }
    if (/contact|e-?mail|phone|mobile|reach|call|number/.test(q)) {
      const parts: string[] = [];
      if (has(c.emails)) parts.push(`Email: ${c.emails.join(', ')}`);
      if (has(c.phones)) parts.push(`Phone: ${c.phones.join(', ')}`);
      if (!parts.length)
        return `No public contact details were found for "${c.name}". (Genuine sources checked: company website, Tracxn, MCA — none expose contacts.)`;
      const src = (c.raw?.contacts?.scrapedFrom || [])[0];
      return `${parts.join('  •  ')}${src ? `\nVerified from: ${src}` : ''}`;
    }
    if (/founder/.test(q)) {
      return has(c.founders) ? `Founders of ${c.name}: ${c.founders.join(', ')}.` : `Founder details for "${c.name}" are not available in public sources.`;
    }
    if (/director/.test(q)) {
      return has(c.directors) ? `Directors of ${c.name}: ${c.directors.join(', ')}.` : `Director details for "${c.name}" are not available in the free MCA dataset.`;
    }
    if (/registered office|address|location|where/.test(q)) {
      return c.address ? `Registered office of ${c.name}: ${c.address}.` : `Address not available for "${c.name}".`;
    }
    if (/status/.test(q)) {
      return c.status ? `MCA status of ${c.name}: ${c.status}.` : `MCA status not available for "${c.name}".`;
    }
    if (/website/.test(q)) {
      return c.website ? `Website of ${c.name}: ${c.website}.` : `No verified website found for "${c.name}".`;
    }
    if (/authentic|legit|genuine|\breal\b|valid|exist/.test(q)) {
      if (c.cin) {
        return `"${c.name}" appears authentic: CIN ${c.cin} is verified in MCA company master data` +
          `${c.status ? `, current status "${c.status}"` : ''}` +
          `${c.raw?.mca?.CompanyRegistrationdate_date ? `, incorporated ${c.raw.mca.CompanyRegistrationdate_date}` : ''}` +
          `${c.address ? `, registered office on record` : ''}.`;
      }
      return `Could not verify "${c.name}" in MCA — no CIN found in the free public dataset. Treat as unverified.`;
    }
    return null;
  }

  async list(q?: string, take = 50) {
    // exclude the heavy `raw` jsonb — the table & exports don't need it; the modal
    // fetches full data per company via findOne.
    return this.repo.find({
      where: q ? [{ name: ILike(`%${q}%`) }, { cin: ILike(`%${q}%`) }] : {},
      order: { updatedAt: 'DESC' },
      take,
      select: [
        'id', 'name', 'slug', 'cin', 'llpin', 'website', 'emails', 'phones', 'founders',
        'address', 'socialLinks', 'description', 'sources', 'startupIndiaRecognised',
        'dpiitNumber', 'industry', 'stage', 'status', 'city', 'state',
        'authorizedCapital', 'paidUpCapital', 'directors', 'createdAt', 'updatedAt',
      ],
    });
    }

    async deleteBatch(ids: string[]) {
      if (!ids.length) return { deleted: 0 };
      const result = await this.repo.delete(ids);
      this.log.log(`Deleted ${result.affected || 0} companies`);
      return { deleted: result.affected || 0 };
  }

  recentSearches(userId: string, take = 20) {
    return this.logRepo.find({ where: { userId }, order: { createdAt: 'DESC' }, take });
  }

  countCompanies() {
    return this.repo.count();
  }
  countSearches() {
    return this.logRepo.count();
  }

  // ─── City/State backfill ───────────────────────────────────────────

  private static readonly INDIAN_STATES: Record<string, string> = {
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

  private static readonly MAJOR_CITIES: Record<string, string> = {
    mumbai: 'Maharashtra', bangalore: 'Karnataka', bengaluru: 'Karnataka',
    hyderabad: 'Telangana', chennai: 'Tamil Nadu', kolkata: 'West Bengal',
    pune: 'Maharashtra', ahmedabad: 'Gujarat', jaipur: 'Rajasthan',
    lucknow: 'Uttar Pradesh', noida: 'Uttar Pradesh', gurgaon: 'Haryana',
    gurugram: 'Haryana', chandigarh: 'Chandigarh', kochi: 'Kerala',
    thiruvananthapuram: 'Kerala', coimbatore: 'Tamil Nadu', indore: 'Madhya Pradesh',
    bhopal: 'Madhya Pradesh', nagpur: 'Maharashtra', visakhapatnam: 'Andhra Pradesh',
    surat: 'Gujarat', vadodara: 'Gujarat', patna: 'Bihar', ranchi: 'Jharkhand',
    bhubaneswar: 'Odisha', dehradun: 'Uttarakhand', guwahati: 'Assam',
    'new delhi': 'Delhi',
  };

  /** Parse city/state from an Indian address string using known state/city names. */
  private parseCityState(address: string): { city: string; state: string } {
    if (!address) return { city: '', state: '' };
    const lower = address.toLowerCase();
    let city = '', state = '';

    for (const [key, val] of Object.entries(CompaniesService.INDIAN_STATES)) {
      if (lower.includes(key)) { state = val; break; }
    }
    for (const [key, val] of Object.entries(CompaniesService.MAJOR_CITIES)) {
      if (lower.includes(key)) {
        city = key.charAt(0).toUpperCase() + key.slice(1);
        if (!state) state = val;
        break;
      }
    }
    return { city, state };
  }

  /**
   * Backfill city/state for all existing companies that have empty values.
   * Extracts from raw.startupIndia, raw.mca, and address — no external calls needed.
   */
  async backfillCityState(): Promise<{ updated: number; total: number }> {
    const all = await this.repo.find();
    let updated = 0;

    for (const c of all) {
      if (c.city && c.state) continue; // already populated

      const si = c.raw?.startupIndia || {};
      const mca = c.raw?.mca || {};

      // priority: Startup India > MCA state > parsed from address
      let city = c.city || si.city || '';
      let state = c.state || si.state || mca.CompanyStateCode || '';

      // try parsing from address if still missing
      if (!city || !state) {
        const addr = c.address || mca.Registered_Office_Address || '';
        const parsed = this.parseCityState(addr);
        if (!city) city = parsed.city;
        if (!state) state = parsed.state;
      }

      // also try parsing from the AI overview or description as last resort
      if (!city || !state) {
        const blob = `${c.aiOverview || ''} ${c.description || ''}`;
        const parsed = this.parseCityState(blob);
        if (!city) city = parsed.city;
        if (!state) state = parsed.state;
      }

      if (city !== (c.city || '') || state !== (c.state || '')) {
        c.city = city;
        c.state = state;
        await this.repo.save(c);
        updated++;
        this.log.log(`Backfilled city/state for "${c.name}": ${city || '?'}, ${state || '?'}`);
      }
    }

    this.log.log(`City/state backfill complete: ${updated}/${all.length} updated`);
    return { updated, total: all.length };
  }
}
