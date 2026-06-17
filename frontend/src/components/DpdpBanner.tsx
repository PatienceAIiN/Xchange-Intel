import { useState, useEffect } from 'react';
import { Box, Typography, Button, Stack, Link } from '@mui/material';

/** DPDP Act / GDPR consent banner — shown until the user accepts or denies. */
export default function DpdpBanner() {
  const [choice, setChoice] = useState<string | null>('pending');

  useEffect(() => {
    setChoice(localStorage.getItem('dpdp-consent'));
  }, []);

  if (choice === 'accepted' || choice === 'denied') return null;
  if (choice === 'pending') return null; // not yet read from storage

  const decide = (v: 'accepted' | 'denied') => {
    localStorage.setItem('dpdp-consent', v);
    localStorage.setItem('dpdp-consent-at', new Date().toISOString());
    setChoice(v);
  };

  return (
    <Box
      sx={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 2000,
        bgcolor: '#0d1b2a', color: '#fff', p: 2,
        boxShadow: '0 -2px 12px rgba(0,0,0,0.25)',
      }}
    >
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        alignItems={{ md: 'center' }}
        justifyContent="space-between"
        sx={{ maxWidth: 1200, mx: 'auto' }}
      >
        <Typography variant="body2" sx={{ flex: 1 }}>
          We process only publicly available company information in compliance with the{' '}
          <strong>DPDP Act, 2023</strong> and <strong>GDPR</strong>. By continuing you consent to
          this processing. You may withdraw consent anytime.{' '}
          <Link href="#" color="inherit" sx={{ textDecoration: 'underline' }}>Learn more</Link>.
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" color="inherit" size="small" onClick={() => decide('denied')}>
            Deny
          </Button>
          <Button variant="contained" color="primary" size="small" onClick={() => decide('accepted')}>
            Accept
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}
