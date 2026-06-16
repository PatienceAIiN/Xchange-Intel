import { Box, Button, Container, Stack, Typography, useTheme, Card, CardContent } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import SearchIcon from '@mui/icons-material/Search';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';

export default function Landing() {
  const theme = useTheme();

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', bgcolor: '#fafafa' }}>
      {/* Header */}
      <Box sx={{ p: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h5" fontWeight={800} color="primary">
          Xchange Intel
        </Typography>
        <Stack direction="row" spacing={2}>
          <Button component={RouterLink} to="/login" variant="outlined" color="primary">
            Sign In
          </Button>
          <Button component={RouterLink} to="/signup" variant="contained" color="primary" disableElevation>
            Get Started
          </Button>
        </Stack>
      </Box>

      {/* Hero Section */}
      <Container maxWidth="lg" sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', py: 10 }}>
        <Box sx={{ textAlign: 'center', maxWidth: 800, mx: 'auto' }}>
          <Typography variant="h2" component="h1" fontWeight={800} gutterBottom sx={{ 
            background: 'linear-gradient(90deg, #1a73e8 0%, #8ab4f8 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            letterSpacing: '-1px'
          }}>
            Company Intelligence, Instant & Accurate
          </Typography>
          <Typography variant="h6" color="text.secondary" paragraph sx={{ mb: 4, lineHeight: 1.6 }}>
            The ultimate AI-powered aggregator for Indian startups and corporations.
            Instantly extract verified details, MCA records, and contact information through advanced AI Web Overviews.
          </Typography>
          <Stack direction="row" spacing={3} justifyContent="center">
            <Button component={RouterLink} to="/signup" variant="contained" size="large" sx={{ py: 1.5, px: 4, fontSize: '1.1rem', borderRadius: 2 }} disableElevation>
              Start Searching Now
            </Button>
            <Button component={RouterLink} to="/login" variant="text" size="large" sx={{ py: 1.5, px: 4, fontSize: '1.1rem' }}>
              View Dashboard
            </Button>
          </Stack>
        </Box>

        {/* Feature Cards */}
        <Box sx={{ mt: 10, display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 4 }}>
          <Card elevation={0} sx={{ borderRadius: 4, bgcolor: '#ffffff', border: '1px solid #e0e0e0' }}>
            <CardContent sx={{ p: 4 }}>
              <AutoAwesomeIcon sx={{ fontSize: 40, color: theme.palette.primary.main, mb: 2 }} />
              <Typography variant="h5" fontWeight={700} gutterBottom>AI Web Overviews</Typography>
              <Typography color="text.secondary">
                We synthesize data from across the web, bringing you an instant AI summary, directors, and critical business metrics all in one place.
              </Typography>
            </CardContent>
          </Card>
          
          <Card elevation={0} sx={{ borderRadius: 4, bgcolor: '#ffffff', border: '1px solid #e0e0e0' }}>
            <CardContent sx={{ p: 4 }}>
              <VerifiedUserIcon sx={{ fontSize: 40, color: theme.palette.success.main, mb: 2 }} />
              <Typography variant="h5" fontWeight={700} gutterBottom>Authoritative Sources</Typography>
              <Typography color="text.secondary">
                Data is verified through authoritative endpoints like the Ministry of Corporate Affairs and Startup India.
              </Typography>
            </CardContent>
          </Card>

          <Card elevation={0} sx={{ borderRadius: 4, bgcolor: '#ffffff', border: '1px solid #e0e0e0' }}>
            <CardContent sx={{ p: 4 }}>
              <SearchIcon sx={{ fontSize: 40, color: theme.palette.secondary.main, mb: 2 }} />
              <Typography variant="h5" fontWeight={700} gutterBottom>Deep Scraping</Typography>
              <Typography color="text.secondary">
                Missing details? Our deep scraping technology acts as an autonomous agent to find hidden emails and contact numbers from company sites.
              </Typography>
            </CardContent>
          </Card>
        </Box>
      </Container>

      {/* Footer */}
      <Box sx={{ bgcolor: '#ffffff', py: 3, borderTop: '1px solid #e0e0e0', textAlign: 'center' }}>
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
