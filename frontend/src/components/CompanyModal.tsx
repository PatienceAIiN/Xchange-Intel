import {
  Dialog, DialogTitle, DialogContent, IconButton, Typography, Chip, Stack,
  Box, Divider, Link, Button, Menu, MenuItem, Tooltip, Avatar, TextField, CircularProgress,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DownloadIcon from '@mui/icons-material/Download';
import VerifiedIcon from '@mui/icons-material/Verified';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import EmailIcon from '@mui/icons-material/Email';
import PhoneIcon from '@mui/icons-material/Phone';
import SendIcon from '@mui/icons-material/Send';
import { useState, useEffect } from 'react';
import { api, Company } from '../api';

const FORMATS = [
  { key: 'pdf', label: 'PDF' },
  { key: 'csv', label: 'CSV' },
  { key: 'excel', label: 'Excel' },
  { key: 'json', label: 'JSON' },
];

// ---- formatting helpers ----
const toName = (v: any): string => {
  if (Array.isArray(v)) return v.map(toName).filter(Boolean).join(', ');
  if (v && typeof v === 'object') return v.name != null ? String(v.name) : '';
  return v != null ? String(v) : '';
};

function inr(raw?: string): string {
  if (!raw) return '';
  const n = Number(raw);
  if (!isFinite(n) || n === 0) return '';
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function fmtDate(d?: string | number): string {
  if (d == null || d === '') return '';
  let t: number;
  if (typeof d === 'number' || /^\d{10,13}$/.test(String(d))) {
    let n = Number(d);
    if (n < 1e12) n *= 1000; // epoch seconds -> ms
    t = n;
  } else {
    t = Date.parse(String(d));
  }
  if (isNaN(t)) return String(d);
  return new Date(t).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function getGoogleAiOverview(c: Company): string {
  return [
    c.aiOverview,
    c.raw?.ai?.aiOverview,
    c.raw?.aiFollowup?.aiOverview,
    c.description,
    c.raw?.wiki?.description,
    c.raw?.google?.knowledgeGraph?.description,
  ].find((v) => typeof v === 'string' && v.trim())?.trim() || '';
}

interface CardDef { icon: string; label: string; value: string; }

/** Build the card list from genuine sources only — empty values are dropped. */
function buildCards(c: Company): CardDef[] {
  const mca = c.raw?.mca || {};
  const si = c.raw?.startupIndia || {};
  const cards: CardDef[] = [
    // identity (MCA — authoritative)
    { icon: '🆔', label: 'CIN', value: c.cin || '' },
    { icon: '🧾', label: 'LLPIN', value: c.llpin || '' },
    { icon: '🟢', label: 'MCA Status', value: c.status || mca.CompanyStatus || '' },
    { icon: '🏷️', label: 'Company Class', value: mca.CompanyClass || '' },
    { icon: '📂', label: 'Category', value: mca.CompanyCategory || '' },
    { icon: '🏛️', label: 'Registrar (ROC)', value: mca.CompanyROCcode || '' },
    { icon: '📅', label: 'Incorporated On', value: fmtDate(mca.CompanyRegistrationdate_date) },
    { icon: '💰', label: 'Authorized Capital', value: inr(c.authorizedCapital || mca.AuthorizedCapital) },
    { icon: '💵', label: 'Paid-up Capital', value: inr(c.paidUpCapital || mca.PaidupCapital) },
    { icon: '🏭', label: 'Industrial Classification', value: mca.CompanyIndustrialClassification || '' },
    // Directors
    { icon: '👔', label: 'Directors', value: (c.directors || []).join(', ') },
    // Startup India (DPIIT) — read from raw.startupIndia first so MCA enrichment never
    // overwrites these; fall back to the columns.
    { icon: '🌱', label: 'Stage', value: toName(si.stages) || c.stage },
    { icon: '⚡', label: 'Focus Industry', value: toName(si.industries) || (c.startupIndiaRecognised ? c.industry : '') },
    { icon: '📊', label: 'Focus Sector', value: toName(si.sectors) },
    { icon: '✓', label: 'DPIIT Recognised', value: c.dpiitNumber || si.dippNumber || '' },
    { icon: '🗓️', label: 'Indexed On', value: fmtDate(si.publishedOn || si.registeredOn) },
    // web / Wikidata
    { icon: '🌐', label: 'Website', value: c.website || '' },
    { icon: '👤', label: 'Founders', value: (c.founders || []).join(', ') },
    { icon: '📍', label: 'Location', value: c.address || '' },
    // Contact info (from entity directly)
    { icon: '📧', label: 'Email', value: (c.emails || []).join(', ') },
    { icon: '📞', label: 'Phone', value: (c.phones || []).join(', ') },
  ];
  // coerce every value to a string (Startup-India fields can be numeric) before filtering
  return cards
    .map((c) => ({ ...c, value: String(c.value ?? '') }))
    .filter((c) => c.value.trim().length > 0);
}

function CardTile({ card }: { card: CardDef }) {
  const isUrl = /^https?:\/\//.test(card.value);
  return (
    <Box sx={{ bgcolor: '#f4f6fb', borderRadius: 2, p: 1.5, height: '100%' }}>
      <Stack direction="row" spacing={1} alignItems="center" mb={0.5}>
        <span style={{ fontSize: 18 }}>{card.icon}</span>
        <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.4 }}>
          {card.label}
        </Typography>
      </Stack>
      <Typography variant="body1" fontWeight={600} sx={{ wordBreak: 'break-word' }}>
        {isUrl ? <Link href={card.value} target="_blank" rel="noopener">{card.value}</Link> : card.value}
      </Typography>
    </Box>
  );
}

export default function CompanyModal({
  company, onClose, onUpdate,
}: { company: Company | null; onClose: () => void; onUpdate?: (c: Company) => void }) {
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const [question, setQuestion] = useState('');
  const [chat, setChat] = useState<{ q: string; a: string }[]>([]);
  const [asking, setAsking] = useState(false);
  const [enriching, setEnriching] = useState(false);

  // reset chat per company; auto-enrich seeded (Startup-India-only) companies on open:
  // show their SI cards instantly, then fetch MCA financials + contacts in the background.
  useEffect(() => {
    setChat([]);
    setQuestion('');
    if (!company) return;
    // only fetch if this company has never been enriched (background job marks raw.enrichedAt)
    const seeded = !company.raw?.enrichedAt;
    if (seeded) {
      setEnriching(true);
      api.post(`/companies/${company.id}/enrich`)
        .then((r) => { if (r.data && onUpdate) onUpdate(r.data); })
        .catch(() => {})
        .finally(() => setEnriching(false));
    }
  }, [company?.id]);

  if (!company) return null;

  const ask = async (preset?: string) => {
    const q = (preset ?? question).trim();
    if (!q || asking) return;
    setAsking(true);
    setQuestion('');
    setChat((c) => [...c, { q, a: '…' }]);
    try {
      // followup combines company name + question, re-aggregates, seeds the DB,
      // and returns the updated company so the modal refreshes its fields in place.
      const r = await api.post(`/companies/${company.id}/ask`, { question: q });
      setChat((c) => c.map((m, i) => (i === c.length - 1 ? { q, a: r.data.answer } : m)));
      if (r.data.company && onUpdate) onUpdate(r.data.company);
    } catch {
      setChat((c) => c.map((m, i) => (i === c.length - 1 ? { q, a: 'Lookup failed — try again.' } : m)));
    } finally {
      setAsking(false);
    }
  };

  const cards = buildCards(company);
  const social = Object.entries(company.socialLinks || {}).filter(([, v]) => v);
  const sources = company.sources || [];
  const googleAiOverview = getGoogleAiOverview(company);

  const exportAs = async (fmt: string) => {
    setAnchor(null);
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/export/${company.id}?format=${fmt}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${company.name}.${fmt === 'excel' ? 'xlsx' : fmt}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pr: 6, background: 'linear-gradient(135deg,#eef3ff,#f7f0ff)' }}>
        <Stack direction="row" spacing={2} alignItems="center">
          <Avatar variant="rounded" sx={{ bgcolor: '#e3ecff', color: '#1a73e8' }}>
            <RocketLaunchIcon />
          </Avatar>
          <Box>
            <Typography variant="h6" fontWeight={800}>{company.name}</Typography>
            <Stack direction="row" spacing={0.7} mt={0.5} flexWrap="wrap">
              {company.startupIndiaRecognised && (
                <Chip icon={<RocketLaunchIcon />} label="Startup" size="small" color="primary" variant="outlined" />
              )}
              {company.dpiitNumber && (
                <Chip icon={<VerifiedIcon />} label="DPIIT Recognised" size="small" color="success" variant="outlined" />
              )}
              {company.status && (
                <Chip label={`MCA: ${company.status}`} size="small"
                  color={/active/i.test(company.status) ? 'success' : 'default'} />
              )}
            </Stack>
          </Box>
        </Stack>
        <IconButton onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        {enriching && (
          <Box sx={{ bgcolor: '#f1f6ff', border: '1px solid #d2e3fc', borderRadius: 2, p: 1.5, mb: 2 }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <CircularProgress size={16} />
              <Typography variant="body2" color="text.secondary">
                Fetching fresh MCA financials &amp; contact details from public sources…
              </Typography>
            </Stack>
          </Box>
        )}
        {googleAiOverview && (
          <Box sx={{
            background: 'linear-gradient(135deg,#e8f0fe 0%,#f3e8fd 100%)',
            p: 2, borderRadius: 2, mb: 2, border: '1px solid #d2e3fc',
          }}>
            <Stack direction="row" alignItems="center" spacing={1} mb={0.5}>
              <AutoAwesomeIcon fontSize="small" sx={{ color: '#1a73e8' }} />
              <Typography variant="overline" sx={{ color: '#1a73e8', fontWeight: 700 }}>
                AI Overview
              </Typography>
            </Stack>
            <Typography variant="body2">{googleAiOverview}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              AI-generated summary from public Google and company sources — verify before relying on it.
            </Typography>
          </Box>
        )}

        {/* dynamic field grid — only populated, genuine fields are rendered */}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' }, gap: 1.5 }}>
          {cards.map((card) => <CardTile key={card.label} card={card} />)}
        </Box>

        {cards.length === 0 && (
          <Typography color="text.secondary" sx={{ py: 2 }}>
            No verified public fields found for this entity yet.
          </Typography>
        )}

        {(company.emails?.length > 0 || company.phones?.length > 0) && (
          <>
            <Divider sx={{ my: 2 }} />
            <Stack direction="row" alignItems="center" spacing={1} mb={1}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase' }}>
                {company.raw?.contactsFromAI ? 'Contact (from AI — unverified)' : 'Contact (verified from source)'}
              </Typography>
              {[
                ...(company.raw?.contacts?.scrapedFrom || []),
                ...(company.raw?.aggregator?.scrapedFrom || []),
                ...(company.raw?.tracxn?.profileUrl ? [company.raw.tracxn.profileUrl] : []),
              ].slice(0, 4).map((u: string) => (
                <Tooltip key={u} title={`Verify at ${u}`}>
                  <Chip
                    size="small" color="success" variant="outlined" label="source ↗"
                    component="a" href={u} target="_blank" rel="noopener" clickable
                  />
                </Tooltip>
              ))}
            </Stack>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {(company.emails || []).map((e) => (
                <Chip key={e} icon={<EmailIcon />} label={e} size="small"
                  component="a" href={`mailto:${e}`} clickable />
              ))}
              {(company.phones || []).map((p) => (
                <Chip key={p} icon={<PhoneIcon />} label={p} size="small"
                  component="a" href={`tel:${p}`} clickable />
              ))}
            </Stack>
          </>
        )}

        {social.length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase' }}>
              Social
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" mt={0.5}>
              {social.map(([k, v]) => (
                <Chip key={k} label={k} component="a" href={v as string} target="_blank" clickable size="small" />
              ))}
            </Stack>
          </>
        )}

        {company.description && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="body2" color="text.secondary">{company.description}</Typography>
          </>
        )}


        <Divider sx={{ my: 2 }} />
        <Stack direction="row" alignItems="center" spacing={1} mb={1}>
          <AutoAwesomeIcon fontSize="small" sx={{ color: '#1a73e8' }} />
          <Typography variant="overline" sx={{ color: '#1a73e8', fontWeight: 700 }}>
            Ask AI — followup lookup
          </Typography>
        </Stack>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap mb={1.5}>
          {['Give the CIN', 'Give contact details', 'Is this company authentic?', 'Who are the founders?'].map((p) => (
            <Chip key={p} label={p} size="small" variant="outlined" clickable
              disabled={asking} onClick={() => ask(p)} />
          ))}
        </Stack>
        {chat.map((m, i) => (
          <Box key={i} sx={{ mb: 1.5 }}>
            <Typography variant="body2" fontWeight={700}>Q: {m.q}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>
              {m.a === '…' ? <CircularProgress size={14} /> : m.a}
            </Typography>
          </Box>
        ))}
        <Stack direction="row" spacing={1}>
          <TextField fullWidth size="small" placeholder="Ask: give CIN, give contact details…"
            value={question} onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && ask()} disabled={asking} />
          <Button variant="contained" onClick={() => ask()} disabled={asking || !question.trim()}
            endIcon={asking ? <CircularProgress size={16} color="inherit" /> : <SendIcon />}>
            Ask
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          Followup re-searches the company and seeds any new genuine data into this profile.
        </Typography>

        <Button startIcon={<DownloadIcon />} variant="contained" sx={{ mt: 2 }}
          onClick={(e) => setAnchor(e.currentTarget)}>
          Export
        </Button>
        <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
          {FORMATS.map((f) => (
            <MenuItem key={f.key} onClick={() => exportAs(f.key)}>{f.label}</MenuItem>
          ))}
        </Menu>
      </DialogContent>
    </Dialog>
  );
}
