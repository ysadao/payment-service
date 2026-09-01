import { FormEvent, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";

export function Register() {
  const { user, register } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await register(email, password);
      if (result.demoToken) {
        nav(`/verify?token=${encodeURIComponent(result.demoToken)}`);
      } else {
        nav("/");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <aside className="auth-panel">
        <p className="eyebrow">New operator</p>
        <h1>Provision a desk.</h1>
        <p className="lede">Each operator only sees their own customers, payments, and ledger lines.</p>
      </aside>
      <form className="auth-card" onSubmit={onSubmit}>
        <h2>Register</h2>
        {error && <p className="banner error">{error}</p>}
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create operator"}
        </button>
        <p className="muted">
          Already wired in? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
