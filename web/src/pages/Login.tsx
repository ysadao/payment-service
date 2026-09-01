import { FormEvent, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";

export function Login() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("demo@ledger.app");
  const [password, setPassword] = useState("LedgerDemo123!");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      nav("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <aside className="auth-panel">
        <p className="eyebrow">Ledger operator console</p>
        <h1>Clear the books without double-charging.</h1>
        <p className="lede">
          Payments, refunds, and an immutable ledger with required idempotency keys — the same discipline a card
          processor uses when the network retries.
        </p>
        <div className="cred">
          <p className="eyebrow">Demo operator</p>
          <p className="mono">demo@ledger.app</p>
          <p className="mono">LedgerDemo123!</p>
        </div>
      </aside>
      <form className="auth-card" onSubmit={onSubmit}>
        <h2>Sign in</h2>
        {error && <p className="banner error">{error}</p>}
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Open console"}
        </button>
        <p className="muted">
          No desk yet? <Link to="/register">Register</Link>
          {" · "}
          <Link to="/forgot">Forgot password</Link>
        </p>
      </form>
    </div>
  );
}
