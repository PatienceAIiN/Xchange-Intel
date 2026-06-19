import { useEffect, useRef, useState } from 'react';
import {
  Box, Container, Typography, Paper, LinearProgress, Chip, Stack, Button, Collapse,
  Table, TableBody, TableRow, TableCell, IconButton, Pagination, AppBar, Toolbar,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import DownloadIcon from '@mui/icons-material/Download';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { api } from '../api';

const fmt = (n?: number) => (n ?? 0).toLocaleString();
const eta = (s?: number | null) => (s == null ? '—' : s > 3600 ? `${(s / 3600).toFixed(1)}h` : s > 60 ? `${Math.round(s / 60)}m` : `${s}s`);

function Dot({ on }: { on: boolean }) {
  return (
    <Box component="span" sx={{
      width: 10, height: 10, borderRadius: '50%', display: 'inline-block',
      bgcolor: on ? '#22c55e' : '#9ca3af',
      boxShadow: on ? '0 0 0 0 rgba(34,197,94,0.6)' : 'none',
      animation: on ? 'pulse 1.5s infinite' : 'none',
      '@keyframes pulse': { '0%': { boxShadow: '0 0 0 0 rgba(34,197,94,0.6)' }, '70%': { boxShadow: '0 0 0 10px rgba(34,197,94,0)' }, '100%': { boxShadow: '0 0 0 0 rgba(34,197,94,0)' } },
    }} />
  );
}

function PhaseCard({ title, done, pct, lines, active, onClick, clickable = true }: { title: string; done: boolean; pct: number | null; lines: [string, string][]; active: boolean; onClick: () => void; clickable?: boolean }) {
  return (
    <Paper elevation={active ? 6 : 2} onClick={clickable ? onClick : undefined} sx={{
      p: 2.5, opacity: done ? 0.6 : 1, position: 'relative', cursor: clickable ? 'pointer' : 'default',
      border: active ? '2px solid #1565c0' : '2px solid transparent', transition: '0.15s',
      '&:hover': clickable ? { boxShadow: 6 } : {},
    }}>
      <Stack direction="row" alignItems="center" spacing={1} mb={1}>
        <Dot on={!done} />
        <Typography variant="h6" fontWeight={700}>{title}</Typography>
        <Chip size="small" label={done ? 'COMPLETED' : 'PROCESSING'} color={done ? 'default' : 'success'}
          variant={done ? 'outlined' : 'filled'} sx={{ ml: 'auto' }} />
      </Stack>
      {clickable && (
        <Typography variant="caption" color="primary" sx={{ display: 'block', mb: 1 }}>
          {active ? '● showing logs below' : 'click to view its logs'}
        </Typography>
      )}
      {pct != null && <LinearProgress variant="determinate" value={Math.min(pct, 100)} sx={{ height: 8, borderRadius: 1, mb: 1.5 }} />}
      <Table size="small"><TableBody>
        {lines.map(([k, v]) => (
          <TableRow key={k}><TableCell sx={{ border: 0, py: 0.3, color: 'text.secondary' }}>{k}</TableCell>
            <TableCell sx={{ border: 0, py: 0.3, fontWeight: 600 }}>{v}</TableCell></TableRow>
        ))}
      </TableBody></Table>
    </Paper>
  );
}

export default function Process() {
  const [st, setSt] = useState<any>(null);
  const [logs, setLogs] = useState<any>({ lines: [], total: 0 });
  const [logPage, setLogPage] = useState(0);
  const [showLogs, setShowLogs] = useState(true);
  const [err, setErr] = useState(false);
  // which phase's logs to show: '' = all, or a pipe-list of contexts
  const [filter, setFilter] = useState<{ key: string; label: string; terms: string }>({ key: '', label: 'All', terms: '' });
  const pageRef = useRef(0); pageRef.current = logPage;
  const filterRef = useRef(''); filterRef.current = filter.terms;

  const pickFilter = (key: string, label: string, terms: string) => {
    if (filter.key === key) { setFilter({ key: '', label: 'All', terms: '' }); }
    else { setFilter({ key, label, terms }); }
    setLogPage(0);
  };

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const [s, l] = await Promise.all([
          api.get('/process/status'),
          api.get(`/process/logs?page=${pageRef.current}&size=25&filter=${encodeURIComponent(filterRef.current)}`),
        ]);
        if (!alive) return;
        setSt(s.data); setLogs(l.data); setErr(false);
      } catch { if (alive) setErr(true); }
    };
    tick();
    const t = setInterval(tick, 6000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const exportAll = async () => {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/export/batch', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ all: true, format: 'csv' }),
    });
    const blob = await res.blob(); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'xchange-intel-all-companies.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const mca = st?.phases?.mca, si = st?.phases?.startupIndia, ct = st?.phases?.contacts;
  const cov = st?.coverage;
  const MCA_TARGET = mca?.target || 300000, SI_TARGET = si?.target || 454000;
  const pctOf = (n?: number) => (cov?.total ? Math.round(((n || 0) / cov.total) * 100) : 0);
  const copyLogs = () => {
    const text = (logs.lines || []).map((l: any) => `${l.t.slice(11, 19)} [${l.ctx}] ${l.msg}`).join('\n');
    navigator.clipboard?.writeText(text);
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#f4f6f8' }}>
      <AppBar position="static"><Toolbar>
        <Typography variant="h6" fontWeight={700} sx={{ flexGrow: 1 }}>Xchange Intel — Live Processing</Typography>
        <Dot on={!err} /><Typography variant="body2" sx={{ ml: 1 }}>{err ? 'Reconnecting…' : 'Connected · live'}</Typography>
      </Toolbar></AppBar>

      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Stack direction="row" alignItems="center" spacing={2} mb={2}>
          <Typography variant="h5" fontWeight={800}>{fmt(st?.totalCompanies)}</Typography>
          <Typography color="text.secondary">companies in database</Typography>
          <Button startIcon={<DownloadIcon />} variant="contained" sx={{ ml: 'auto' }} onClick={exportAll}>
            Export ALL (your format)
          </Button>
        </Stack>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3,1fr)' }, gap: 2, mb: 3 }}>
          <PhaseCard title="MCA Master Data" done={!!mca?.done && !mca?.running}
            active={filter.key === 'mca'} onClick={() => pickFilter('mca', 'MCA Master Data', 'mca')}
            pct={((cov?.mca || 0) / MCA_TARGET) * 100}
            lines={[['In database', `${fmt(cov?.mca)} / ${fmt(MCA_TARGET)}`], ['New this run', fmt(mca?.added)], ['Rate', `${mca?.ratePerSec ?? 0}/s`], ['Status', mca?.blocked ? '⚠ rate-limited, retrying' : mca?.running ? 'pulling' : ((cov?.mca || 0) >= MCA_TARGET ? 'complete' : 'resuming…')]]} />
          <PhaseCard title="Startup India (DPIIT)" done={!!si?.done && !si?.running}
            active={filter.key === 'si'} onClick={() => pickFilter('si', 'Startup India', 'startupimport|startup|ingestion')}
            pct={((cov?.startup || 0) / SI_TARGET) * 100}
            lines={[['In database', `${fmt(cov?.startup)} / ${fmt(SI_TARGET)}`], ['New this run', fmt(si?.added)], ['Rate', `${si?.ratePerSec ?? 0}/s`], ['Status', si?.running ? 'pulling' : 'idle']]} />
          <PhaseCard title="Contact Filling" done={!!ct?.done}
            active={filter.key === 'ct'} onClick={() => pickFilter('ct', 'Contact Filling', 'contactfill|contact|website|aggregator|zauba')}
            pct={ct?.grandTotal ? (ct.completed / ct.grandTotal) * 100 : null}
            lines={[['Completed', `${fmt(ct?.completed)} / ${fmt(ct?.grandTotal)}`], ['Remaining', fmt(ct?.remaining)], ['Attempted (run)', fmt(ct?.processed)], ['With contacts', fmt(ct?.withContacts)], ['Rate', `${ct?.ratePerSec ?? 0}/s`], ['ETA', eta(ct?.etaSeconds)]]} />
        </Box>

        {/* Cards 4, 5 & 6 — live coverage + completion + backup replication (authentic) */}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3,1fr)' }, gap: 2, mb: 3 }}>
          <PhaseCard title="Data Coverage" done={false} active={false} onClick={() => {}} clickable={false}
            pct={null}
            lines={[
              ['With CIN', `${fmt(cov?.withCin)} (${pctOf(cov?.withCin)}%)`],
              ['With contacts', `${fmt(cov?.withContacts)} (${pctOf(cov?.withContacts)}%)`],
              ['DPIIT recognised', `${fmt(cov?.withDpiit)} (${pctOf(cov?.withDpiit)}%)`],
              ['Total companies', fmt(cov?.total)],
            ]} />
          <PhaseCard title="Completion / Missing" done={!!(ct?.done && si?.done && mca?.done)}
            active={false} onClick={() => {}} clickable={false}
            pct={cov?.total ? (cov.enriched / cov.total) * 100 : null}
            lines={[
              ['Enriched (checked)', `${fmt(cov?.enriched)} / ${fmt(cov?.total)}`],
              ['Missing contacts', fmt((cov?.total || 0) - (cov?.withContacts || 0))],
              ['Missing CIN', fmt((cov?.total || 0) - (cov?.withCin || 0))],
              ['Status', (ct?.done && si?.done && mca?.done) ? 'ALL COMPLETE' : 'filling…'],
            ]} />
          <PhaseCard title="Backup Replication" done={!!(st?.phases?.backup && !st.phases.backup.running && st.phases.backup.copied > 0)}
            active={false} onClick={() => {}} clickable={false}
            pct={st?.phases?.backup?.eligible ? (st.phases.backup.copied / st.phases.backup.eligible) * 100 : null}
            lines={[
              ['Replicated', `${fmt(st?.phases?.backup?.copied)} / ${fmt(st?.phases?.backup?.eligible)}`],
              ['Rate', `${st?.phases?.backup?.ratePerSec ?? 0}/s`],
              ['ETA', eta(st?.phases?.backup?.etaSeconds)],
              ['Target', 'backup DB (completed only)'],
            ]} />
        </Box>

        <Paper elevation={2}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ p: 1.5 }}>
            <Typography variant="subtitle1" fontWeight={700}>
              Live logs — {filter.label} ({fmt(logs.total)})
            </Typography>
            {filter.key && (
              <Chip size="small" label="show all" onClick={() => { setFilter({ key: '', label: 'All', terms: '' }); setLogPage(0); }} />
            )}
            <Box sx={{ flexGrow: 1 }} />
            <Button size="small" startIcon={<ContentCopyIcon />} onClick={copyLogs}>Copy</Button>
            <IconButton onClick={() => setShowLogs((s) => !s)}>
              <ExpandMoreIcon sx={{ transform: showLogs ? 'rotate(180deg)' : 'none', transition: '0.2s' }} />
            </IconButton>
          </Stack>
          <Collapse in={showLogs}>
            <Box sx={{ fontFamily: 'monospace', fontSize: 12, bgcolor: '#0d1b2a', color: '#cde', p: 1.5, maxHeight: 420, overflow: 'auto' }}>
              {logs.lines.map((l: any, i: number) => (
                <Box key={i} sx={{ whiteSpace: 'pre-wrap', py: 0.2, color: l.level === 'warn' ? '#fbbf24' : l.level === 'error' ? '#f87171' : '#cde' }}>
                  {l.t.slice(11, 19)} [{l.ctx}] {l.msg}
                </Box>
              ))}
            </Box>
            <Box sx={{ p: 1, display: 'flex', justifyContent: 'center' }}>
              <Pagination size="small" count={Math.max(1, Math.ceil(logs.total / 25))} page={logPage + 1}
                onChange={(_, p) => setLogPage(p - 1)} />
            </Box>
          </Collapse>
        </Paper>
      </Container>
    </Box>
  );
}
