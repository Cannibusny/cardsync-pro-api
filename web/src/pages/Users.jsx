import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { apiGet, apiPost, apiPatch, apiDel, fmtDate } from '../api';
import { useAuth, hasRole } from '../auth.jsx';

const ROLES = ['owner','manager','employee','view_only'];

export default function UsersPage() {
  const { user } = useAuth();
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ['users'], queryFn: () => apiGet('/api/users') });

  if (!hasRole(user, 'manager')) {
    return <div className="text-slate-500">You don't have access to this page.</div>;
  }

  const remove = useMutation({
    mutationFn: (id) => apiDel(`/api/users/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Staff</h1>
          <p className="text-sm text-slate-500">Operator accounts and roles</p>
        </div>
        {hasRole(user, 'owner') && <button className="btn-primary" onClick={() => setShowAdd(true)}>+ Add user</button>}
      </div>

      <div className="card overflow-hidden">
        <table className="min-w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="table-th">Name</th>
              <th className="table-th">Email</th>
              <th className="table-th">Role</th>
              <th className="table-th">Status</th>
              <th className="table-th">Last sign-in</th>
              {hasRole(user, 'owner') && <th className="table-th" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(list.data?.data || []).map((u) => (
              <tr key={u.id} className="table-tr">
                <td className="table-td font-medium">{u.name}</td>
                <td className="table-td text-slate-500">{u.email}</td>
                <td className="table-td"><span className="badge-blue">{u.role}</span></td>
                <td className="table-td">{u.active ? <span className="badge-green">Active</span> : <span className="badge-slate">Disabled</span>}</td>
                <td className="table-td text-xs text-slate-500">{u.last_login_at ? fmtDate(u.last_login_at) : '—'}</td>
                {hasRole(user, 'owner') && (
                  <td className="table-td text-right whitespace-nowrap">
                    <button className="btn-ghost text-xs" onClick={() => setEditing(u)}>Edit</button>
                    {u.id !== user.id && (
                      <button
                        className="btn-ghost text-xs text-red-600"
                        onClick={() => { if (confirm(`Delete ${u.name}?`)) remove.mutate(u.id); }}
                      >Del</button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(showAdd || editing) && (
        <UserModal
          existing={editing}
          onClose={() => { setShowAdd(false); setEditing(null); }}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['users'] })}
        />
      )}
    </div>
  );
}

function UserModal({ existing, onClose, onSaved }) {
  const isEdit = !!existing;
  const { register, handleSubmit, formState: { isSubmitting } } = useForm({ defaultValues: existing || { role: 'employee', active: true } });
  const [err, setErr] = useState(null);

  const onSubmit = async (values) => {
    setErr(null);
    try {
      if (isEdit) {
        const payload = { name: values.name, role: values.role, active: !!values.active };
        if (values.password) payload.password = values.password;
        await apiPatch(`/api/users/${existing.id}`, payload);
      } else {
        await apiPost('/api/users', values);
      }
      onSaved(); onClose();
    } catch (e) { setErr(e.message); }
  };

  return (
    <div className="fixed inset-0 z-30 bg-black/40 flex items-center justify-center p-4">
      <div className="card w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="text-lg font-bold">{isEdit ? `Edit ${existing.name}` : 'Add user'}</div>
          <button onClick={onClose} className="btn-ghost">✕</button>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <div><label className="label">Name *</label><input className="input" required {...register('name', { required: true })} /></div>
          <div>
            <label className="label">Email *</label>
            <input className="input" type="email" required disabled={isEdit} {...register('email', { required: true })} />
          </div>
          <div>
            <label className="label">Role *</label>
            <select className="input" {...register('role')}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
          </div>
          <div>
            <label className="label">{isEdit ? 'Reset password (optional)' : 'Password *'}</label>
            <input className="input" type="password" minLength={8} required={!isEdit} {...register('password')} />
          </div>
          {isEdit && (
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register('active')} /> Active</label>
          )}
          {err && <div className="text-sm text-red-600">{err}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button disabled={isSubmitting} className="btn-primary">{isSubmitting ? 'Saving…' : (isEdit ? 'Save' : 'Add')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
