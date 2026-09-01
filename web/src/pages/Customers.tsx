import { FormEvent, useEffect, useState } from "react";
import { api } from "../api";

interface Customer {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

export function Customers() {
  const [rows, setRows] = useState<Customer[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const data = await api<{ customers: Customer[] }>("/api/customers");
    setRows(data.customers);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api("/api/customers", { method: "POST", body: JSON.stringify({ name, email }) });
      setName("");
      setEmail("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create customer");
    }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Billable parties</p>
          <h1>Customers</h1>
        </div>
      </header>
      {error && <p className="banner error">{error}</p>}
      <div className="grid-2">
        <section className="card">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Added</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td className="mono">{c.email}</td>
                  <td className="mono">{new Date(c.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    No customers on this desk yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
        <form className="card form-card" onSubmit={onCreate}>
          <p className="eyebrow">Create</p>
          <label>
            Legal name
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            Billing email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <button type="submit">Add customer</button>
        </form>
      </div>
    </>
  );
}
