import axios from 'axios';

export const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem('token');
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      if (location.pathname !== '/login') location.href = '/login';
    }
    return Promise.reject(err);
  },
);

export interface Company {
  id: string;
  name: string;
  cin?: string;
  llpin?: string;
  website?: string;
  emails: string[];
  phones: string[];
  founders: string[];
  directors: string[];
  address: string;
  socialLinks: Record<string, string>;
  description: string;
  aiOverview: string;
  sources: string[];
  startupIndiaRecognised: boolean;
  dpiitNumber?: string;
  industry?: string;
  stage?: string;
  status?: string;
  city?: string;
  state?: string;
  authorizedCapital?: string;
  paidUpCapital?: string;
  raw?: {
    mca?: any;
    startupIndia?: any;
    wiki?: any;
    google?: any;
    ai?: any;
    aiFollowup?: any;
    contacts?: any;
    aggregator?: any;
    tracxn?: any;
    contactsFromAI?: boolean;
    enrichedAt?: string;
  };
  updatedAt: string;
}
