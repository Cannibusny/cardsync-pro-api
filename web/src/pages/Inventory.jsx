import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { apiGet, apiPost, apiPatch, apiDel, fmtMoney } from '../api';
import { useAuth, hasRole } from '../auth.jsx';

const GAMES = ['pokemon','magic','yugioh','onepiece','other'];
const CONDITIONS = ['NM','LP','MP','HP','DMG','SEALED'];
const PRODUCT_TYPES = ['single','sealed','graded','supply','other'];

export default function InventoryPage() {
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [game, setGame] = useState('');
  const [editing, setEditing] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const queryClient = useQueryClient();

  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (game) params.set('game', game);
  params.set('limit', '200');

  const cards = useQuery({
    queryKey: ['cards', q, game],
    queryFn: () => apiGet(`/api/cards?${params}`),
  });

  const deleteCard = useMutation({
    mutationFn: (id) => apiDel(`/api/cards/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cards'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Inventory</h1>
          <p className="text-sm text-slate-500">
            {cards.data?.count != null ? `${cards.data.count.toLocaleString()} cards` : 'Loading…'}
          </p>
        </div>
        <div className="flex gap-2">
          {hasRole(user, 'manager') && (
            <button className="btn-secondary" onClick={() => setShowImport(true)}>
              📤 Bulk CSV
            </button>
          )}
          {hasRole(user, 'employee') && (
            <button className="btn-primary" onClick={() => setShowAdd(true)}>
              + Add Card
            </button>
          )}
        </div>
      </div>

      <div className="card-pad flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[240px]">
          <label className="label">Search</label>
          <input
            className="input"
            placeholder="Card name…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
        </div>
        <div>
          <label className="label">Game</label>
          <select className="input" value={game} onChange={(e) => setGame(e.target.value)}>
            <option value="">All</option>
            {GAMES.map((g) => <option key={g}>{g}</option>)}
          </select>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="table-th">Name</th>
                <th className="table-th">Game / Set</th>
                <th className="table-th">Cond</th>
                <th className="table-th text-right">Qty</th>
                {hasRole(user, 'manager') && <th className="table-th text-right">Cost</th>}
                <th className="table-th text-right">Price</th>
                {hasRole(user, 'manager') && <th className="table-th text-right">Market</th>}
                <th className="table-th">Loc</th>
                <th className="table-th" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(cards.data?.data || []).map((c) => (
                <tr key={c.id} className="table-tr">
                  <td className="table-td">
                    <div className="font-medium text-slate-800">{c.name}</div>
                    {c.graded && (
                      <div className="badge-amber mt-0.5">
                        {c.grade_service} {c.grade}
                        {c.cert_number ? ` · #${c.cert_number}` : ''}
                      </div>
                    )}
                  </td>
                  <td className="table-td text-slate-500">
                    <div>{c.game}</div>
                    <div className="text-xs">{c.card_set}</div>
                  </td>
                  <td className="table-td">
                    <span className="badge-slate">{c.condition}</span>
                  </td>
                  <td className="table-td mono text-right">{c.quantity}</td>
                  {hasRole(user, 'manager') && <td className="table-td mono text-right">{fmtMoney(c.cost_basis)}</td>}
                  <td className="table-td mono text-right">{fmtMoney(c.sell_price)}</td>
                  {hasRole(user, 'manager') && <td className="table-td mono text-right text-slate-500">{c.market_price ? fmtMoney(c.market_price) : '—'}</td>}
                  <td className="table-td text-slate-500">{c.location || '—'}</td>
                  <td className="table-td text-right whitespace-nowrap">
                    {hasRole(user, 'employee') && (
                      <button className="btn-ghost text-xs" onClick={() => setEditing(c)}>Edit</button>
                    )}
                    {hasRole(user, 'manager') && (
                      <button
                        className="btn-ghost text-xs text-red-600"
                        onClick={() => { if (confirm(`Delete "${c.name}"?`)) deleteCard.mutate(c.id); }}
                      >
                        Del
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!cards.isLoading && cards.data?.data?.length === 0 && (
                <tr><td colSpan="9" className="px-4 py-10 text-center text-slate-500">No cards found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {(showAdd || editing) && (
        <CardModal
          card={editing}
          onClose={() => { setShowAdd(false); setEditing(null); }}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['cards'] })}
        />
      )}
      {showImport && <ImportModal onClose={() => setShowImport(false)} onDone={() => queryClient.invalidateQueries({ queryKey: ['cards'] })} />}
    </div>
  );
}

