import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { apiGet, fmtMoney } from '../api';
import { useAuth, hasRole } from '../auth.jsx';
import JsonLd from '../components/JsonLd.jsx';
import { buildStoreSchema } from '../utils/schemaMarkup.js';

export default function DashboardPage() {
  const { user } = useAuth();
  const summary = useQuery({ queryKey: ['sales-summary'], queryFn: () => apiGet('/api/reports/sales/summary') });
  const daily = useQuery({ queryKey: ['sales-daily-14'], queryFn: () => apiGet('/api/reports/sales/daily?days=14') });
  const inv = useQuery({ queryKey: ['inv-summary'], queryFn: () => apiGet('/api/reports/inventory/summary') });
  const lowStock = useQuery({ queryKey: ['low-stock'], queryFn: () => apiGet('/api/reports/inventory/low-stock?threshold=2') });

  const storeSchema = buildStoreSchema();

  return (
    <div className="space-y-6">
      <JsonLd schema={storeSchema} />
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Hi {user?.name?.split(' ')[0] || 'there'} 👋</h1>
        <p className="text-sm text-slate-500">Here's how Electronic Valet is doing today.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Today's sales" value={fmtMoney(summary.data?.today?.total)} sub={`${summary.data?.today?.count || 0} txns`} />
        <Stat label="Items sold today" value={summary.data?.today?.items ?? 0} />
        <Stat label="Last 7 days" value={fmtMoney(summary.data?.last_7_days?.total)} />
        <Stat label="Last 30 days" value={fmtMoney(summary.data?.last_30_days?.total)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card-pad lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold text-slate-700">Sales (last 14 days)</div>
            <Link to="/reports" className="text-xs text-primary-600 hover:underline">Detailed reports →</Link>
          </div>
          {daily.data?.series?.length ? (
            <div style={{ height: 220 }}>
              <ResponsiveContainer>
                <LineChart data={daily.data.series} margin={{ top: 5, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(v) => `$${v}`} />
                  <Tooltip formatter={(v) => fmtMoney(v)} />
                  <Line type="monotone" dataKey="total" stroke="#2563eb" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="text-sm text-slate-500 py-10 text-center">No sales yet. Start ringing them up in POS.</div>
          )}
        </div>

        <div className="space-y-4">
          {hasRole(user, 'employee') && (
            <div className="card-pad">
              <div className="font-semibold text-slate-700 mb-2">Inventory snapshot</div>
              <div className="space-y-2 text-sm">
                <Row label="Units in stock" value={inv.data?.units ?? '—'} />
                <Row label="Value at list" value={fmtMoney(inv.data?.total_at_list)} />
                {hasRole(user, 'manager') && <Row label="Value at cost" value={fmtMoney(inv.data?.total_at_cost)} />}
                {hasRole(user, 'manager') && <Row label="Value at market" value={fmtMoney(inv.data?.total_at_market)} />}
              </div>
            </div>
          )}

          <div className="card-pad">
            <div className="font-semibold text-slate-700 mb-2">Low stock</div>
            {lowStock.data?.data?.length ? (
              <ul className="space-y-1 text-sm">
                {lowStock.data.data.slice(0, 6).map((c) => (
                  <li key={c.id} className="flex items-center justify-between">
                    <span className="truncate">{c.name}</span>
                    <span className="badge-amber">{c.quantity} left</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-sm text-slate-500">No low-stock alerts. 🎉</div>
            )}
          </div>
        </div>
      </div>

      <div className="card-pad">
        <div className="font-semibold text-slate-700 mb-3">Quick actions</div>
        <div className="flex flex-wrap gap-2">
          {hasRole(user, 'employee') && <Link to="/pos" className="btn-primary">💰 New Sale</Link>}
          {hasRole(user, 'employee') && <Link to="/inventory" className="btn-secondary">📦 Add Inventory</Link>}
          {hasRole(user, 'employee') && <Link to="/customers" className="btn-secondary">👥 New Customer</Link>}
          {hasRole(user, 'employee') && <Link to="/reports" className="btn-secondary">📊 Reports</Link>}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="card-pad">
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mono text-2xl font-bold text-slate-800 mt-1">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="mono font-semibold text-slate-800">{value}</span>
    </div>
  );
}
