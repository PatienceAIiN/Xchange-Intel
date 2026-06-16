import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { api } from '../api';

const POLICY_VERSION = 'dpdp_gdpr_banner_v1';
const STORAGE_KEY = `xchange-intel-consent:${POLICY_VERSION}`;
const SESSION_KEY = 'xchange-intel-consent-session';

type ConsentDecision = 'accepted' | 'denied';

function getSessionId() {
  const existing = sessionStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  sessionStorage.setItem(SESSION_KEY, id);
  return id;
}

export default function ConsentBanner() {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState<ConsentDecision | null>(null);
  const [error, setError] = useState('');
  const sessionId = useMemo(getSessionId, []);

  useEffect(() => {
    setVisible(!localStorage.getItem(STORAGE_KEY));
  }, []);

  const record = async (decision: ConsentDecision) => {
    setBusy(decision);
    setError('');
    const payload = { decision, policyVersion: POLICY_VERSION, sessionId };
    try {
      const res = await api.post('/consent', payload);
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          decision,
          policyVersion: POLICY_VERSION,
          eventId: res.data.id,
          decidedAt: res.data.createdAt,
        }),
      );
      setVisible(false);
    } catch {
      setError('Could not save your choice. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  if (!visible) return null;

  return (
    <Box
      sx={{
        position: 'fixed',
        insetInline: 0,
        bottom: 0,
        zIndex: (theme) => theme.zIndex.snackbar,
        px: { xs: 1.5, sm: 3 },
        pb: { xs: 1.5, sm: 3 },
        pointerEvents: 'none',
      }}
    >
      <Paper
        elevation={8}
        sx={{
          maxWidth: 980,
          mx: 'auto',
          p: { xs: 2, sm: 2.5 },
          borderRadius: 2,
          border: '1px solid',
          borderColor: 'divider',
          pointerEvents: 'auto',
        }}
      >
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'stretch', md: 'center' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" fontWeight={800} gutterBottom>
              DPDP/GDPR data consent
            </Typography>
            <Typography variant="body2" color="text.secondary">
              We use essential storage to keep you signed in and process public company-search data for this service.
              Accept records your consent; deny records that you declined non-essential processing.
            </Typography>
            {error && <Alert severity="error" sx={{ mt: 1.5 }}>{error}</Alert>}
          </Box>
          <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
            <Button
              variant="outlined"
              color="inherit"
              onClick={() => record('denied')}
              disabled={!!busy}
            >
              {busy === 'denied' ? 'Saving...' : 'Deny'}
            </Button>
            <Button
              variant="contained"
              onClick={() => record('accepted')}
              disabled={!!busy}
            >
              {busy === 'accepted' ? 'Saving...' : 'Accept'}
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Box>
  );
}