function CardModal({ card, onClose, onSaved }) {
  const { user } = useAuth();
  const isEdit = !!card;
  const { register, handleSubmit, formState: { isSubmitting } } = useForm({
    defaultValues: card || {
      name: '', game: 'pokemon', card_set: '', condition: 'NM',
      quantity: 1, cost_basis: 0, sell_price: 0, product_type: 'single', location: '',
    },
  });
  const [err, setErr] = useState(null);

  const onSubmit = async (values) => {
    setErr(null);
    try {
      // Coerce numbers (RHF passes strings for number inputs).
      const payload = {
        ...values,
        quantity:    Number(values.quantity),
        cost_basis:  values.cost_basis === '' ? 0 : Number(values.cost_basis),
        sell_price:  values.sell_price === '' ? 0 : Number(values.sell_price),
        tcgplayer_id: values.tcgplayer_id ? Number(values.tcgplayer_id) : undefined,
      };
      // Employees can't change cost/price on edit.
      if (isEdit && user?.role === 'employee') {
        delete payload.cost_basis;
        delete payload.sell_price;
      }
      if (isEdit) await apiPatch(`/api/cards/${card.id}`, payload);
      else        await apiPost('/api/cards', payload);
      onSaved();
      onClose();
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <div className="fixed inset-0 z-30 bg-black/40 flex items-center justify-center p-4">
      <div className="card w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="text-lg font-bold">{isEdit ? 'Edit card' : 'Add card to inventory'}</div>
          <button className="btn-ghost" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="label">Name *</label>
            <input className="input" required {...register('name', { required: true })} />
          </div>
          <div>
            <label className="label">Game *</label>
            <select className="input" {...register('game')}>{GAMES.map((g) => <option key={g}>{g}</option>)}</select>
          </div>
          <div>
            <label className="label">Set</label>
            <input className="input" {...register('card_set')} />
          </div>
          <div>
            <label className="label">Condition</label>
            <select className="input" {...register('condition')}>{CONDITIONS.map((c) => <option key={c}>{c}</option>)}</select>
          </div>
          <div>
            <label className="label">Product type</label>
            <select className="input" {...register('product_type')}>{PRODUCT_TYPES.map((c) => <option key={c}>{c}</option>)}</select>
          </div>
          <div>
            <label className="label">Quantity</label>
            <input className="input" type="number" min="0" step="1" {...register('quantity')} />
          </div>
          <div>
            <label className="label">Location</label>
            <input className="input" placeholder="Shelf A / Bin 3" {...register('location')} />
          </div>
          {hasRole(user, 'manager') && (
            <>
              <div>
                <label className="label">Cost basis</label>
                <input className="input mono" type="number" step="0.01" min="0" {...register('cost_basis')} />
              </div>
              <div>
                <label className="label">Sell price</label>
                <input className="input mono" type="number" step="0.01" min="0" {...register('sell_price')} />
              </div>
            </>
          )}
          <div>
            <label className="label">TCGplayer ID</label>
            <input className="input" type="number" {...register('tcgplayer_id')} />
          </div>
          <div className="col-span-2">
            <label className="label">Notes</label>
            <textarea className="input" rows={2} {...register('notes')} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...register('graded')} /> Graded card
          </label>
          <div>
            <label className="label">Grade service</label>
            <select className="input" {...register('grade_service')}>
              <option value="">—</option>
              <option>PSA</option><option>BGS</option><option>CGC</option><option>SGC</option>
            </select>
          </div>
          <div>
            <label className="label">Grade</label>
            <input className="input" placeholder="10 / 9.5 / …" {...register('grade')} />
          </div>
          <div>
            <label className="label">Cert #</label>
            <input className="input" {...register('cert_number')} />
          </div>
          {err && <div className="col-span-2 text-sm text-red-600">{err}</div>}
          <div className="col-span-2 flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button disabled={isSubmitting} className="btn-primary">{isSubmitting ? 'Saving…' : (isEdit ? 'Save' : 'Add card')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ImportModal({ onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);

  const onChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null); setBusy(true); setResult(null);
    try {
      const fd = new FormData(); fd.append('file', file);
      const resp = await fetch('/api/upload/cards', { method: 'POST', credentials: 'include', body: fd });
      const body = await resp.json();
      if (!resp.ok) throw new Error(body.error || 'Upload failed');
      setResult(body);
      onDone();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-30 bg-black/40 flex items-center justify-center p-4">
      <div className="card w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="text-lg font-bold">Bulk import (CSV)</div>
          <button className="btn-ghost" onClick={onClose}>✕</button>
        </div>
        <p className="text-sm text-slate-600">
          Upload a CSV with at least <code className="bg-slate-100 px-1 rounded">name</code> and{' '}
          <code className="bg-slate-100 px-1 rounded">game</code> columns. Optional columns:{' '}
          <span className="font-mono text-xs">set, condition, quantity, cost_basis, sell_price, location, graded, grade_service, grade, cert_number, tcgplayer_id, image_url, notes</span>.
          Max 5,000 rows / 10 MB per upload.
        </p>
        <input
          type="file" accept=".csv,text/csv" className="block mt-4 text-sm"
          onChange={onChange} disabled={busy}
        />
        {busy && <div className="mt-3 text-sm text-slate-500">Uploading…</div>}
        {err && <div className="mt-3 text-sm text-red-600">{err}</div>}
        {result && (
          <div className="mt-4 text-sm bg-slate-50 border border-slate-200 rounded p-3 space-y-1">
            <div><strong>Inserted:</strong> <span className="mono">{result.inserted}</span> / {result.total_rows}</div>
            {result.skipped > 0 && <div><strong>Skipped:</strong> {result.skipped}</div>}
            {result.errors?.length > 0 && <div className="text-red-700">Errors: {result.errors.length}</div>}
          </div>
        )}
        <div className="mt-5 text-right">
          <button onClick={onClose} className="btn-secondary">Done</button>
        </div>
      </div>
    </div>
  );
}
