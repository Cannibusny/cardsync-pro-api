import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  apiGet, apiPost, apiPatch, apiDelete, fmtMoney, fmtDate,
} from '../api';
import { useAuth, hasRole } from '../auth.jsx';

const EVENT_TYPES = [
  'pokemon-tournament',
  'pokemon-prerelease',
  'magic-tournament',
  'magic-draft',
  'magic-prerelease',
  'yugioh-tournament',
  'onepiece-tournament',
  'workshop',
  'casual-play',
  'release-party',
  'other',
];

const TYPE_LABEL = {
  'pokemon-tournament':  'Pokémon Tournament',
  'pokemon-prerelease':  'Pokémon Prerelease',
  'magic-tournament':    'Magic Tournament',
  'magic-draft':         'Magic Draft',
  'magic-prerelease':    'Magic Prerelease',
  'yugioh-tournament':   'Yu-Gi-Oh Tournament',
  'onepiece-tournament': 'One Piece Tournament',
  'workshop':            'Workshop',
  'casual-play':         'Casual Play',
  'release-party':       'Release Party',
  'other':               'Other',
};

function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

function toLocalDatetimeInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function EventsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canEdit   = hasRole(user, 'employee');   // roster updates
  const canManage = hasRole(user, 'manager');    // create / edit / delete event itself

  const [when, setWhen] = useState('upcoming');
  const [typeFilter, setTypeFilter] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [openId, setOpenId] = useState(null);

  const params = new URLSearchParams();
  params.set('when', when);
  if (typeFilter) params.set('event_type', typeFilter);
  params.set('limit', '200');

  const list = useQuery({
    queryKey: ['events', when, typeFilter],
    queryFn: () => apiGet(`/api/events?${params}`),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Events</h1>
          <p className="text-sm text-slate-500">
            {list.data?.count != null ? `${list.data.count.toLocaleString()} event${list.data.count === 1 ? '' : 's'}` : 'Loading…'}
            {' · '}tournaments, drafts, prereleases, workshops
          </p>
        </div>
        {canManage && (
          <button className="btn-primary" onClick={() => setShowNew(true)}>+ New event</button>
        )}
      </div>

      <div className="card-pad flex flex-wrap gap-3 items-end">
        <div className="min-w-[160px]">
          <label className="label">When</label>
          <select className="input" value={when} onChange={(e) => setWhen(e.target.value)}>
            <option value="upcoming">Upcoming</option>
            <option value="past">Past</option>
            <option value="all">All</option>
          </select>
        </div>
        <div className="min-w-[200px]">
          <label className="label">Type</label>
          <select className="input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All types</option>
            {EVENT_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t] || t}</option>)}
          </select>
        </div>
      </div>

      <div className="card overflow-hidden">
        <table className="min-w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="table-th">Date</th>
              <th className="table-th">Name</th>
              <th className="table-th">Type</th>
              <th className="table-th text-right">Entry fee</th>
              <th className="table-th text-right">Registered</th>
              <th className="table-th text-right">Revenue</th>
              <th className="table-th text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(list.data?.data || []).map((e) => {
              const participants = Array.isArray(e.participants) ? e.participants : [];
              const paidCount = participants.filter((p) => p.paid && !p.dropped).length;
              const revenue   = paidCount * Number(e.entry_fee || 0);
              return (
                <tr key={e.id} className="table-tr">
                  <td className="table-td text-xs text-slate-700 whitespace-nowrap">{fmtDateTime(e.event_date)}</td>
                  <td className="table-td font-medium text-slate-900">{e.name}</td>
                  <td className="table-td"><span className="badge-slate">{TYPE_LABEL[e.event_type] || e.event_type}</span></td>
                  <td className="table-td mono text-right">{fmtMoney(e.entry_fee)}</td>
                  <td className="table-td mono text-right">
                    {participants.length}{e.capacity != null && <span className="text-slate-400"> / {e.capacity}</span>}
                  </td>
                  <td className="table-td mono text-right">{fmtMoney(revenue)}</td>
                  <td className="table-td text-right">
                    <button className="btn-ghost text-xs" onClick={() => setOpenId(e.id)}>Open →</button>
                  </td>
                </tr>
              );
            })}
            {!list.isLoading && (list.data?.data?.length === 0) && (
              <tr><td colSpan="7" className="px-4 py-10 text-center text-slate-500">No events {when === 'upcoming' ? 'scheduled' : 'in this view'}.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showNew && (
        <NewEventModal
          onClose={() => setShowNew(false)}
          onSaved={() => {
            setShowNew(false);
            queryClient.invalidateQueries({ queryKey: ['events'] });
          }}
        />
      )}

      {openId && (
        <EventDetailModal
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => queryClient.invalidateQueries({ queryKey: ['events'] })}
          canEdit={canEdit}
          canManage={canManage}
        />
      )}
    </div>
  );
}

