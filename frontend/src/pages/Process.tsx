import { useEffect, useRef, useState } from 'react';
import {
  Box, Container, Typography, Paper, LinearProgress, Chip, Stack, Button, Collapse,
  Table, TableBody, TableRow, TableCell, IconButton, Pagination, AppBar, Toolbar,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import DownloadIcon from '@mui/icons-material/Download';
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

function PhaseCard({ title, done, pct, lines }: { title: string; done: boolean; pct: number | null; lines: [string, string][] }) {
  return (
    <Paper elevation={2} sx={{ p: 2.5, opacity: done ? 0.55 : 1, position: 'relative' }}>
      <Stack direction="row" alignItems="center" spacing={1} mb={1}>
        <Dot on={!done} />
        <Typography variant="h6" fontWeight={700}>{title}</Typography>
        <Chip size="small" label={done ? 'COMPLETED' : 'PROCESSING'} color={done ? 'default' : 'success'}
          variant={done ? 'outlined' : 'filled'} sx={{ ml: 'auto' }} />
      </Stack>
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
  const pageRef = useRef(0); pageRef.current = logPage;

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const [s, l] = await Promise.all([
          api.get('/process/status'),
          api.get(`/process/logs?page=${pageRef.current}&size=25`),
        ]);
        if (!alive) return;
        setSt(s.data); setLogs(l.data); setErr(false);
      } catch { if (alive) setErr(true); }
    };
    tick();
    const t = setInterval(tick, 3000);
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
          <PhaseCard title="MCA Master Data" done={!!mca?.done}
            pct={mca?.target ? (mca.added / mca.target) * 100 : null}
            lines={[['Imported', `${fmt(mca?.added)} / ${fmt(mca?.target)}`], ['Rate', `${mca?.ratePerSec ?? 0}/s`], ['ETA', eta(mca?.etaSeconds)], ['Status', mca?.blocked ? 'key blocked' : mca?.running ? 'pulling' : 'idle']]} />
          <PhaseCard title="Startup India (DPIIT)" done={false}
            pct={null}
            lines={[['Imported (runs)', `${fmt(si?.totalAdded)} (${si?.runs ?? 0})`], ['Last sync', si?.lastRunAt ? new Date(si.lastRunAt).toLocaleTimeString() : '—'], ['Pending enrich', fmt(si?.pendingEnrichment)], ['Interval', `${si?.intervalMinutes ?? 12} min`]]} />
          <PhaseCard title="Contact Filling" done={!!ct?.done}
            pct={ct?.total ? (ct.processed / ct.total) * 100 : null}
            lines={[['Processed', `${fmt(ct?.processed)} / ${fmt(ct?.total)}`], ['With contacts', fmt(ct?.withContacts)], ['Rate', `${ct?.ratePerSec ?? 0}/s`], ['ETA', eta(ct?.etaSeconds)], ['Last', (ct?.lastCompany || '—').slice(0, 28)]]} />
        </Box>

        <Paper elevation={2}>
          <Stack direction="row" alignItems="center" sx={{ p: 1.5 }}>
            <Typography variant="subtitle1" fontWeight={700} sx={{ flexGrow: 1 }}>
              Live logs ({fmt(logs.total)})
            </Typography>
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
