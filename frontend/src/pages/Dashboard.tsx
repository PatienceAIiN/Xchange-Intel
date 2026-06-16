import { useEffect, useState } from 'react';
import {
  AppBar, Toolbar, Typography, Container, TextField, Button, Box, Paper,
  Table, TableBody, TableCell, TableHead, TableRow, Chip, Avatar, Menu, MenuItem, InputAdornment, Stack, CircularProgress, Alert, TablePagination, Checkbox, Tooltip, IconButton,
  Dialog, DialogTitle, DialogContent, DialogActions
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import LogoutIcon from '@mui/icons-material/Logout';
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import { api, Company } from '../api';
import { useAuth } from '../auth';
import CompanyModal from '../components/CompanyModal';
import ErrorBoundary from '../components/ErrorBoundary';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<Company[]>([]);
  const [selected, setSelected] = useState<Company | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [menu, setMenu] = useState<null | HTMLElement>(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Dialog states
  const [profileOpen, setProfileOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [profileEmail, setProfileEmail] = useState(user?.email || '');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [ingest, setIngest] = useState<any>(null);

  const loadRecent = () => api.get('/companies').then((r) => setRows(r.data)).catch(() => {});
  const loadIngest = () =>
    api.get('/companies/ingestion/stats').then((r) => setIngest(r.data)).catch(() => {});
  useEffect(() => {
    loadRecent();
    loadIngest();
    // poll auto-sync stats every 60s; refresh the table when new companies arrive
    const t = setInterval(async () => {
      const prev = ingest?.totalCompanies;
      await loadIngest();
      const r = await api.get('/companies/ingestion/stats').catch(() => null);
      if (r && r.data.totalCompanies !== prev) loadRecent();
    }, 60000);
    return () => clearInterval(t);
  }, []);

  const search = async (refresh = false) => {
    if (query.trim().length < 2) return;
    
    if (!refresh) {
      const q = query.trim().toLowerCase();
      const localMatch = rows.find(r => 
        r.name.toLowerCase().includes(q) || 
        (r.cin && r.cin.toLowerCase() === q)
      );
      if (localMatch) {
        setSelected(localMatch);
        setNote('Loaded instantly from local dashboard cache.');
        setQuery('');
        return;
      }
    }

    setBusy(true);
    setErr('');
    setNote('');
    try {
      const r = await api.post('/companies/search', { query, refresh });
      setSelected(r.data.company);
      setNote(r.data.cacheHit ? 'Loaded from cache (stored earlier).' : 'Freshly aggregated and saved.');
      await loadRecent();
      setQuery('');
    } catch (e: any) {
      setErr(e.response?.data?.message || 'Search failed (rate limit or provider error).');
    } finally {
      setBusy(false);
    }
  };

  const openCompany = async (id: string) => {
    const cached = rows.find(r => r.id === id);
    if (cached) setSelected(cached);
    
    try {
      const r = await api.get(`/companies/${id}`);
      setSelected((prev) => {
        if (prev && prev.id === id) {
          return r.data;
        }
        return prev;
      });
    } catch (e) {
      console.error('Failed to fetch full company details', e);
    }
  };

  const handleChangePage = (event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const visibleRows = rows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  const toggleSelect = (e: React.ChangeEvent<HTMLInputElement>, id: string) => {
    e.stopPropagation();
    setSelectedIds((s) => (s.indexOf(id) === -1 ? [...s, id] : s.filter(x => x !== id)));
  };

  const toggleSelectAllVisible = () => {
    const visibleIds = visibleRows.map((r) => r.id);
    const allSelected = visibleIds.every(id => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds((s) => s.filter(id => !visibleIds.includes(id)));
    } else {
      setSelectedIds((s) => Array.from(new Set([...s, ...visibleIds])));
    }
  };

  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState('csv');
  const [exportBusy, setExportBusy] = useState(false);

  const runExport = async (scope: 'all' | 'page' | 'selected') => {
    setExportBusy(true);
    try {
      const body: any = { format: exportFormat };
      let n = 0;
      if (scope === 'all') { body.all = true; n = ingest?.totalCompanies || rows.length; }
      else if (scope === 'page') { body.ids = visibleRows.map((r) => r.id); n = body.ids.length; }
      else { body.ids = selectedIds; n = selectedIds.length; }
      const token = localStorage.getItem('token');
      const res = await fetch('/api/export/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `xchange-intel-${n}-companies.${exportFormat === 'excel' ? 'xlsx' : exportFormat}`;
      a.click();
      URL.revokeObjectURL(url);
      setExportOpen(false);
    } finally {
      setExportBusy(false);
    }
  };

  const deleteSelected = async () => {
    if (!selectedIds.length) return;
    if (!window.confirm(`Delete ${selectedIds.length} selected companies? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await api.post('/companies/delete/batch', { ids: selectedIds });
      setSelectedIds([]);
      await loadRecent();
      setNote(`${selectedIds.length} companies deleted`);
    } catch (e: any) {
      setErr(e.response?.data?.message || 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveProfile = async () => {
    try {
      setBusy(true);
      await api.put('/users/me', { email: profileEmail });
      setNote('Profile updated successfully');
      setProfileOpen(false);
    } catch (e: any) {
      setErr(e.response?.data?.message || 'Failed to update profile (API not implemented yet)');
      setProfileOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const handleChangePassword = async () => {
    try {
      setBusy(true);
      await api.put('/users/me/password', { oldPassword, newPassword });
      setNote('Password updated successfully');
      setPasswordOpen(false);
      setOldPassword('');
      setNewPassword('');
    } catch (e: any) {
      setErr(e.response?.data?.message || 'Failed to update password (API not implemented yet)');
      setPasswordOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" fontWeight={700} sx={{ flexGrow: 1 }}>
            Xchange Intel
          </Typography>
          <Avatar sx={{ cursor: 'pointer', width: 34, height: 34 }}
            onClick={(e) => setMenu(e.currentTarget)}>
            {user?.email?.[0]?.toUpperCase()}
          </Avatar>
          <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
            <MenuItem disabled>{user?.email} ({user?.role})</MenuItem>
            <MenuItem disabled>Searches: {user?.searchCount}</MenuItem>
            <MenuItem onClick={() => { setMenu(null); setProfileEmail(user?.email || ''); setProfileOpen(true); }}>Edit Profile</MenuItem>
            <MenuItem onClick={() => { setMenu(null); setPasswordOpen(true); }}>Change Password</MenuItem>
            <MenuItem onClick={logout}><LogoutIcon fontSize="small" sx={{ mr: 1 }} /> Logout</MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ py: 4, flex: 1 }}>
        <Paper sx={{ p: 3, mb: 3 }} elevation={2}>
          <Typography variant="h6" gutterBottom>Search any startup or company</Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              fullWidth placeholder="e.g. Zerodha, Razorpay, CRED…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && search()}
              InputProps={{
                startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment>,
              }}
            />
            <Button variant="contained" size="large" onClick={() => search(false)} disabled={busy}
              sx={{ minWidth: 140 }}>
              {busy ? <CircularProgress size={22} color="inherit" /> : 'Search'}
            </Button>
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={() => search(true)}
              disabled={busy}>Refresh</Button>
          </Stack>
          {err && <Alert severity="error" sx={{ mt: 2 }}>{err}</Alert>}
          {note && <Alert severity="info" sx={{ mt: 2 }}>{note}</Alert>}
        </Paper>

        {ingest && (
          <Paper elevation={1} sx={{ p: 1.5, mb: 2, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', bgcolor: '#eef6ee' }}>
            <Chip color="success" size="small" label={`Auto-sync: ${ingest.totalCompanies?.toLocaleString?.() ?? ingest.totalCompanies} companies`} />
            {ingest.addedLastRun > 0 && (
              <Chip color="primary" size="small" label={`+${ingest.addedLastRun} new last sync`} />
            )}
            <Typography variant="caption" color="text.secondary">
              Auto-ingesting from Startup India every {ingest.intervalMinutes} min
              {ingest.lastRunAt ? ` · last ${new Date(ingest.lastRunAt).toLocaleTimeString()}` : ' · starting…'}
              {` · ${ingest.runs} run(s)`}
            </Typography>
          </Paper>
        )}

        <Paper elevation={2}>
          <Box sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="subtitle1" fontWeight={600}>
              Knowledge base ({rows.length})
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <Button size="small" variant="outlined" startIcon={<DownloadIcon />}
                onClick={() => setExportOpen(true)}>
                Export
              </Button>
              {selectedIds.length > 0 && (
                <Tooltip title="Delete selected">
                  <IconButton onClick={deleteSelected} color="error">
                    <DeleteIcon />
                  </IconButton>
                </Tooltip>
              )}
            </Stack>
          </Box>
          <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ minWidth: 900 }}>
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox
                    indeterminate={visibleRows.some(r => selectedIds.includes(r.id)) && !visibleRows.every(r => selectedIds.includes(r.id))}
                    checked={visibleRows.length > 0 && visibleRows.every(r => selectedIds.includes(r.id))}
                    onChange={toggleSelectAllVisible}
                  />
                </TableCell>
                <TableCell>Name</TableCell>
                <TableCell>CIN</TableCell>
                <TableCell>Website</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Phone</TableCell>
                <TableCell>City</TableCell>
                <TableCell>State</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visibleRows.map((c) => (
                <TableRow key={c.id} hover sx={{ cursor: 'pointer' }}
                  onClick={() => openCompany(c.id)}
                  selected={selectedIds.includes(c.id)}
                >
                  <TableCell padding="checkbox">
                    <Checkbox
                      checked={selectedIds.includes(c.id)}
                      onChange={(e) => toggleSelect(e, c.id)}
                    />
                  </TableCell>
                  <TableCell>{c.name}</TableCell>
                  <TableCell>{c.cin || '—'}</TableCell>
                  <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {c.website || '—'}
                  </TableCell>
                  <TableCell>{c.emails?.length ? c.emails[0] : '—'}</TableCell>
                  <TableCell>{c.phones?.length ? c.phones[0] : '—'}</TableCell>
                  <TableCell>{c.city || '—'}</TableCell>
                  <TableCell>{c.state || '—'}</TableCell>
                </TableRow>
              ))}
              {!rows.length && (
                <TableRow><TableCell colSpan={8} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  No companies yet — run a search above.
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          </Box>
          <TablePagination
            component="div"
            count={rows.length}
            page={page}
            onPageChange={handleChangePage}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={handleChangeRowsPerPage}
            rowsPerPageOptions={[5, 10, 25, 50]}
          />
        </Paper>
      </Container>

      <Dialog open={exportOpen} onClose={() => setExportOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Export companies</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Choose what to export and the format.
          </Typography>
          <Stack direction="row" spacing={1} mb={2} flexWrap="wrap" useFlexGap>
            {['csv', 'excel', 'pdf', 'json'].map((f) => (
              <Chip key={f} label={f === 'excel' ? 'Excel' : f.toUpperCase()}
                color={exportFormat === f ? 'primary' : 'default'}
                onClick={() => setExportFormat(f)} clickable />
            ))}
          </Stack>
          <Stack spacing={1}>
            <Button variant="contained" disabled={exportBusy} onClick={() => runExport('all')}>
              Export ALL ({(ingest?.totalCompanies ?? rows.length).toLocaleString()})
            </Button>
            <Button variant="outlined" disabled={exportBusy} onClick={() => runExport('page')}>
              Export this page only ({visibleRows.length} loaded)
            </Button>
            {selectedIds.length > 0 && (
              <Button variant="outlined" disabled={exportBusy} onClick={() => runExport('selected')}>
                Export selected ({selectedIds.length})
              </Button>
            )}
          </Stack>
          {exportBusy && (
            <Stack direction="row" alignItems="center" spacing={1} mt={2}>
              <CircularProgress size={16} /><Typography variant="caption">Preparing file…</Typography>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setExportOpen(false)}>Cancel</Button>
        </DialogActions>
      </Dialog>

      <ErrorBoundary onReset={() => setSelected(null)}>
        <CompanyModal
          company={selected}
          onClose={() => setSelected(null)}
          onUpdate={(c) => {
            setSelected(c);
            setRows((prev) => prev.map((r) => (r.id === c.id ? c : r)));
          }}
        />
      </ErrorBoundary>

      {/* Edit Profile Modal */}
      <Dialog open={profileOpen} onClose={() => setProfileOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Edit Profile</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 2 }}>
            <TextField fullWidth label="Email Address" value={profileEmail} onChange={(e) => setProfileEmail(e.target.value)} />
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2, pt: 0 }}>
          <Button onClick={() => setProfileOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveProfile} disabled={busy}>Save Changes</Button>
        </DialogActions>
      </Dialog>

      {/* Change Password Modal */}
      <Dialog open={passwordOpen} onClose={() => setPasswordOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Change Password</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField fullWidth type="password" label="Current Password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} />
            <TextField fullWidth type="password" label="New Password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2, pt: 0 }}>
          <Button onClick={() => setPasswordOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleChangePassword} disabled={busy}>Update Password</Button>
        </DialogActions>
      </Dialog>

      {/* Footer */}
      <Box sx={{ py: 3, textAlign: 'center', mt: 'auto', backgroundColor: '#f5f5f5' }}>
        <Typography variant="body2" color="text.secondary">
          All copyright reserved @ 2026. A product of{' '}
          <a href="https://patienceai.com" target="_blank" rel="noopener noreferrer" style={{ color: '#1a73e8', textDecoration: 'none' }}>
            Patience AI
          </a>
        </Typography>
      </Box>
    </Box>
  );
}
