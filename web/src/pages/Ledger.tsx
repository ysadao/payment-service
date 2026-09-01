import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatMoney } from "../api";

interface Row {
  id: string;
  paymentId: string;
  refundId: string | null;
  account: string;
  direction: string;
  amountCents: number;
  currency: string;
  createdAt: string;
}

export function Ledger() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ ledger: Row[] }>("/api/ledger")
      .then((d) => setRows(d.ledger))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Immutable</p>
          <h1>Ledger</h1>
        </div>
      </header>
      {error && <p className="banner error">{error}</p>}
      <section className="card">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Account</th>
              <th>Dir</th>
              <th>Amount</th>
              <th>Payment</th>
              <th>Refund</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="mono">{new Date(r.createdAt).toLocaleString()}</td>
                <td>{r.account}</td>
                <td>{r.direction}</td>
                <td>{formatMoney(r.amountCents, r.currency)}</td>
                <td>
                  <Link to={`/payments/${r.paymentId}`} className="mono">
                    {r.paymentId.slice(0, 8)}
                  </Link>
                </td>
                <td className="mono">{r.refundId ? r.refundId.slice(0, 8) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
