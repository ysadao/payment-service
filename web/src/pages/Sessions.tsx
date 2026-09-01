import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";

interface SessionRow {
  id: string;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export function Sessions() {
  const { user, refreshMe } = useAuth();
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    const data = await api<{ sessions: SessionRow[] }>("/api/me/sessions");
    setRows(data.sessions);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function revoke(id: string) {
    setError(null);
    try {
      await api(`/api/me/sessions/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Revoke failed");
    }
  }

  async function logoutAll() {
    setError(null);
    try {
      await api("/api/auth/logout-all", { method: "POST", body: JSON.stringify({}) });
      setNotice("All refresh sessions revoked. Sign in again after the access token expires.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Logout-all failed");
    }
  }

  async function requestVerify() {
    setError(null);
    try {
      const data = await api<{ demoToken?: string }>("/api/auth/request-verification", {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (data.demoToken) setNotice(`Verification token: ${data.demoToken}`);
      else setNotice("Verification email issued.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Security</p>
          <h1>Sessions</h1>
        </div>
        <button type="button" className="secondary" onClick={() => void logoutAll()}>
          Logout all devices
        </button>
      </header>
      {error && <p className="banner error">{error}</p>}
      {notice && <p className="banner ok">{notice}</p>}
      <div className="grid-2">
        <section className="card">
          <table>
            <thead>
              <tr>
                <th>Created</th>
                <th>Expires</th>
                <th>Agent</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{new Date(s.createdAt).toLocaleString()}</td>
                  <td className="mono">{new Date(s.expiresAt).toLocaleString()}</td>
                  <td className="muted">{s.userAgent ?? "—"}</td>
                  <td>
                    {s.revokedAt ? (
                      <span className="pill canceled">revoked</span>
                    ) : (
                      <button type="button" className="ghost" onClick={() => void revoke(s.id)}>
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="card stack">
          <p className="eyebrow">Operator</p>
          <p>{user?.email}</p>
          <p className="muted">{user?.emailVerified ? "Email verified" : "Email not verified"}</p>
          {!user?.emailVerified && (
            <button type="button" className="secondary" onClick={() => void requestVerify().then(() => refreshMe())}>
              Request verification token
            </button>
          )}
        </section>
      </div>
    </>
  );
}
