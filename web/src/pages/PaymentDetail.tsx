import { FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, formatMoney } from "../api";

interface Payment {
  id: string;
  customerId: string;
  amountCents: number;
  currency: string;
  status: string;
  providerChargeId: string | null;
  description: string;
  createdAt: string;
  updatedAt: string;
}

interface EventRow {
  id: string;
  type: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export function PaymentDetail() {
  const { id } = useParams();
  const [payment, setPayment] = useState<Payment | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [refundAmt, setRefundAmt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [demoSimulator, setDemoSimulator] = useState(false);

  async function load() {
    if (!id) return;
    const [p, e] = await Promise.all([
      api<Payment>(`/api/payments/${id}`),
      api<{ events: EventRow[] }>(`/api/payments/${id}/events`),
    ]);
    setPayment(p);
    setEvents(e.events);
  }

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((body: { demoSimulator?: boolean }) => setDemoSimulator(Boolean(body.demoSimulator)))
      .catch(() => setDemoSimulator(false));
    load().catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function act(path: string, body?: unknown) {
    setError(null);
    try {
      await api(path, { method: "POST", body: body ? JSON.stringify(body) : JSON.stringify({}) });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    }
  }

  async function onRefund(e: FormEvent) {
    e.preventDefault();
    if (!payment) return;
    const dollars = Number(refundAmt);
    await act("/api/refunds", { paymentId: payment.id, amountCents: Math.round(dollars * 100) });
    setRefundAmt("");
  }

  if (!payment) {
    return error ? <p className="banner error">{error}</p> : <p className="muted">Loading…</p>;
  }

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">
            <Link to="/payments">Payments</Link> / {payment.id.slice(0, 8)}
          </p>
          <h1>{formatMoney(payment.amountCents, payment.currency)}</h1>
        </div>
        <span className={`pill ${payment.status}`}>{payment.status.replaceAll("_", " ")}</span>
      </header>
      {error && <p className="banner error">{error}</p>}
      <div className="grid-2">
        <section className="card stack">
          <p className="mono">{payment.description || "No memo"}</p>
          <p className="muted">
            Charge id: <span className="mono">{payment.providerChargeId ?? "—"}</span>
          </p>
          <p className="muted">Opened {new Date(payment.createdAt).toLocaleString()}</p>
          <div className="actions">
            {payment.status === "requires_confirmation" && (
              <>
                <button type="button" onClick={() => act(`/api/payments/${payment.id}/confirm`)}>
                  Confirm
                </button>
                <button type="button" className="secondary" onClick={() => act(`/api/payments/${payment.id}/cancel`)}>
                  Cancel
                </button>
              </>
            )}
            {demoSimulator && (payment.status === "requires_confirmation" || payment.status === "processing") && (
              <>
                <button
                  type="button"
                  onClick={() => act("/api/demo/simulate-provider", { paymentId: payment.id, outcome: "succeeded" })}
                >
                  Simulate succeed
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => act("/api/demo/simulate-provider", { paymentId: payment.id, outcome: "failed" })}
                >
                  Simulate fail
                </button>
              </>
            )}
          </div>
          {payment.status === "succeeded" && (
            <form className="form-card" onSubmit={onRefund}>
              <p className="eyebrow">Refund</p>
              <label>
                Amount (USD)
                <input value={refundAmt} onChange={(e) => setRefundAmt(e.target.value)} required />
              </label>
              <button type="submit">Post refund</button>
            </form>
          )}
        </section>
        <section className="card">
          <p className="eyebrow">Event timeline</p>
          <ul className="timeline">
            {events.map((ev) => (
              <li key={ev.id}>
                <strong>{ev.type}</strong>
                <div className="mono">{new Date(ev.createdAt).toLocaleString()}</div>
                <div className="mono">{JSON.stringify(ev.data)}</div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
