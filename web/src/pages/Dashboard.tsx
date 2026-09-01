import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatMoney } from "../api";

interface Dash {
  counts: Record<string, number>;
  recentLedger: Array<{
    id: string;
    paymentId: string;
    account: string;
    direction: string;
    amountCents: number;
    currency: string;
    createdAt: string;
  }>;
}

const STATUSES = ["requires_confirmation", "processing", "succeeded", "failed", "canceled"] as const;

export function Dashboard() {
  const [data, setData] = useState<Dash | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Dash>("/api/dashboard")
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Overview</p>
          <h1>Settlement desk</h1>
        </div>
        <Link to="/payments">
          <button type="button">New payment</button>
        </Link>
      </header>
      {error && <p className="banner error">{error}</p>}
      <div className="stats">
        {STATUSES.map((s) => (
          <div className="stat" key={s}>
            <p className="eyebrow">{s.replaceAll("_", " ")}</p>
            <strong>{data?.counts[s] ?? "—"}</strong>
          </div>
        ))}
      </div>
      <section className="card">
        <p className="eyebrow">Recent ledger</p>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Account</th>
              <th>Dir</th>
              <th>Amount</th>
              <th>Payment</th>
            </tr>
          </thead>
          <tbody>
            {(data?.recentLedger ?? []).map((row) => (
              <tr key={row.id}>
                <td className="mono">{new Date(row.createdAt).toLocaleString()}</td>
                <td>{row.account}</td>
                <td>{row.direction}</td>
                <td>{formatMoney(row.amountCents, row.currency)}</td>
                <td>
                  <Link to={`/payments/${row.paymentId}`} className="mono">
                    {row.paymentId.slice(0, 8)}
                  </Link>
                </td>
              </tr>
            ))}
            {data && data.recentLedger.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No postings yet. Capture a payment to write the first lines.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
