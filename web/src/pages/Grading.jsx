import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch, fmtMoney, fmtDate } from '../api';
import { useAuth, hasRole } from '../auth.jsx';

const SERVICES = ['PSA', 'BGS', 'CGC', 'SGC'];
const STATUSES = ['received', 'submitted', 'grading', 'returned', 'delivered', 'cancelled'];

// Visual hierarchy for status badges.
const STATUS_STYLES = {
  received:  'badge-blue',
  submitted: 'badge-blue',
  grading:   'badge-blue',
  returned:  'badge-green',
  delivered: 'badge-slate',
  cancelled: 'badge-red',
};

function emptyLine() {
  return { name: '', card_set: '', number: '', qty: 1, est_grade: '', declared_value: '', image_url: '' };
}

export default function GradingPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canManage = hasRole(user, 'employee');

  const [statusFilter, setStatusFilter] = useState('');
  const [serviceFilter, setServiceFilter] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [openId, setOpenId] = useState(null);

  const params = new URLSearchParams();
  if (statusFilter) params.set('status', statusFilter);
  if (serviceFilter) params.set('service', serviceFilter);
  params.set('limit', '200');

  const list = useQuery({
    queryKey: ['grading', statusFilter, serviceFilter],
    queryFn: () => apiGet(`/api/grading?${params}`),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Grading concierge</h1>
          <p className="text-sm text-slate-500">
            {list.data?.count != null ? `${list.data.count.toLocaleString()} submission${list.data.count === 1 ? '' : 's'}` : 'Loading…'}
            {' · '}PSA / BGS / CGC / SGC pipelines
          </p>
        </div>
        {canManage && (
          <button className="btn-primary" onClick={() => setShowNew(true)}>+ New submission</button>
        )}
      </div>

      <div className="card-pad flex flex-wrap gap-3 items-end">
        <div className="min-w-[180px]">
          <label className="label">Status</label>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="min-w-[160px]">
          <label className="label">Service</label>
          <select className="input" value={serviceFilter} onChange={(e) => setServiceFilter(e.target.value)}>
            <option value="">All services</option>
            {SERVICES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="card overflow-hidden">
        <table className="min-w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="table-th">Created</th>
              <th className="table-th">Service</th>
              <th className="table-th">Customer</th>
              <th className="table-th text-right">Cards</th>
              <th className="table-th text-right">Service fee</th>
              <th className="table-th text-right">Concierge</th>
              <th className="table-th">Status</th>
              <th className="table-th text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(list.data?.data || []).map((g) => {
              const totalCards = Array.isArray(g.cards) ? g.cards.reduce((s, c) => s + (Number(c.qty) || 0), 0) : 0;
              return (
                <tr key={g.id} className="table-tr">
                  <td className="table-td text-xs text-slate-500">{fmtDate(g.created_at)}</td>
                  <td className="table-td"><span className="badge-slate">{g.service}</span></td>
                  <td className="table-td">
                    {g.customer_id ? <a className="text-primary-700 hover:underline" href={`/customers/${g.customer_id}`}>view customer</a> : '—'}
                  </td>
                  <td className="table-td mono text-right">{totalCards}</td>
                  <td className="table-td mono text-right">{fmtMoney(g.service_fee)}</td>
                  <td className="table-td mono text-right">{fmtMoney(g.concierge_fee)}</td>
                  <td className="table-td"><span className={STATUS_STYLES[g.status] || 'badge-slate'}>{g.status}</span></td>
                  <td className="table-td text-right">
                    <button className="btn-ghost text-xs" onClick={() => setOpenId(g.id)}>Open →</button>
                  </td>
                </tr>
              );
            })}
            {!list.isLoading && (list.data?.data?.length === 0) && (
              <tr><td colSpan="8" className="px-4 py-10 text-center text-slate-500">No grading submissions yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showNew && (
        <NewSubmissionModal
          onClose={() => setShowNew(false)}
          onSaved={() => {
            setShowNew(false);
            queryClient.invalidateQueries({ queryKey: ['grading'] });
          }}
        />
      )}

      {openId && (
        <SubmissionDetailModal
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => queryClient.invalidateQueries({ queryKey: ['grading'] })}
          canManage={canManage}
        />
      )}
    </div>
  );
}

