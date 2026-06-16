import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Box, Paper, TextField, Button, Typography, Alert, Stack,
  FormControlLabel, Checkbox, InputAdornment, IconButton,
} from '@mui/material';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import { useAuth } from '../auth';

export default function Signup() {
  const { signup } = useAuth();
  const nav = useNavigate();
  const [fullName, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!consent) return setErr('You must accept the data-processing consent.');
    setBusy(true);
    try {
      await signup(email, password, fullName, consent);
      nav('/dashboard');
    } catch (e: any) {
      setErr(e.response?.data?.message || 'Signup failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2 }}>
      <Paper sx={{ p: 4, width: 400 }} elevation={3}>
        <Typography variant="h5" fontWeight={700} gutterBottom>
          Create your Xchange Intel account
        </Typography>
        {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}
        <form onSubmit={submit}>
          <Stack spacing={2}>
            <TextField label="Full name" value={fullName}
              onChange={(e) => setName(e.target.value)} fullWidth />
            <TextField label="Email" type="email" value={email} required
              onChange={(e) => setEmail(e.target.value)} fullWidth />
            <TextField label="Password (min 8 chars)" type={showPw ? 'text' : 'password'} value={password} required
              onChange={(e) => setPassword(e.target.value)} fullWidth
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton onClick={() => setShowPw((s) => !s)} edge="end" tabIndex={-1}>
                      {showPw ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              }} />
            <FormControlLabel
              control={<Checkbox checked={consent} onChange={(e) => setConsent(e.target.checked)} />}
              label={
                <Typography variant="body2">
                  I consent to processing of my data per the DPDP Act / GDPR. Searches aggregate
                  publicly available company information only.
                </Typography>
              }
            />
            <Button type="submit" variant="contained" size="large" disabled={busy}>
              {busy ? 'Creating…' : 'Sign up'}
            </Button>
          </Stack>
        </form>
        <Typography mt={2} variant="body2">
          Already have an account? <Link to="/login">Sign in</Link>
        </Typography>
      </Paper>
    </Box>
  );
}
