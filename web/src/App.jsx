import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth.jsx';
import Layout from './components/Layout.jsx';
import LoginPage from './pages/Login.jsx';
import DashboardPage from './pages/Dashboard.jsx';
import InventoryPage from './pages/Inventory.jsx';
import POSPage from './pages/POS.jsx';
import CustomersPage from './pages/Customers.jsx';
import CustomerDetailPage from './pages/CustomerDetail.jsx';
import ReportsPage from './pages/Reports.jsx';
import UsersPage from './pages/Users.jsx';
import SettingsPage from './pages/Settings.jsx';

function Protected({ children }) {
  const { user, loaded } = useAuth();
  if (!loaded) return <div className="p-10 text-center text-slate-500">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/*"
          element={
            <Protected>
              <Layout>
                <Routes>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/inventory" element={<InventoryPage />} />
                  <Route path="/pos" element={<POSPage />} />
                  <Route path="/customers" element={<CustomersPage />} />
                  <Route path="/customers/:id" element={<CustomerDetailPage />} />
                  <Route path="/reports" element={<ReportsPage />} />
                  <Route path="/users" element={<UsersPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Layout>
            </Protected>
          }
        />
      </Routes>
    </AuthProvider>
  );
}
