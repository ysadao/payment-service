import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatMoney } from "../api";

interface Customer {
  id: string;
  name: string;
  email: string;
}

interface Payment {
  id: string;
  customerId: string;
  amountCents: number;
  currency: string;
  status: string;
  description: string;
  createdAt: string;
}

function newKey() {
  return crypto.randomUUID();
}

export function Payments() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [amount, setAmount] = useState("20.00");
  const [description, setDescription] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState<string>(newKey());
  const [keepKey, setKeepKey] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    const [c, p] = await Promise.all([
      api<{ customers: Customer[] }>("/api/customers"),
      api<{ payments: Payment[] }>("/api/payments"),
    ]);
    setCustomers(c.customers);
    setPayments(p.payments);
    if (!customerId && c.customers[0]) setCustomerId(c.customers[0].id);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const dollars = Number(amount);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setError("Enter a positive amount");
      return;
    }
    try {
      const created = await api<Payment>("/api/payments", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({
          customerId,
          amountCents: Math.round(dollars * 100),
          currency: "usd",
          description,
        }),
      });
      setNotice(
        `Payment ${created.id.slice(0, 8)} stored. Replaying this form with the same key will not double-charge.`,
      );
      if (!keepKey) setIdempotencyKey(newKey());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Intents</p>
          <h1>Payments</h1>
        </div>
      </header>
      {error && <p className="banner error">{error}</p>}
      {notice && <p className="banner ok">{notice}</p>}
      <div className="grid-2">
        <section className="card">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Amount</th>
                <th>Memo</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className={`pill ${p.status}`}>{p.status.replaceAll("_", " ")}</span>
                  </td>
                  <td>{formatMoney(p.amountCents, p.currency)}</td>
                  <td>{p.description || "—"}</td>
                  <td>
                    <Link to={`/payments/${p.id}`}>Open</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <form className="card form-card" onSubmit={onCreate}>
          <p className="eyebrow">Create payment</p>
          <label>
            Customer
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Amount (USD)
            <input value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </label>
          <label>
            Description
            <input value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label>
            Idempotency-Key
            <input value={idempotencyKey} onChange={(e) => setIdempotencyKey(e.target.value)} required />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input type="checkbox" checked={keepKey} onChange={(e) => setKeepKey(e.target.checked)} style={{ width: "auto" }} />
            Retry with same idempotency key (safe replay)
          </label>
          <div className="actions">
            <button type="submit">Charge (idempotent)</button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setIdempotencyKey(newKey());
                setNotice("Issued a fresh key — the next submit is a new intent.");
              }}
            >
              New key
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
