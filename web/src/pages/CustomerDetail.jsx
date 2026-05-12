import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, fmtMoney, fmtDate } from '../api';
import { useAuth, hasRole } from '../auth.jsx';

export default function CustomerDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const cust = useQuery({ queryKey: ['customer', id], queryFn: () => apiGet(`/api/customers/${id}`) });

  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState(null);

  const adjust = useMutation({
    mutationFn: () => apiPost(`/api/customers/${id}/adjust-credit`, { amount: Number(amount), reason }),
    onSuccess: () => {
      setAmount(''); setReason(''); setErr(null);
      queryClient.invalidateQueries({ queryKey: ['customer', id] });
    },
    onError: (e) => setErr(e.message),
  });

  if (cust.isLoading) return <div className="text-slate-500">Loading…</div>;
  if (cust.error)     return <div className="text-red-600">Error: {cust.error.message}</div>;
  const c = cust.data;

  return (
    <div className="space-y-4">
      <div>
        <Link to="/customers" className="text-sm text-primary-600">← Customers</Link>
        <h1 className="text-2xl font-bold mt-1">{c.name}</h1>
        <div className="text-sm text-slate-500">
          {c.email || '—'} · {c.phone || '—'} · since {fmtDate(c.created_at)}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Stat label="Store credit" value={fmtMoney(c.store_credit)} />
        <Stat label="Loyalty points" value={c.loyalty_points} sub={`worth ${fmtMoney(c.loyalty_points * 0.05)}`} />
        <Stat label="Total spent" value={fmtMoney(c.total_spent)} />
      </div>

      {hasRole(user, 'manager') && (
        <div className="card-pad">
          <div className="font-semibold mb-3">Adjust store credit</div>
          <div className="flex gap-2 flex-wrap items-end">
            <div>
              <label className="label">Amount (+/−)</label>
              <input className="input mono w-32" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="label">Reason</label>
              <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. comp for damaged card" />
            </div>
            <button
              className="btn-primary"
              disabled={!amount || !reason || adjust.isPending}
              onClick={() => adjust.mutate()}
            >
              {adjust.isPending ? 'Applying…' : 'Apply'}
            </button>
          </div>
          {err && <div className="text-sm text-red-600 mt-2">{err}</div>}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 font-semibold">Recent transactions</div>
        {(c.transactions?.length || 0) === 0 ? (
          <div className="p-6 text-sm text-slate-500 text-center">No transactions yet.</div>
        ) : (
          <table className="min-w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="table-th">Date</th>
                <th className="table-th">Method</th>
                <th className="table-th text-right">Items</th>
                <th className="table-th text-right">Total</th>
                <th className="table-th">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {c.transactions.map((t) => (
                <tr key={t.id} className="table-tr">
                  <td className="table-td text-xs text-slate-500">{fmtDate(t.created_at)}</td>
                  <td className="table-td"><span className="badge-slate">{t.payment_method}</span></td>
                  <td className="table-td mono text-right">{Array.isArray(t.items) ? t.items.reduce((s, l) => s + (Number(l.qty) || 0), 0) : 0}</td>
                  <td className="table-td mono text-right font-semibold">{fmtMoney(t.total)}</td>
                  <td className="table-td">{t.voided ? <span className="badge-red">Voided</span> : <span className="badge-green">Paid</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
