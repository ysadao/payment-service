import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { Shell } from "./layout";
import { Customers } from "./pages/Customers";
import { Dashboard } from "./pages/Dashboard";
import { Forgot } from "./pages/Forgot";
import { Ledger } from "./pages/Ledger";
import { Login } from "./pages/Login";
import { PaymentDetail } from "./pages/PaymentDetail";
import { Payments } from "./pages/Payments";
import { Register } from "./pages/Register";
import { Reset } from "./pages/Reset";
import { Sessions } from "./pages/Sessions";
import { Verify } from "./pages/Verify";

function Guard({ children }: { children: JSX.Element }) {
  const { user, ready } = useAuth();
  if (!ready) return <div className="boot">Opening the books…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot" element={<Forgot />} />
      <Route path="/reset" element={<Reset />} />
      <Route path="/verify" element={<Verify />} />
      <Route
        element={
          <Guard>
            <Shell />
          </Guard>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/payments" element={<Payments />} />
        <Route path="/payments/:id" element={<PaymentDetail />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/ledger" element={<Ledger />} />
        <Route path="/sessions" element={<Sessions />} />
      </Route>
    </Routes>
  );
}
