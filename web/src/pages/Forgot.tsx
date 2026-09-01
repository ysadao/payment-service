import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

export function Forgot() {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ ok: boolean; demoToken?: string }>("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setToken(data.demoToken ?? "sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <aside className="auth-panel">
        <p className="eyebrow">Recovery</p>
        <h1>Reset the vault key.</h1>
        <p className="lede">Demo mode returns a one-time token so you can finish the flow without SMTP.</p>
      </aside>
      <form className="auth-card" onSubmit={onSubmit}>
        <h2>Forgot password</h2>
        {error && <p className="banner error">{error}</p>}
        {token && token !== "sent" && (
          <p className="banner ok">
            Demo token: <span className="mono">{token}</span>
            <br />
            <Link to={`/reset?token=${encodeURIComponent(token)}`}>Continue to reset</Link>
          </p>
        )}
        {token === "sent" && <p className="banner ok">If that mailbox exists, a reset was issued.</p>}
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <button type="submit" disabled={busy}>
          Send reset
        </button>
        <p className="muted">
          <Link to="/login">Back to sign in</Link>
        </p>
      </form>
    </div>
  );
}
