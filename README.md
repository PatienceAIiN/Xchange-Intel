# Nexus — Company Intelligence SaaS

Search any Indian startup or company and get a consolidated, **multi-source, validated**
public-data profile: **Startup India (DPIIT)** → **MCA Company Master Data** →
**Wikipedia / Wikidata** → **AI Overview** (synthesised by Groq), all merged,
de-duplicated, cached in PostgreSQL, and exportable (PDF / CSV / Excel / JSON).

## Stack
- **Backend:** NestJS 10 + TypeORM + PostgreSQL (Neon) + JWT auth + `@nestjs/throttler` rate limiting
- **Frontend:** React 18 + Vite + Material UI (Material Design dashboard, click-to-open modal)
- **LLM:** Groq (`llama-3.1-8b-instant`) for the AI Overview & structured extraction
- **Infra:** Docker / docker-compose, Redis (scaffolded)

## Data sources & flow (`backend/src/search`)
Per search, the orchestrator fans out **in parallel** (for speed), then merges with
authority precedence `MCA > Startup India > Wikidata > Google KG > regex > AI`:

1. **Startup India** — live public DPIIT search API; fuzzy name match gated by
   `MATCH_CONFIDENCE_THRESHOLD`. Covers thousands of registered startups with no Wikipedia page.
2. **MCA** — Ministry of Corporate Affairs *Company Master Data* on data.gov.in (~3.67M companies).
   Exact-name match (with legal-suffix variants) **and** authoritative lookup by CIN once one
   is discovered. Gives CIN, status, registered office, capital, ROC, classification.
3. **Wikipedia + Wikidata** — free, reliable structured facts (website, founders, inception,
   HQ, social handles) — the same data behind Google's Knowledge Panel.
4. **Groq AI Overview** — always runs, so **any** company name yields a Google-style overview;
   identifiers (CIN/LLPIN/emails/phones) are only taken from real source text, never invented.

> **Honest limitations:** The free MCA dataset is a partial snapshot and brand→legal-name is
> not always resolvable (the data.gov API has no fuzzy search) — search the exact legal name for
> guaranteed MCA enrichment. The official MCA portal and Google SERP have no free API; SerpAPI is
> supported but optional (`USE_PAID_SEARCH=true`).

## Run locally
```bash
# 1. Configure (already provided for local dev)
cp .env .env   # edit DATABASE_URL / GROQ_API_KEY etc. as needed

# 2. Backend  (http://localhost:3001/api)
cd backend && npm install && npm run build && npm start

# 3. Frontend (http://localhost:5173)
cd frontend && npm install && npm run dev
```
First registered user becomes **admin**. Open the dashboard, search a company, click a row to
open the detail modal (with the **AI Overview**), and export.

### Docker
```bash
docker compose up --build      # frontend :5173, backend :3001, redis :6379
```
Postgres is hosted on Neon (see `DATABASE_URL`); no local PG container needed.

## API (prefix `/api`)
| Method | Route | Auth | Notes |
|---|---|---|---|
| POST | `/auth/signup` `/auth/login` | — | JWT; rate-limited (`RATE_LIMIT_AUTH`) |
| GET  | `/auth/me` | JWT | |
| POST | `/companies/search` | JWT | `{query, refresh?}` — cache-first, seeds DB |
| GET  | `/companies` `/companies/:id` `/companies/recent` | JWT | |
| GET  | `/export/:id?format=pdf\|csv\|excel\|json` | JWT | |
| GET  | `/admin/stats` `/admin/users` ; PATCH `/admin/users/:id/toggle` | admin | |

## Security & compliance
- bcrypt(12) password hashing, JWT access tokens, role guard for admin
- Per-route rate limiting (auth / default / scraper tiers)
- Global `ValidationPipe` (whitelist + forbid unknown), CORS allow-list
- **DPDP / GDPR:** explicit consent required & timestamped at signup; only public data is aggregated
- Secrets via `.env` (gitignored)

## Tests
```bash
cd backend && npm test     # export service: CSV / JSON / XLSX / PDF
```
