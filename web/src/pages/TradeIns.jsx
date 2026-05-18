import { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, fmtMoney, fmtDate } from '../api';
import { useAuth, hasRole } from '../auth.jsx';
import JsonLd from '../components/JsonLd.jsx';
import { buildStoreSchema, buildOfferSchema } from '../utils/schemaMarkup.js';

const GAMES = ['pokemon', 'magic', 'yugioh', 'onepiece', 'other'];
const CONDITIONS = ['NM', 'LP', 'MP', 'HP', 'DMG', 'SEALED'];

function emptyLine() {
  return {
    name: '',
    game: 'pokemon',
    card_set: '',
    condition: 'NM',
    qty: 1,
    market_price: '',
    buy_price: '',
    add_to_inventory: true,
  };
}

export default function TradeInsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const canTrade = hasRole(user, 'employee');

  const [customerQuery, setCustomerQuery] = useState('');
  const [customer, setCustomer] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [lines, setLines] = useState([emptyLine()]);
  const [notes, setNotes] = useState('');
  const [defaultBuyPct, setDefaultBuyPct] = useState(0.6);
  const [storeCreditBonus, setStoreCreditBonus] = useState(0.1);
  const [submitErr, setSubmitErr] = useState(null);
  const [submitOk, setSubmitOk] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Settings — for the default_buy_percentage suggested in the buy_price column.
  useEffect(() => {
    apiGet('/api/cards?limit=1').catch(() => {});
    apiGet('/api/settings').then((s) => {
      if (s?.default_buy_percentage !== undefined) setDefaultBuyPct(Number(s.default_buy_percentage));
      if (s?.store_credit_bonus !== undefined) setStoreCreditBonus(Number(s.store_credit_bonus));
    }).catch(() => {});
  }, []);

  // Customer typeahead search (200ms debounced via @tanstack/react-query staleTime).
  const customerSearch = useQuery({
    queryKey: ['customers', customerQuery],
    queryFn: () => apiGet(`/api/customers?q=${encodeURIComponent(customerQuery)}&limit=10`),
    enabled: customerQuery.length >= 2 && !customer,
    staleTime: 5000,
  });

  // Recent trade-ins list (lower half of the page).
  const recent = useQuery({
    queryKey: ['trade-ins-recent'],
    queryFn: () => apiGet('/api/trade-ins?limit=20'),
  });

  // Compute the offer client-side so the operator sees totals update as they
  // type. The server re-computes from the same logic before saving, so this
  // display is purely cosmetic — it can drift slightly if defaults change
  // mid-form, but the persisted total is always authoritative.
  const totals = useMemo(() => {
    let baseline = 0;
    const computed = lines.map((l) => {
      const qty = Math.max(0, Number(l.qty) || 0);
      const market = Math.max(0, Number(l.market_price) || 0);
      const buy = l.buy_price === '' || l.buy_price === null
        ? Math.round(market * defaultBuyPct * 100) / 100
        : Math.max(0, Number(l.buy_price) || 0);
      const lineTotal = Math.round(buy * qty * 100) / 100;
      baseline += lineTotal;
      return { qty, market, buy, lineTotal };
    });
    baseline = Math.round(baseline * 100) / 100;
    const bonus = paymentMethod === 'store_credit'
      ? Math.round(baseline * storeCreditBonus * 100) / 100
      : 0;
    const total = Math.round((baseline + bonus) * 100) / 100;
    return { computed, baseline, bonus, total };
  }, [lines, paymentMethod, defaultBuyPct, storeCreditBonus]);

  const setLine = (i, patch) => setLines((prev) => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (i) => setLines((prev) => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev);

  const canSubmit = canTrade && customer && lines.length > 0 && totals.total >= 0 && !submitting
    && lines.every((l) => l.name && Number(l.qty) >= 1 && Number(l.market_price) >= 0);

  const submit = async () => {
    setSubmitErr(null); setSubmitOk(null); setSubmitting(true);
    try {
      const body = {
        customer_id:    customer.id,
        payment_method: paymentMethod,
        notes:          notes || undefined,
        cards: lines.map((l) => ({
          name:             l.name.trim(),
          game:             l.game,
          card_set:         l.card_set ? l.card_set.trim() : undefined,
          condition:        l.condition,
          qty:              Number(l.qty),
          market_price:     Number(l.market_price),
          buy_price:        l.buy_price === '' ? undefined : Number(l.buy_price),
          add_to_inventory: !!l.add_to_inventory,
        })),
      };
      const trade = await apiPost('/api/trade-ins', body);
      setSubmitOk(trade);
      // Reset form for the next trade-in.
      setLines([emptyLine()]); setNotes(''); setCustomer(null); setCustomerQuery('');
      queryClient.invalidateQueries({ queryKey: ['trade-ins-recent'] });
      queryClient.invalidateQueries({ queryKey: ['cards'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    } catch (e) {
      setSubmitErr(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const storeSchema = buildStoreSchema();
  const offerSchemas = lines
    .filter((l) => l.name && l.buy_price)
    .map((l) => buildOfferSchema(l, l.buy_price));

  return (
    <div className="space-y-4">
      <JsonLd schema={[storeSchema, ...offerSchemas]} />
      <div>
        <h1 className="text-2xl font-bold">Trade-ins & Buylist</h1>
        <p className="text-sm text-slate-500">
          Accept customer cards, pay cash or store credit, and roll them into inventory.
        </p>
      </div>

      {!canTrade && (
        <div className="card-pad bg-amber-50 border-amber-200 text-amber-800 text-sm">
          Trade-ins require an employee role or above. Ask a manager to process this transaction.
        </div>
      )}

      <div className="card-pad space-y-3">
        <div className="font-semibold">1. Customer</div>
        {customer ? (
          <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-primary-50 border border-primary-200">
            <div>
              <div className="font-medium text-slate-900">{customer.name}</div>
              <div className="text-xs text-slate-600">
                {customer.email || '—'} · {customer.phone || '—'} · Credit: {fmtMoney(customer.store_credit)}
              </div>
            </div>
            <button className="btn-ghost text-xs" onClick={() => { setCustomer(null); setCustomerQuery(''); }}>Change</button>
          </div>
        ) : (
          <div className="space-y-2">
            <input
              className="input"
              placeholder="Search by name, email, or phone…"
              value={customerQuery}
              onChange={(e) => setCustomerQuery(e.target.value)}
            />
            {customerQuery.length >= 2 && customerSearch.data && (
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-60 overflow-y-auto">
                {(customerSearch.data.data || []).map((c) => (
                  <button
                    key={c.id}
                    className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center justify-between"
                    onClick={() => { setCustomer(c); }}
                  >
                    <div>
                      <div className="text-sm font-medium">{c.name}</div>
                      <div className="text-xs text-slate-500">{c.email || c.phone || '—'}</div>
                    </div>
                    <div className="text-xs mono text-slate-500">Credit {fmtMoney(c.store_credit)}</div>
                  </button>
                ))}
                {(customerSearch.data.data || []).length === 0 && (
                  <div className="px-3 py-4 text-sm text-slate-500 text-center">
                    No match. Add the customer on the <a href="/customers" className="text-primary-700 underline">Customers</a> page first.
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 font-semibold flex items-center justify-between">
          <span>2. Cards being traded in</span>
          {canTrade && <button className="btn-secondary text-xs" onClick={addLine}>+ Add line</button>}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="table-th">Card</th>
                <th className="table-th">Game</th>
                <th className="table-th">Set</th>
                <th className="table-th">Cond.</th>
                <th className="table-th text-right">Qty</th>
                <th className="table-th text-right">Market</th>
                <th className="table-th text-right">Buy</th>
                <th className="table-th text-right">Line total</th>
                <th className="table-th">Inv?</th>
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((l, i) => (
                <tr key={i} className="align-top">
                  <td className="px-3 py-2"><input className="input" value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} placeholder="Charizard Holo…" /></td>
                  <td className="px-3 py-2">
                    <select className="input" value={l.game} onChange={(e) => setLine(i, { game: e.target.value })}>
                      {GAMES.map((g) => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2"><input className="input" value={l.card_set} onChange={(e) => setLine(i, { card_set: e.target.value })} placeholder="Base Set" /></td>
                  <td className="px-3 py-2">
                    <select className="input" value={l.condition} onChange={(e) => setLine(i, { condition: e.target.value })}>
                      {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-right"><input className="input mono text-right w-20" type="number" min="1" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></td>
                  <td className="px-3 py-2 text-right"><input className="input mono text-right w-28" type="number" min="0" step="0.01" value={l.market_price} onChange={(e) => setLine(i, { market_price: e.target.value })} /></td>
                  <td className="px-3 py-2 text-right">
                    <input
                      className="input mono text-right w-28"
                      type="number" min="0" step="0.01"
                      placeholder={l.market_price ? (Math.round(Number(l.market_price) * defaultBuyPct * 100) / 100).toFixed(2) : ''}
                      value={l.buy_price}
                      onChange={(e) => setLine(i, { buy_price: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-2 text-right mono font-semibold">{fmtMoney(totals.computed[i]?.lineTotal || 0)}</td>
                  <td className="px-3 py-2 text-center">
                    <input type="checkbox" checked={l.add_to_inventory} onChange={(e) => setLine(i, { add_to_inventory: e.target.checked })} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    {lines.length > 1 && (
                      <button className="btn-ghost text-xs text-red-600" onClick={() => removeLine(i)}>✕</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card-pad space-y-3">
        <div className="font-semibold">3. Payout</div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">Payment method</label>
            <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
              <button
                className={`px-4 py-2 text-sm font-medium ${paymentMethod === 'cash' ? 'bg-primary-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
                onClick={() => setPaymentMethod('cash')}
              >
                Cash
              </button>
              <button
                className={`px-4 py-2 text-sm font-medium ${paymentMethod === 'store_credit' ? 'bg-primary-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
                onClick={() => setPaymentMethod('store_credit')}
              >
                Store credit (+{Math.round(storeCreditBonus * 100)}%)
              </button>
            </div>
          </div>
          <div className="flex-1 min-w-[240px]">
            <label className="label">Notes (optional)</label>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. lot from estate, condition agreed-upon" />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Stat label="Baseline offer" value={fmtMoney(totals.baseline)} />
          <Stat label="Store credit bonus" value={fmtMoney(totals.bonus)} sub={paymentMethod === 'store_credit' ? `+${Math.round(storeCreditBonus * 100)}% applied` : 'cash payout — no bonus'} />
          <Stat label="Total payout" value={fmtMoney(totals.total)} highlight />
        </div>

        <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-200">
          <div className="text-sm text-slate-600">
            {customer ? <>Pays out to <b>{customer.name}</b> as <b>{paymentMethod === 'cash' ? 'cash' : 'store credit'}</b>.</> : 'Pick a customer to enable submit.'}
          </div>
          <button className="btn-primary" disabled={!canSubmit} onClick={submit}>
            {submitting ? 'Saving…' : `Complete trade-in (${fmtMoney(totals.total)})`}
          </button>
        </div>

        {submitErr && <div className="text-sm text-red-600 pt-1">{submitErr}</div>}
        {submitOk && (
          <div className="text-sm text-emerald-700 pt-1">
            ✓ Trade-in saved ({submitOk.id.slice(0, 8)}…) — paid {fmtMoney(submitOk.total_offer)} as {submitOk.payment_method.replace('_', ' ')}.
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 font-semibold">Recent trade-ins</div>
        {recent.isLoading ? (
          <div className="p-6 text-sm text-slate-500 text-center">Loading…</div>
        ) : (recent.data?.data || []).length === 0 ? (
          <div className="p-6 text-sm text-slate-500 text-center">No trade-ins yet.</div>
        ) : (
          <table className="min-w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="table-th">Date</th>
                <th className="table-th">Customer</th>
                <th className="table-th text-right">Cards</th>
                <th className="table-th">Method</th>
                <th className="table-th text-right">Bonus</th>
                <th className="table-th text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(recent.data?.data || []).map((t) => (
                <tr key={t.id} className="table-tr">
                  <td className="table-td text-xs text-slate-500">{fmtDate(t.created_at)}</td>
                  <td className="table-td">{t.customer_id ? <a href={`/customers/${t.customer_id}`} className="text-primary-700 hover:underline">view customer</a> : '—'}</td>
                  <td className="table-td mono text-right">{Array.isArray(t.cards) ? t.cards.reduce((s, l) => s + (Number(l.qty) || 0), 0) : 0}</td>
                  <td className="table-td"><span className="badge-slate">{t.payment_method.replace('_', ' ')}</span></td>
                  <td className="table-td mono text-right text-emerald-700">{fmtMoney(t.store_credit_bonus)}</td>
                  <td className="table-td mono text-right font-semibold">{fmtMoney(t.total_offer)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, highlight }) {
  return (
    <div className={`card-pad ${highlight ? 'bg-primary-50 border-primary-200' : ''}`}>
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mono text-2xl font-bold mt-1 ${highlight ? 'text-primary-700' : 'text-slate-800'}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}
