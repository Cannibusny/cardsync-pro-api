import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer, Legend, PieChart, Pie, Cell,
} from 'recharts';
import { apiGet, fmtMoney } from '../api';
import { useAuth, hasRole } from '../auth.jsx';

const GAME_LABEL = {
  pokemon:  'Pokémon',
  magic:    'Magic',
  yugioh:   'Yu-Gi-Oh',
  onepiece: 'One Piece',
  other:    'Other',
  unknown:  'Uncategorized',
};

const RANGE_OPTIONS = [
  { value: 7,   label: '7 days' },
  { value: 30,  label: '30 days' },
  { value: 90,  label: '90 days' },
  { value: 365, label: '1 year' },
];

const PIE_COLORS = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];

function fmtPct(n) { return n == null ? '—' : `${n.toFixed(1)}%`; }

export default function ReportsPage() {
  const { user } = useAuth();
  const [days, setDays] = useState(30);
  const isManager = hasRole(user, 'manager');

  const summary = useQuery({ queryKey: ['rep-sales-summary'], queryFn: () => apiGet('/api/reports/sales/summary') });
  const daily   = useQuery({ queryKey: ['rep-sales-daily', days], queryFn: () => apiGet(`/api/reports/sales/daily?days=${days}`) });
  const inv     = useQuery({ queryKey: ['rep-inv'], queryFn: () => apiGet('/api/reports/inventory/summary') });
  const profit  = useQuery({
    queryKey: ['rep-profit', days],
    queryFn: () => apiGet(`/api/reports/profit?days=${days}`),
    enabled: isManager,
  });
  const topCustomers = useQuery({
    queryKey: ['rep-top-cust'],
    queryFn: () => apiGet('/api/reports/customers/top'),
    enabled: isManager,
  });

  // Phase 2E — analytics queries.
  const profitByGame   = useQuery({
    queryKey: ['rep-profit-by-game', days],
    queryFn: () => apiGet(`/api/reports/profit/by-game?days=${days}`),
    enabled: isManager,
  });
  const topMovers      = useQuery({
    queryKey: ['rep-top-movers', days],
    queryFn: () => apiGet(`/api/reports/sales/top-movers?days=${days}&limit=10`),
    enabled: isManager,
  });
  const slowMovers     = useQuery({
    queryKey: ['rep-slow-movers', days],
    queryFn: () => apiGet(`/api/reports/sales/slow-movers?days=${days}&limit=20`),
    enabled: isManager,
  });
  const tradeInSummary = useQuery({
    queryKey: ['rep-trade-ins', days],
    queryFn: () => apiGet(`/api/reports/trade-ins/summary?days=${days}`),
    enabled: isManager,
  });
  const gradingSummary = useQuery({
    queryKey: ['rep-grading', days],
    queryFn: () => apiGet(`/api/reports/grading/summary?days=${days}`),
    enabled: isManager,
  });
  const employees      = useQuery({
    queryKey: ['rep-employees', days],
    queryFn: () => apiGet(`/api/reports/employees/performance?days=${days}`),
    enabled: isManager,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold">Reports & analytics</h1>
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-slate-500">Window:</span>
          {RANGE_OPTIONS.map((r) => (
            <button
              key={r.value}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${days === r.value ? 'bg-primary-50 border-primary-300 text-primary-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              onClick={() => setDays(r.value)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Today" value={fmtMoney(summary.data?.today?.total)} sub={`${summary.data?.today?.count || 0} txns`} />
        <Stat label="Last 7 days" value={fmtMoney(summary.data?.last_7_days?.total)} />
        <Stat label="Last 30 days" value={fmtMoney(summary.data?.last_30_days?.total)} />
        <Stat label="All time" value={fmtMoney(summary.data?.all_time?.total)} />
      </div>

      <div className="card-pad">
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold">Sales — last {days} days</div>
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
              {isManager && <Row k="Value at cost" v={fmtMoney(inv.data?.total_at_cost)} />}
              {isManager && <Row k="Value at market" v={fmtMoney(inv.data?.total_at_market)} />}
            </tbody>
          </table>
          <div className="font-semibold mt-4 mb-2 text-sm">By game</div>
          <BreakdownChart data={inv.data?.by_game} />
        </div>

        {isManager && (
          <div className="card-pad">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold">Profit — last {days} days</div>
              {profit.data && <span className="badge-blue">Margin {profit.data.margin}%</span>}
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

      {isManager && (
        <div className="card-pad">
          <div className="font-semibold mb-3">Per-game profitability — last {days} days</div>
          {(profitByGame.data?.series?.length || 0) === 0 ? (
            <div className="text-sm text-slate-500 py-6 text-center">No sales in this window.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200">
                  <tr>
                    <th className="table-th">Game</th>
                    <th className="table-th text-right">Units</th>
                    <th className="table-th text-right">Revenue</th>
                    <th className="table-th text-right">Cost</th>
                    <th className="table-th text-right">Profit</th>
                    <th className="table-th text-right">Margin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {profitByGame.data.series.map((g) => (
                    <tr key={g.game} className="table-tr">
                      <td className="table-td font-medium">{GAME_LABEL[g.game] || g.game}</td>
                      <td className="table-td mono text-right">{g.units}</td>
                      <td className="table-td mono text-right">{fmtMoney(g.revenue)}</td>
                      <td className="table-td mono text-right text-slate-500">{fmtMoney(g.cost)}</td>
                      <td className="table-td mono text-right font-semibold text-emerald-700">{fmtMoney(g.profit)}</td>
                      <td className="table-td mono text-right">{fmtPct(g.margin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ height: 260 }}>
                <ResponsiveContainer>
                  <BarChart data={profitByGame.data.series}>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                    <XAxis dataKey="game" tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(g) => GAME_LABEL[g] || g} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(v) => `$${v}`} />
                    <Tooltip formatter={(v) => fmtMoney(v)} />
                    <Legend />
                    <Bar dataKey="revenue" fill="#2563eb" name="Revenue" />
                    <Bar dataKey="profit"  fill="#10b981" name="Profit" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}

      {isManager && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card-pad">
            <div className="font-semibold mb-2">Top movers — last {days} days</div>
            <MoverTable rows={topMovers.data?.data || []} mode="top" empty="No sales in this window." />
          </div>
          <div className="card-pad">
            <div className="font-semibold mb-2">Slow movers — capital locked, 0 sales in {days} days</div>
            <MoverTable rows={slowMovers.data?.data || []} mode="slow" empty="Nothing's idle — every card in stock has moved recently." />
          </div>
        </div>
      )}

      {isManager && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="card-pad">
            <div className="font-semibold mb-3">Trade-in mix — last {days} days</div>
            <TradeInBlock data={tradeInSummary.data} />
          </div>
          <div className="card-pad">
            <div className="font-semibold mb-3">Grading concierge — last {days} days</div>
            <GradingBlock data={gradingSummary.data} />
          </div>
          <div className="card-pad">
            <div className="font-semibold mb-3">Staff performance — last {days} days</div>
            <EmployeeTable rows={employees.data?.data || []} />
          </div>
        </div>
      )}

      {isManager && topCustomers.data?.data?.length > 0 && (
        <div className="card-pad">
          <div className="font-semibold mb-2">Top customers (all time)</div>
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

function MoverTable({ rows, mode, empty }) {
  if (!rows.length) return <div className="text-sm text-slate-500 py-4 text-center">{empty}</div>;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="border-b border-slate-200">
          <tr>
            <th className="table-th">Card</th>
            {mode === 'top' ? (
              <>
                <th className="table-th text-right">Units sold</th>
                <th className="table-th text-right">Revenue</th>
                <th className="table-th text-right">In stock</th>
              </>
            ) : (
              <>
                <th className="table-th text-right">In stock</th>
                <th className="table-th text-right">Capital locked</th>
              </>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.card_id || r.id} className="table-tr">
              <td className="table-td">
                <div className="font-medium text-slate-900 truncate max-w-[260px]" title={r.name}>{r.name || '—'}</div>
                <div className="text-xs text-slate-500">
                  {r.game ? (GAME_LABEL[r.game] || r.game) : ''}{r.card_set ? ` · ${r.card_set}` : ''}{r.number ? ` #${r.number}` : ''}
                </div>
              </td>
              {mode === 'top' ? (
                <>
                  <td className="table-td mono text-right">{r.units}</td>
                  <td className="table-td mono text-right">{fmtMoney(r.revenue)}</td>
                  <td className="table-td mono text-right text-slate-500">{r.in_stock ?? '—'}</td>
                </>
              ) : (
                <>
                  <td className="table-td mono text-right">{r.quantity}</td>
                  <td className="table-td mono text-right">{fmtMoney(r.capital_locked)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TradeInBlock({ data }) {
  if (!data) return <div className="text-sm text-slate-500">Loading…</div>;
  if (!data.count) return <div className="text-sm text-slate-500 py-4 text-center">No trade-ins in this window.</div>;
  const cash = data.by_method?.cash || { count: 0, total: 0 };
  const credit = data.by_method?.store_credit || { count: 0, total: 0 };
  const pie = [
    { name: 'Cash', value: cash.total },
    { name: 'Store credit', value: credit.total },
  ].filter((s) => s.value > 0);
  return (
    <div className="space-y-3">
      <table className="w-full text-sm">
        <tbody>
          <Row k="Total trade-ins" v={data.count} />
          <Row k="Cards taken in" v={data.total_cards} />
          <Row k="Cash paid out" v={fmtMoney(cash.total)} />
          <Row k="Store credit issued" v={fmtMoney(credit.total)} />
          <Row k="Bonus paid" v={fmtMoney(data.total_bonus)} />
          <Row k="Total offered" v={fmtMoney(data.total_offered)} bold />
        </tbody>
      </table>
      {pie.length > 0 && (
        <div style={{ height: 140 }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie data={pie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={55} label={(d) => `${d.name}: ${fmtMoney(d.value)}`}>
                {pie.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v) => fmtMoney(v)} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function GradingBlock({ data }) {
  if (!data) return <div className="text-sm text-slate-500">Loading…</div>;
  if (!data.count) return <div className="text-sm text-slate-500 py-4 text-center">No grading submissions in this window.</div>;
  const services = Object.entries(data.by_service || {}).map(([svc, v]) => ({ name: svc, ...v }));
  const statuses = Object.entries(data.by_status || {});
  return (
    <div className="space-y-3">
      <table className="w-full text-sm">
        <tbody>
          <Row k="Submissions" v={data.count} />
          <Row k="Cards graded" v={data.total_cards} />
          <Row k="Revenue (fees)" v={fmtMoney(data.total_revenue)} bold />
        </tbody>
      </table>
      {services.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">By service</div>
          <table className="w-full text-sm">
            <tbody>
              {services.map((s) => (
                <tr key={s.name}>
                  <td className="py-1 text-slate-700"><span className="badge-slate">{s.name}</span></td>
                  <td className="py-1 mono text-right text-slate-500">{s.count}</td>
                  <td className="py-1 mono text-right">{fmtMoney(s.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {statuses.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">By status</div>
          <div className="flex flex-wrap gap-1.5">
            {statuses.map(([k, v]) => (
              <span key={k} className="badge-blue">{k}: {v}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EmployeeTable({ rows }) {
  if (!rows.length) return <div className="text-sm text-slate-500 py-4 text-center">No transactions in this window.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-slate-200">
          <tr>
            <th className="table-th">Operator</th>
            <th className="table-th text-right">Txns</th>
            <th className="table-th text-right">Items</th>
            <th className="table-th text-right">Revenue</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.user_id || 'unattributed'} className="table-tr">
              <td className="table-td">
                <div className="font-medium">{r.name}</div>
                {r.role && <div className="text-xs text-slate-500">{r.role}</div>}
              </td>
              <td className="table-td mono text-right">{r.transactions}</td>
              <td className="table-td mono text-right text-slate-500">{r.items}</td>
              <td className="table-td mono text-right font-semibold">{fmtMoney(r.revenue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
  const arr = Object.entries(data).map(([k, v]) => ({ name: GAME_LABEL[k] || k, value: Number(v) }));
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
