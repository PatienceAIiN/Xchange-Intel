import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api } from './api';

interface User {
  id: string;
  email: string;
  fullName: string;
  role: string;
  plan: string;
  searchCount: number;
}
interface Ctx {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, fullName: string, consent: boolean) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<Ctx>(null!);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = localStorage.getItem('token');
    if (!t) return setLoading(false);
    api
      .get('/auth/me')
      .then((r) => setUser(r.data))
      .catch(() => localStorage.removeItem('token'))
      .finally(() => setLoading(false));
  }, []);

  const handle = (data: any) => {
    localStorage.setItem('token', data.accessToken);
    setUser(data.user);
  };

  const login = async (email: string, password: string) => {
    handle((await api.post('/auth/login', { email, password })).data);
  };
  const signup = async (email: string, password: string, fullName: string, consent: boolean) => {
    handle((await api.post('/auth/signup', { email, password, fullName, consent })).data);
  };
  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
