import { Component, ReactNode } from 'react';
import { Dialog, DialogTitle, DialogContent, Typography, Button } from '@mui/material';

interface Props { children: ReactNode; onReset?: () => void }
interface State { error: Error | null }

/** Catches render crashes (e.g. in the company modal) so the app shows the error
 *  instead of a blank white screen. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error('UI error:', error);
  }

  render() {
    if (this.state.error) {
      return (
        <Dialog open onClose={() => { this.setState({ error: null }); this.props.onReset?.(); }} maxWidth="sm" fullWidth>
          <DialogTitle>Something went wrong rendering this view</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="error" sx={{ whiteSpace: 'pre-wrap', mb: 2 }}>
              {this.state.error.message}
            </Typography>
            <Button variant="contained" onClick={() => { this.setState({ error: null }); this.props.onReset?.(); }}>
              Close
            </Button>
          </DialogContent>
        </Dialog>
      );
    }
    return this.props.children;
  }
}
