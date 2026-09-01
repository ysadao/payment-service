import { FormEvent, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";

export function Reset() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const initial = useMemo(() => params.get("token") ?? "", [params]);
  const [token, setToken] = useState(initial);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      nav("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <aside className="auth-panel">
        <p className="eyebrow">Recovery</p>
        <h1>Choose a new password.</h1>
        <p className="lede">Completing a reset revokes every outstanding refresh session.</p>
      </aside>
      <form className="auth-card" onSubmit={onSubmit}>
        <h2>Reset password</h2>
        {error && <p className="banner error">{error}</p>}
        <label>
          Token
          <input value={token} onChange={(e) => setToken(e.target.value)} required />
        </label>
        <label>
          New password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
        </label>
        <button type="submit" disabled={busy}>
          Update password
        </button>
        <p className="muted">
          <Link to="/login">Back to sign in</Link>
        </p>
      </form>
    </div>
  );
}
