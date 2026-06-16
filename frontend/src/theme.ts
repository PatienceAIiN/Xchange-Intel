import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#1565c0' },
    secondary: { main: '#7b1fa2' },
    background: { default: '#f4f6f8' },
  },
  shape: { borderRadius: 10 },
  typography: { fontFamily: 'Roboto, system-ui, sans-serif' },
});
