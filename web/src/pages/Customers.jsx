import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { apiGet, apiPost, fmtMoney, fmtDate } from '../api';
import { useAuth, hasRole } from '../auth.jsx';

export default function CustomersPage() {
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: ['customers', q],
    queryFn: () => apiGet(`/api/customers?q=${encodeURIComponent(q)}&limit=200`),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Customers</h1>
          <p className="text-sm text-slate-500">{list.data?.count != null ? `${list.data.count.toLocaleString()} total` : 'Loading…'}</p>
        </div>
        {hasRole(user, 'employee') && (
          <button className="btn-primary" onClick={() => setShowAdd(true)}>+ New customer</button>
        )}
      </div>

      <div className="card-pad">
        <label className="label">Search</label>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email, or phone…" />
      </div>

      <div className="card overflow-hidden">
        <table className="min-w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="table-th">Name</th>
              <th className="table-th">Email</th>
              <th className="table-th">Phone</th>
              <th className="table-th text-right">Credit</th>
              <th className="table-th text-right">Points</th>
              <th className="table-th text-right">Spent</th>
              <th className="table-th">Last visit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(list.data?.data || []).map((c) => (
              <tr key={c.id} className="table-tr">
                <td className="table-td">
                  <Link to={`/customers/${c.id}`} className="font-medium text-primary-700 hover:underline">{c.name}</Link>
                </td>
                <td className="table-td text-slate-500">{c.email || '—'}</td>
                <td className="table-td text-slate-500">{c.phone || '—'}</td>
                <td className="table-td mono text-right">{fmtMoney(c.store_credit)}</td>
                <td className="table-td mono text-right">{c.loyalty_points}</td>
                <td className="table-td mono text-right">{fmtMoney(c.total_spent)}</td>
                <td className="table-td text-xs text-slate-500">{c.last_visit_at ? fmtDate(c.last_visit_at) : '—'}</td>
              </tr>
            ))}
            {!list.isLoading && list.data?.data?.length === 0 && (
              <tr><td colSpan="7" className="px-4 py-10 text-center text-slate-500">No customers yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showAdd && <NewCustomerModal onClose={() => setShowAdd(false)} onSaved={() => queryClient.invalidateQueries({ queryKey: ['customers'] })} />}
    </div>
  );
}

function NewCustomerModal({ onClose, onSaved }) {
  const { register, handleSubmit, formState: { isSubmitting } } = useForm();
  const [err, setErr] = useState(null);

  const onSubmit = async (values) => {
    setErr(null);
    try {
      await apiPost('/api/customers', values);
      onSaved(); onClose();
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <div className="fixed inset-0 z-30 bg-black/40 flex items-center justify-center p-4">
      <div className="card w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="text-lg font-bold">New customer</div>
          <button onClick={onClose} className="btn-ghost">✕</button>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <div>
            <label className="label">Name *</label>
            <input className="input" autoFocus required {...register('name', { required: true })} />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" {...register('email')} />
          </div>
          <div>
            <label className="label">Phone</label>
            <input className="input" {...register('phone')} />
          </div>
          <div>
            <label className="label">Birthday</label>
            <input className="input" type="date" {...register('birthday')} />
          </div>
          <div>
            <label className="label">Notes</label>
            <textarea className="input" rows={2} {...register('notes')} />
          </div>
          {err && <div className="text-sm text-red-600">{err}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button disabled={isSubmitting} className="btn-primary">{isSubmitting ? 'Saving…' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
