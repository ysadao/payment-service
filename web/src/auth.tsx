import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, clearTokens, setTokens } from "./api";

export interface User {
  id: string;
  email: string;
  emailVerified: boolean;
  emailVerifiedAt: string | null;
  createdAt: string;
}

interface AuthState {
  user: User | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<{ demoToken?: string }>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  async function refreshMe() {
    const data = await api<{ user: User }>("/api/me");
    setUser(data.user);
  }

  useEffect(() => {
    api<{ user: User }>("/api/me")
      .then((d) => setUser(d.user))
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      ready,
      async login(email, password) {
        const data = await api<{ accessToken: string; refreshToken: string; user: User }>("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        setTokens(data.accessToken, data.refreshToken);
        setUser(data.user);
      },
      async register(email, password) {
        const data = await api<{ accessToken: string; refreshToken: string; user: User; demoToken?: string }>(
          "/api/auth/register",
          { method: "POST", body: JSON.stringify({ email, password }) },
        );
        setTokens(data.accessToken, data.refreshToken);
        setUser(data.user);
        return { demoToken: data.demoToken };
      },
      async logout() {
        try {
          await api("/api/auth/logout", { method: "POST", body: JSON.stringify({}) });
        } catch {
          /* still clear local session */
        }
        clearTokens();
        setUser(null);
      },
      refreshMe,
    }),
    [user, ready],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside provider");
  return ctx;
}
