import { useQuery } from '@tanstack/react-query';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend } from 'recharts';
import { apiGet, fmtMoney } from '../api';
import { useAuth, hasRole } from '../auth.jsx';

export default function ReportsPage() {
  const { user } = useAuth();
  const summary = useQuery({ queryKey: ['rep-sales-summary'], queryFn: () => apiGet('/api/reports/sales/summary') });
  const daily = useQuery({ queryKey: ['rep-sales-daily-30'], queryFn: () => apiGet('/api/reports/sales/daily?days=30') });
  const inv = useQuery({ queryKey: ['rep-inv'], queryFn: () => apiGet('/api/reports/inventory/summary') });
  const profit = useQuery({
    queryKey: ['rep-profit-30'],
    queryFn: () => apiGet('/api/reports/profit?days=30'),
    enabled: hasRole(user, 'manager'),
  });
  const topCustomers = useQuery({
    queryKey: ['rep-top-cust'],
    queryFn: () => apiGet('/api/reports/customers/top'),
    enabled: hasRole(user, 'manager'),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Reports</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Today" value={fmtMoney(summary.data?.today?.total)} sub={`${summary.data?.today?.count || 0} txns`} />
        <Stat label="Last 7 days" value={fmtMoney(summary.data?.last_7_days?.total)} />
        <Stat label="Last 30 days" value={fmtMoney(summary.data?.last_30_days?.total)} />
        <Stat label="All time" value={fmtMoney(summary.data?.all_time?.total)} />
      </div>

      <div className="card-pad">
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold">Sales — last 30 days</div>
        </div>
        <div style={{ height: 280 }}>
          <ResponsiveContainer>
            <LineChart data={daily.data?.series || []} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} />
              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(v) => `$${v}`} />
              <Tooltip formatter={(v) => fmtMoney(v)} />
              <Legend />
              <Line type="monotone" dataKey="total" stroke="#2563eb" strokeWidth={2} name="Revenue" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card-pad">
          <div className="font-semibold mb-2">Inventory value</div>
          <table className="w-full text-sm">
            <tbody>
              <Row k="Units in stock" v={inv.data?.units ?? '—'} />
              <Row k="Value at list" v={fmtMoney(inv.data?.total_at_list)} />
              {hasRole(user, 'manager') && <Row k="Value at cost" v={fmtMoney(inv.data?.total_at_cost)} />}
              {hasRole(user, 'manager') && <Row k="Value at market" v={fmtMoney(inv.data?.total_at_market)} />}
            </tbody>
          </table>
          <div className="font-semibold mt-4 mb-2 text-sm">By game</div>
          <BreakdownChart data={inv.data?.by_game} />
        </div>

        {hasRole(user, 'manager') && (
          <div className="card-pad">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold">Profit — last 30 days</div>
              {profit.data && (
                <span className="badge-blue">Margin {profit.data.margin}%</span>
              )}
            </div>
            <div className="space-y-1 text-sm">
              <Row k="Revenue" v={fmtMoney(profit.data?.revenue)} />
              <Row k="Cost of goods" v={fmtMoney(profit.data?.cost)} />
              <Row k="Profit"  v={fmtMoney(profit.data?.profit)} bold />
            </div>
            <div style={{ height: 220 }} className="mt-3">
              <ResponsiveContainer>
                <LineChart data={profit.data?.series || []}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(v) => `$${v}`} />
                  <Tooltip formatter={(v) => fmtMoney(v)} />
                  <Line type="monotone" dataKey="revenue" stroke="#2563eb" strokeWidth={2} name="Revenue" dot={false} />
                  <Line type="monotone" dataKey="profit"  stroke="#10b981" strokeWidth={2} name="Profit" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {hasRole(user, 'manager') && topCustomers.data?.data?.length > 0 && (
        <div className="card-pad">
          <div className="font-semibold mb-2">Top customers</div>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="table-th">Customer</th>
                <th className="table-th text-right">Total spent</th>
                <th className="table-th text-right">Loyalty pts</th>
              </tr>
            </thead>
            <tbody>
              {topCustomers.data.data.map((c) => (
                <tr key={c.id} className="table-tr">
                  <td className="table-td">{c.name}</td>
                  <td className="table-td mono text-right">{fmtMoney(c.total_spent)}</td>
                  <td className="table-td mono text-right">{c.loyalty_points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
function Row({ k, v, bold }) {
  return (
    <tr>
      <td className="py-1 text-slate-500">{k}</td>
      <td className={`py-1 mono text-right ${bold ? 'font-bold text-slate-900' : ''}`}>{v}</td>
    </tr>
  );
}
function BreakdownChart({ data }) {
  if (!data || Object.keys(data).length === 0) return <div className="text-xs text-slate-500">No data</div>;
  const arr = Object.entries(data).map(([k, v]) => ({ name: k, value: Number(v) }));
  return (
    <div style={{ height: 180 }}>
      <ResponsiveContainer>
        <BarChart data={arr}>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} />
          <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(v) => `$${v}`} />
          <Tooltip formatter={(v) => fmtMoney(v)} />
          <Bar dataKey="value" fill="#3b82f6" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