function NewSubmissionModal({ onClose, onSaved }) {
  const [customerQuery, setCustomerQuery] = useState('');
  const [customer, setCustomer] = useState(null);
  const [service, setService] = useState('PSA');
  const [lines, setLines] = useState([emptyLine()]);
  const [serviceFee, setServiceFee] = useState('');
  const [conciergeFee, setConciergeFee] = useState('');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);

  const search = useQuery({
    queryKey: ['customers', customerQuery],
    queryFn: () => apiGet(`/api/customers?q=${encodeURIComponent(customerQuery)}&limit=10`),
    enabled: customerQuery.length >= 2 && !customer,
    staleTime: 5000,
  });

  const setLine = (i, patch) => setLines((p) => p.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  const addLine = () => setLines((p) => [...p, emptyLine()]);
  const removeLine = (i) => setLines((p) => p.length > 1 ? p.filter((_, idx) => idx !== i) : p);

  const totalCards = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
  const totalDeclaredValue = lines.reduce((s, l) => s + (Number(l.declared_value) || 0) * (Number(l.qty) || 0), 0);

  const canSubmit = customer && service && lines.length > 0 && totalCards > 0
    && lines.every((l) => l.name && Number(l.qty) >= 1)
    && !saving;

  const submit = async () => {
    setErr(null); setSaving(true);
    try {
      const body = {
        customer_id:   customer.id,
        service,
        service_fee:   serviceFee === '' ? 0 : Number(serviceFee),
        concierge_fee: conciergeFee === '' ? 0 : Number(conciergeFee),
        notes:         notes || undefined,
        cards: lines.map((l) => ({
          name:           l.name.trim(),
          card_set:       l.card_set ? l.card_set.trim() : undefined,
          number:         l.number ? l.number.trim() : undefined,
          qty:            Number(l.qty),
          est_grade:      l.est_grade ? l.est_grade.trim() : undefined,
          declared_value: l.declared_value === '' ? undefined : Number(l.declared_value),
          image_url:      l.image_url ? l.image_url.trim() : undefined,
        })),
      };
      await apiPost('/api/grading', body);
      onSaved();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-30 bg-black/40 flex items-center justify-center p-4">
      <div className="card w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="text-lg font-bold">New grading submission</div>
          <button onClick={onClose} className="btn-ghost">✕</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="label">Customer</label>
            {customer ? (
              <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-primary-50 border border-primary-200">
                <div>
                  <div className="font-medium text-slate-900">{customer.name}</div>
                  <div className="text-xs text-slate-600">{customer.email || customer.phone || '—'}</div>
                </div>
                <button className="btn-ghost text-xs" onClick={() => { setCustomer(null); setCustomerQuery(''); }}>Change</button>
              </div>
            ) : (
              <div className="space-y-2">
                <input className="input" placeholder="Search by name, email, phone…" value={customerQuery} onChange={(e) => setCustomerQuery(e.target.value)} autoFocus />
                {customerQuery.length >= 2 && search.data && (
                  <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-48 overflow-y-auto">
                    {(search.data.data || []).map((c) => (
                      <button key={c.id} className="w-full text-left px-3 py-2 hover:bg-slate-50" onClick={() => setCustomer(c)}>
                        <div className="text-sm font-medium">{c.name}</div>
                        <div className="text-xs text-slate-500">{c.email || c.phone || '—'}</div>
                      </button>
                    ))}
                    {(search.data.data || []).length === 0 && (
                      <div className="px-3 py-3 text-xs text-slate-500 text-center">
                        No match. Add the customer on the <a href="/customers" className="text-primary-700 underline">Customers</a> page first.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="label">Service</label>
              <select className="input" value={service} onChange={(e) => setService(e.target.value)}>
                {SERVICES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Service fee (total)</label>
              <input className="input mono" type="number" min="0" step="0.01" value={serviceFee} onChange={(e) => setServiceFee(e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label className="label">Concierge fee</label>
              <input className="input mono" type="number" min="0" step="0.01" value={conciergeFee} onChange={(e) => setConciergeFee(e.target.value)} placeholder="0.00" />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-sm">Cards ({totalCards} total{totalDeclaredValue > 0 ? ` · declared value ${fmtMoney(totalDeclaredValue)}` : ''})</div>
              <button className="btn-secondary text-xs" onClick={addLine}>+ Add line</button>
            </div>
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
              {lines.map((l, i) => (
                <div key={i} className="p-3 grid grid-cols-12 gap-2">
                  <input className="input col-span-5" placeholder="Card name *" value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} />
                  <input className="input col-span-3" placeholder="Set" value={l.card_set} onChange={(e) => setLine(i, { card_set: e.target.value })} />
                  <input className="input col-span-2 mono text-right" type="number" min="1" placeholder="qty" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
                  <input className="input col-span-2" placeholder="Est. grade" value={l.est_grade} onChange={(e) => setLine(i, { est_grade: e.target.value })} />
                  <input className="input col-span-3" placeholder="Card #" value={l.number} onChange={(e) => setLine(i, { number: e.target.value })} />
                  <input className="input col-span-3 mono text-right" type="number" min="0" step="0.01" placeholder="Declared value" value={l.declared_value} onChange={(e) => setLine(i, { declared_value: e.target.value })} />
                  <input className="input col-span-5" placeholder="Image URL (optional)" value={l.image_url} onChange={(e) => setLine(i, { image_url: e.target.value })} />
                  <div className="col-span-1 text-right">
                    {lines.length > 1 && <button className="btn-ghost text-xs text-red-600" onClick={() => removeLine(i)}>✕</button>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Notes (optional)</label>
            <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. customer would like rush service if available" />
          </div>

          {err && <div className="text-sm text-red-600">{err}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={!canSubmit} onClick={submit}>
              {saving ? 'Saving…' : `Save submission (${totalCards} card${totalCards === 1 ? '' : 's'})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SubmissionDetailModal({ id, onClose, onChanged, canManage }) {
  const sub = useQuery({ queryKey: ['grading', id], queryFn: () => apiGet(`/api/grading/${id}`) });
  const [newStatus, setNewStatus] = useState('');
  const [returnedGrades, setReturnedGrades] = useState({});
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);

  const setRG = (idx, patch) => setReturnedGrades((p) => ({ ...p, [idx]: { ...(p[idx] || {}), ...patch } }));

  const advance = async () => {
    if (!newStatus) return;
    setErr(null); setSaving(true);
    try {
      // Only send returned_grades when transitioning to 'returned' (other
      // transitions don't expect them, and the server would ignore them).
      const body = { status: newStatus };
      if (newStatus === 'returned' && Object.keys(returnedGrades).length > 0) {
        body.returned_grades = returnedGrades;
      }
      await apiPatch(`/api/grading/${id}/status`, body);
      setNewStatus(''); setReturnedGrades({});
      sub.refetch(); onChanged();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (sub.isLoading) return null;
  if (sub.error)     return null;
  const g = sub.data;

  const terminal = g.status === 'delivered' || g.status === 'cancelled';
  const availableTransitions = terminal ? [] : STATUSES.filter((s) => s !== g.status);

  return (
    <div className="fixed inset-0 z-30 bg-black/40 flex items-center justify-center p-4">
      <div className="card w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-lg font-bold">{g.service} · {g.id.slice(0, 8)}</div>
            <div className="text-xs text-slate-500">
              Received {fmtDate(g.created_at)}
              {g.submitted_at && ` · Submitted ${fmtDate(g.submitted_at)}`}
              {g.returned_at && ` · Returned ${fmtDate(g.returned_at)}`}
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost">✕</button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
          <div className="card-pad">
            <div className="text-xs uppercase tracking-wider text-slate-500">Status</div>
            <div className="mt-1"><span className={STATUS_STYLES[g.status] || 'badge-slate'}>{g.status}</span></div>
          </div>
          <div className="card-pad">
            <div className="text-xs uppercase tracking-wider text-slate-500">Service fee</div>
            <div className="mono text-lg font-bold mt-1">{fmtMoney(g.service_fee)}</div>
          </div>
          <div className="card-pad">
            <div className="text-xs uppercase tracking-wider text-slate-500">Concierge fee</div>
            <div className="mono text-lg font-bold mt-1">{fmtMoney(g.concierge_fee)}</div>
          </div>
          <div className="card-pad">
            <div className="text-xs uppercase tracking-wider text-slate-500">Cards</div>
            <div className="mono text-lg font-bold mt-1">{(g.cards || []).reduce((s, c) => s + (Number(c.qty) || 0), 0)}</div>
          </div>
        </div>

        <div className="card overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-slate-200 font-semibold">Cards in this submission</div>
          <table className="min-w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="table-th">Name</th>
                <th className="table-th">Set / #</th>
                <th className="table-th text-right">Qty</th>
                <th className="table-th">Est. grade</th>
                <th className="table-th">Returned grade</th>
                <th className="table-th">Cert #</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(g.cards || []).map((c, i) => {
                const rg = returnedGrades[i] || {};
                const showReturnedInputs = canManage && newStatus === 'returned';
                return (
                  <tr key={i}>
                    <td className="table-td font-medium">{c.name}</td>
                    <td className="table-td text-xs text-slate-500">{c.card_set || '—'}{c.number ? ` · #${c.number}` : ''}</td>
                    <td className="table-td mono text-right">{c.qty}</td>
                    <td className="table-td">{c.est_grade || '—'}</td>
                    <td className="table-td">
                      {showReturnedInputs ? (
                        <input className="input mono w-24" placeholder="e.g. 9" value={rg.returned_grade || ''} onChange={(e) => setRG(i, { returned_grade: e.target.value })} />
                      ) : (
                        c.returned_grade || '—'
                      )}
                    </td>
                    <td className="table-td">
                      {showReturnedInputs ? (
                        <input className="input mono w-32" placeholder="cert #" value={rg.cert_number || ''} onChange={(e) => setRG(i, { cert_number: e.target.value })} />
                      ) : (
                        c.cert_number || '—'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {g.notes && (
          <div className="card-pad mb-4">
            <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">Notes</div>
            <div className="text-sm whitespace-pre-wrap">{g.notes}</div>
          </div>
        )}

        {canManage && !terminal && (
          <div className="card-pad space-y-3">
            <div className="font-semibold text-sm">Advance status</div>
            <div className="flex gap-2 flex-wrap items-end">
              <div>
                <label className="label">Next status</label>
                <select className="input" value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
                  <option value="">— Pick one —</option>
                  {availableTransitions.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <button className="btn-primary" disabled={!newStatus || saving} onClick={advance}>
                {saving ? 'Saving…' : 'Advance'}
              </button>
            </div>
            {newStatus === 'returned' && (
              <div className="text-xs text-slate-500">
                Fill in returned grades + cert numbers above to record them with this status change.
                Leave blank to update status only.
              </div>
            )}
            {err && <div className="text-sm text-red-600">{err}</div>}
          </div>
        )}

        {terminal && (
          <div className="text-xs text-slate-500 italic text-center pt-1">
            This submission is in a terminal state ({g.status}) and can no longer be advanced.
          </div>
        )}
      </div>
    </div>
  );
}
