import { FormEvent, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";

export function Verify() {
  const [params] = useSearchParams();
  const { user, refreshMe } = useAuth();
  const initial = useMemo(() => params.get("token") ?? "", [params]);
  const [token, setToken] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) });
      setOk(true);
      if (user) await refreshMe();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <aside className="auth-panel">
        <p className="eyebrow">Mailbox</p>
        <h1>Confirm the operator.</h1>
        <p className="lede">The demo API returns the verification token in the register response.</p>
      </aside>
      <form className="auth-card" onSubmit={onSubmit}>
        <h2>Verify email</h2>
        {error && <p className="banner error">{error}</p>}
        {ok && (
          <p className="banner ok">
            Verified. <Link to="/">Open console</Link>
          </p>
        )}
        <label>
          Token
          <input value={token} onChange={(e) => setToken(e.target.value)} required />
        </label>
        <button type="submit" disabled={busy}>
          Verify
        </button>
        <p className="muted">
          <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