function NewEventModal({ onClose, onSaved }) {
  const [name, setName] = useState('');
  const [eventType, setEventType] = useState('pokemon-tournament');
  const [eventDate, setEventDate] = useState('');
  const [entryFee, setEntryFee] = useState('');
  const [capacity, setCapacity] = useState('');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);

  const canSubmit = name.trim() && eventType && eventDate && !saving;

  const submit = async () => {
    setErr(null); setSaving(true);
    try {
      const body = {
        name: name.trim(),
        event_type: eventType,
        event_date: new Date(eventDate).toISOString(),
        entry_fee: entryFee === '' ? 0 : Number(entryFee),
        capacity: capacity === '' ? undefined : Number(capacity),
        notes: notes.trim() || undefined,
      };
      await apiPost('/api/events', body);
      onSaved();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-30 bg-black/40 flex items-center justify-center p-4">
      <div className="card w-full max-w-xl max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="text-lg font-bold">New event</div>
          <button onClick={onClose} className="btn-ghost">✕</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="label">Name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Friday Night Magic — Modern" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Type</label>
              <select className="input" value={eventType} onChange={(e) => setEventType(e.target.value)}>
                {EVENT_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t] || t}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Date / time</label>
              <input className="input" type="datetime-local" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Entry fee ($)</label>
              <input className="input" type="number" step="0.01" min="0" value={entryFee} onChange={(e) => setEntryFee(e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label className="label">Capacity</label>
              <input className="input" type="number" step="1" min="0" value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="(unlimited)" />
            </div>
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea className="input" rows="3" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Prize pool, judge, format details…" />
          </div>

          {err && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{err}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={!canSubmit} onClick={submit}>{saving ? 'Saving…' : 'Save event'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EventDetailModal({ id, onClose, onChanged, canEdit, canManage }) {
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ['event', id],
    queryFn: () => apiGet(`/api/events/${id}`),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['event', id] });
    onChanged?.();
  };

  if (!detail.data) {
    return (
      <div className="fixed inset-0 z-30 bg-black/40 flex items-center justify-center p-4">
        <div className="card w-full max-w-3xl p-6">
          <div className="flex items-center justify-between mb-2">
            <div className="text-lg font-bold">Event</div>
            <button onClick={onClose} className="btn-ghost">✕</button>
          </div>
          <div className="text-sm text-slate-500 py-10 text-center">Loading…</div>
        </div>
      </div>
    );
  }

  const ev = detail.data;
  const participants = Array.isArray(ev.participants) ? ev.participants : [];
  const paidCount = participants.filter((p) => p.paid && !p.dropped).length;
  const revenue   = paidCount * Number(ev.entry_fee || 0);

  return (
    <div className="fixed inset-0 z-30 bg-black/40 flex items-center justify-center p-4">
      <div className="card w-full max-w-4xl max-h-[92vh] overflow-y-auto p-6">
        <div className="flex items-start justify-between mb-2 gap-3">
          <div className="min-w-0">
            <div className="text-lg font-bold truncate">{ev.name}</div>
            <div className="text-xs text-slate-500 mt-1">
              {fmtDateTime(ev.event_date)} · <span className="badge-slate">{TYPE_LABEL[ev.event_type] || ev.event_type}</span>
              {' · '}entry {fmtMoney(ev.entry_fee)}{ev.capacity != null && ` · cap ${ev.capacity}`}
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost">✕</button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
          <Stat label="Registered" value={participants.length} />
          <Stat label="Paid" value={paidCount} />
          <Stat label="Revenue" value={fmtMoney(revenue)} />
        </div>

        <Section title="Participants">
          {canEdit && <AddParticipant eventId={ev.id} onAdded={invalidate} />}
          <ParticipantTable
            eventId={ev.id}
            participants={participants}
            canEdit={canEdit}
            onChanged={invalidate}
          />
        </Section>

        {canManage && (
          <Section title="Results">
            <ResultsEditor eventId={ev.id} initial={ev.results} onSaved={invalidate} />
          </Section>
        )}
        {!canManage && ev.results && (
          <Section title="Results">
            <pre className="text-xs bg-slate-50 border border-slate-200 rounded p-3 overflow-x-auto">{JSON.stringify(ev.results, null, 2)}</pre>
          </Section>
        )}

        {canManage && (
          <Section title="Edit / delete event">
            <EditEventForm event={ev} onSaved={invalidate} onDeleted={() => { onChanged?.(); onClose(); }} />
          </Section>
        )}

        {ev.notes && (
          <Section title="Notes">
            <div className="text-sm text-slate-700 whitespace-pre-wrap">{ev.notes}</div>
          </Section>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-semibold text-slate-900 mt-0.5 mono">{value}</div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="mt-5">
      <div className="text-sm font-semibold text-slate-800 mb-2">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function AddParticipant({ eventId, onAdded }) {
  const [customerQuery, setCustomerQuery] = useState('');
  const [customer, setCustomer] = useState(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [paid, setPaid] = useState(false);
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);

  const search = useQuery({
    queryKey: ['customers', customerQuery],
    queryFn: () => apiGet(`/api/customers?q=${encodeURIComponent(customerQuery)}&limit=8`),
    enabled: customerQuery.length >= 2 && !customer,
    staleTime: 5000,
  });

  const submit = async () => {
    setErr(null); setSaving(true);
    try {
      const body = {
        name: (customer?.name || name).trim(),
        email: (customer?.email || email)?.trim() || undefined,
        customer_id: customer?.id || undefined,
        paid,
      };
      if (!body.name) throw new Error('Participant name is required');
      await apiPost(`/api/events/${eventId}/participants`, body);
      setCustomer(null); setCustomerQuery(''); setName(''); setEmail(''); setPaid(false);
      onAdded();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="rounded-lg border border-slate-200 p-3 bg-white space-y-3">
      <div className="text-xs font-medium text-slate-600">Register a participant</div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="label">Existing customer (optional)</label>
          {customer ? (
            <div className="flex items-center justify-between gap-2 p-2 rounded bg-primary-50 border border-primary-200 text-sm">
              <span><span className="font-medium">{customer.name}</span> <span className="text-xs text-slate-500">{customer.email || customer.phone || ''}</span></span>
              <button className="btn-ghost text-xs" onClick={() => { setCustomer(null); setCustomerQuery(''); }}>change</button>
            </div>
          ) : (
            <div className="space-y-2">
              <input className="input" placeholder="Search…" value={customerQuery} onChange={(e) => setCustomerQuery(e.target.value)} />
              {customerQuery.length >= 2 && (search.data?.data?.length ? (
                <div className="border border-slate-200 rounded bg-white max-h-40 overflow-y-auto">
                  {search.data.data.map((c) => (
                    <button
                      key={c.id} className="w-full text-left px-2 py-1.5 hover:bg-slate-50 border-b border-slate-100 last:border-0"
                      onClick={() => { setCustomer(c); setName(c.name); setEmail(c.email || ''); }}
                    >
                      <div className="font-medium text-sm">{c.name}</div>
                      <div className="text-xs text-slate-500">{c.email || c.phone || ''}</div>
                    </button>
                  ))}
                </div>
              ) : (
                !search.isLoading && <div className="text-xs text-slate-500 px-2">No matches.</div>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3">
          <div>
            <label className="label">Name (walk-in if no customer)</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="optional" />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
          Entry fee already paid
        </label>
        <button className="btn-primary text-sm" disabled={saving || !((customer?.name || name).trim())} onClick={submit}>
          {saving ? 'Adding…' : '+ Register'}
        </button>
      </div>

      {err && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{err}</div>}
    </div>
  );
}

function ParticipantTable({ eventId, participants, canEdit, onChanged }) {
  const [busyIdx, setBusyIdx] = useState(null);

  const togglePaid = async (idx, paid) => {
    setBusyIdx(idx);
    try { await apiPatch(`/api/events/${eventId}/participants/${idx}`, { paid }); onChanged(); }
    finally { setBusyIdx(null); }
  };
  const toggleDropped = async (idx, dropped) => {
    setBusyIdx(idx);
    try { await apiPatch(`/api/events/${eventId}/participants/${idx}`, { dropped }); onChanged(); }
    finally { setBusyIdx(null); }
  };
  const remove = async (idx) => {
    if (!confirm('Remove this participant?')) return;
    setBusyIdx(idx);
    try { await apiDelete(`/api/events/${eventId}/participants/${idx}`); onChanged(); }
    finally { setBusyIdx(null); }
  };

  if (!participants.length) {
    return <div className="text-sm text-slate-500 px-1 py-2">No participants registered yet.</div>;
  }

  return (
    <div className="card overflow-hidden">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="table-th">Name</th>
            <th className="table-th">Email</th>
            <th className="table-th text-center">Paid</th>
            <th className="table-th text-center">Dropped</th>
            {canEdit && <th className="table-th text-right"></th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {participants.map((p, i) => (
            <tr key={i} className="table-tr">
              <td className="table-td font-medium">{p.name}</td>
              <td className="table-td text-slate-600">{p.email || '—'}</td>
              <td className="table-td text-center">
                {canEdit ? (
                  <input type="checkbox" checked={!!p.paid} disabled={busyIdx === i} onChange={(e) => togglePaid(i, e.target.checked)} />
                ) : (p.paid ? '✓' : '—')}
              </td>
              <td className="table-td text-center">
                {canEdit ? (
                  <input type="checkbox" checked={!!p.dropped} disabled={busyIdx === i} onChange={(e) => toggleDropped(i, e.target.checked)} />
                ) : (p.dropped ? '✓' : '—')}
              </td>
              {canEdit && (
                <td className="table-td text-right">
                  <button className="btn-ghost text-xs text-red-700" disabled={busyIdx === i} onClick={() => remove(i)}>Remove</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultsEditor({ eventId, initial, onSaved }) {
  const initialWinners = Array.isArray(initial?.winners) ? initial.winners : [];
  const [bracket, setBracket] = useState(typeof initial?.bracket === 'string' ? initial.bracket : (initial?.bracket ? JSON.stringify(initial.bracket, null, 2) : ''));
  const [winners, setWinners] = useState(
    initialWinners.length ? initialWinners : [{ place: 1, name: '', prize: '' }],
  );
  const [notes, setNotes] = useState(initial?.notes || '');
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);

  const setWinner = (i, patch) => setWinners((p) => p.map((w, idx) => idx === i ? { ...w, ...patch } : w));
  const addWinner = () => setWinners((p) => [...p, { place: p.length + 1, name: '', prize: '' }]);
  const removeWinner = (i) => setWinners((p) => p.filter((_, idx) => idx !== i));

  const save = async () => {
    setErr(null); setSaving(true);
    try {
      const cleanWinners = winners
        .map((w) => ({ place: Number(w.place) || null, name: w.name?.trim() || '', prize: w.prize?.trim() || '' }))
        .filter((w) => w.name);
      const results = {
        bracket: bracket.trim() || undefined,
        winners: cleanWinners,
        notes:   notes.trim() || undefined,
      };
      await apiPatch(`/api/events/${eventId}/results`, { results });
      onSaved();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="label">Bracket / standings (freeform text)</label>
        <textarea className="input" rows="4" value={bracket} onChange={(e) => setBracket(e.target.value)} placeholder="e.g. R1: Alice bt. Bob; R2: ..." />
      </div>

      <div>
        <label className="label">Winners</label>
        <div className="space-y-2">
          {winners.map((w, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <input className="input col-span-2" type="number" min="1" value={w.place} onChange={(e) => setWinner(i, { place: e.target.value })} placeholder="#" />
              <input className="input col-span-5" value={w.name} onChange={(e) => setWinner(i, { name: e.target.value })} placeholder="Name" />
              <input className="input col-span-4" value={w.prize} onChange={(e) => setWinner(i, { prize: e.target.value })} placeholder="Prize" />
              <button className="col-span-1 btn-ghost text-xs text-red-700" onClick={() => removeWinner(i)} disabled={winners.length === 1}>✕</button>
            </div>
          ))}
          <button className="btn-ghost text-xs" onClick={addWinner}>+ Add winner</button>
        </div>
      </div>

      <div>
        <label className="label">Notes</label>
        <textarea className="input" rows="2" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything else worth recording…" />
      </div>

      {err && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{err}</div>}

      <div className="flex justify-end">
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save results'}</button>
      </div>
    </div>
  );
}

function EditEventForm({ event, onSaved, onDeleted }) {
  const [name, setName] = useState(event.name || '');
  const [eventType, setEventType] = useState(event.event_type || 'other');
  const [eventDate, setEventDate] = useState(toLocalDatetimeInput(event.event_date));
  const [entryFee, setEntryFee] = useState(event.entry_fee != null ? String(event.entry_fee) : '');
  const [capacity, setCapacity] = useState(event.capacity != null ? String(event.capacity) : '');
  const [notes, setNotes] = useState(event.notes || '');
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const save = async () => {
    setErr(null); setSaving(true);
    try {
      const body = {
        name: name.trim(),
        event_type: eventType,
        event_date: new Date(eventDate).toISOString(),
        entry_fee: entryFee === '' ? 0 : Number(entryFee),
        capacity: capacity === '' ? null : Number(capacity),
        notes: notes.trim(),
      };
      await apiPatch(`/api/events/${event.id}`, body);
      onSaved();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    if (!confirm(`Delete "${event.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try { await apiDelete(`/api/events/${event.id}`); onDeleted(); }
    catch (e) { setErr(e.message); setDeleting(false); }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">Type</label>
          <select className="input" value={eventType} onChange={(e) => setEventType(e.target.value)}>
            {EVENT_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t] || t}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Date / time</label>
          <input className="input" type="datetime-local" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Entry fee</label>
            <input className="input" type="number" min="0" step="0.01" value={entryFee} onChange={(e) => setEntryFee(e.target.value)} />
          </div>
          <div>
            <label className="label">Capacity</label>
            <input className="input" type="number" min="0" step="1" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          </div>
        </div>
      </div>
      <div>
        <label className="label">Notes</label>
        <textarea className="input" rows="3" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {err && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{err}</div>}

      <div className="flex justify-between items-center pt-1">
        <button className="btn-ghost text-xs text-red-700" onClick={remove} disabled={deleting || saving}>
          {deleting ? 'Deleting…' : 'Delete event'}
        </button>
        <button className="btn-primary" onClick={save} disabled={saving || deleting}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
