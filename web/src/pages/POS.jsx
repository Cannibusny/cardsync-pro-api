import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, fmtMoney } from '../api';

const PAYMENT_METHODS = [
  { v: 'cash',         label: 'Cash' },
  { v: 'credit',       label: 'Credit / Debit' },
  { v: 'store_credit', label: 'Store credit' },
  { v: 'stripe',       label: 'Stripe terminal' },
  { v: 'split',        label: 'Split' },
];

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

export default function POSPage() {
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState([]);
  const [discount, setDiscount] = useState(0);
  const [taxRate, setTaxRate] = useState(0.08);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [cashTendered, setCashTendered] = useState('');
  const [redeemCredit, setRedeemCredit] = useState(0);
  const [redeemPoints, setRedeemPoints] = useState(0);
  const [customer, setCustomer] = useState(null);
  const [customerQuery, setCustomerQuery] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [err, setErr] = useState(null);
  const queryClient = useQueryClient();

  const search = useQuery({
    queryKey: ['pos-search', query],
    queryFn:  () => apiGet(`/api/cards?q=${encodeURIComponent(query)}&in_stock=true&limit=20`),
    enabled:  query.trim().length > 1,
  });

  const customerSearch = useQuery({
    queryKey: ['pos-cust', customerQuery],
    queryFn:  () => apiGet(`/api/customers?q=${encodeURIComponent(customerQuery)}&limit=10`),
    enabled:  customerQuery.trim().length > 1,
  });

  const checkout = useMutation({
    mutationFn: (body) => apiPost('/api/transactions', body),
    onSuccess: (data) => {
      setReceipt(data);
      setCart([]); setQuery(''); setDiscount(0); setRedeemCredit(0); setRedeemPoints(0);
      setCashTendered(''); setErr(null);
      queryClient.invalidateQueries({ queryKey: ['sales-summary'] });
      queryClient.invalidateQueries({ queryKey: ['sales-daily-14'] });
      queryClient.invalidateQueries({ queryKey: ['cards'] });
    },
    onError: (e) => setErr(e.message),
  });

  const subtotal = useMemo(
    () => round2(cart.reduce((s, l) => s + l.unit_price * l.qty - (l.discount || 0), 0)),
    [cart]
  );
  const effectiveDiscount = Math.min(round2(Number(discount) || 0), subtotal);
  const taxable = round2(Math.max(0, subtotal - effectiveDiscount));
  const loyaltyDollars = redeemPoints > 0 ? round2(Math.min(redeemPoints * 0.05, taxable)) : 0;
  const tax = round2(Math.max(0, taxable - loyaltyDollars) * (Number(taxRate) || 0));
  let total = round2(taxable - loyaltyDollars + tax);
  const creditApplied = Math.min(round2(Number(redeemCredit) || 0), customer?.store_credit || 0, total);
  total = round2(total - creditApplied);
  const change = paymentMethod === 'cash' && cashTendered ? round2(Number(cashTendered) - total) : 0;

  const addCard = (card) => {
    setCart((c) => {
      const existing = c.find((l) => l.card_id === card.id);
      if (existing) {
        return c.map((l) => l.card_id === card.id ? { ...l, qty: l.qty + 1 } : l);
      }
      return [...c, { card_id: card.id, name: card.name, unit_price: Number(card.sell_price), qty: 1, max: card.quantity, discount: 0 }];
    });
    setQuery('');
  };

  const updateQty = (i, qty) => {
    setCart((c) => c.map((l, idx) => idx === i ? { ...l, qty: Math.max(1, Math.min(qty, l.max)) } : l));
  };
  const removeLine = (i) => setCart((c) => c.filter((_, idx) => idx !== i));

  const handleCheckout = () => {
    setErr(null);
    if (cart.length === 0) return setErr('Cart is empty');
    if (paymentMethod === 'cash' && Number(cashTendered) < total) return setErr('Cash tendered is less than total');
    if (paymentMethod === 'store_credit' && (!customer || customer.store_credit < total)) {
      return setErr('Customer does not have enough store credit');
    }
    checkout.mutate({
      customer_id: customer?.id,
      items: cart.map((l) => ({ card_id: l.card_id, qty: l.qty, discount: l.discount || 0 })),
      discount_amount: effectiveDiscount,
      tax_rate: Number(taxRate),
      payment_method: paymentMethod,
      payment_details: paymentMethod === 'cash' ? { cash_tendered: Number(cashTendered), change } : null,
      redeem_store_credit: creditApplied,
      redeem_loyalty: redeemPoints,
    });
  };

  // Reset receipt on next change
  useEffect(() => { if (cart.length === 0 && receipt) return; setReceipt(null); }, [cart]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        <div className="card-pad">
          <label className="label">Search inventory</label>
          <input
            className="input"
            placeholder="Type a card name or scan a barcode…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {query.trim().length > 1 && search.data?.data?.length > 0 && (
            <div className="border border-slate-200 rounded-lg mt-2 divide-y divide-slate-100 max-h-80 overflow-y-auto">
              {search.data.data.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  className="w-full flex items-center justify-between p-3 text-left hover:bg-slate-50"
                  onClick={() => addCard(c)}
                >
                  <div>
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-slate-500">{c.game} · {c.card_set} · {c.condition} · {c.quantity} in stock</div>
                  </div>
                  <div className="mono font-semibold">{fmtMoney(c.sell_price)}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 font-semibold">Cart ({cart.length})</div>
          {cart.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm">Add cards by searching above.</div>
          ) : (
            <table className="min-w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="table-th">Card</th>
                  <th className="table-th text-right">Qty</th>
                  <th className="table-th text-right">Price</th>
                  <th className="table-th text-right">Subtotal</th>
                  <th className="table-th" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cart.map((l, i) => (
                  <tr key={`${l.card_id}-${i}`}>
                    <td className="table-td font-medium">{l.name}</td>
                    <td className="table-td text-right">
                      <input
                        type="number" min="1" max={l.max}
                        className="input w-20 text-right"
                        value={l.qty}
                        onChange={(e) => updateQty(i, Number(e.target.value))}
                      />
                    </td>
                    <td className="table-td mono text-right">{fmtMoney(l.unit_price)}</td>
                    <td className="table-td mono text-right">{fmtMoney(l.unit_price * l.qty)}</td>
                    <td className="table-td text-right">
                      <button className="btn-ghost text-xs text-red-600" onClick={() => removeLine(i)}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {receipt && <ReceiptPanel receipt={receipt} onClose={() => setReceipt(null)} />}
      </div>

      <div className="space-y-4">
        <div className="card-pad">
          <label className="label">Customer (optional)</label>
          {customer ? (
            <div className="flex items-center justify-between bg-primary-50 rounded p-2">
              <div>
                <div className="font-medium">{customer.name}</div>
                <div className="text-xs text-slate-600">
                  Credit: {fmtMoney(customer.store_credit)} · Points: {customer.loyalty_points}
                </div>
              </div>
              <button className="btn-ghost text-xs" onClick={() => setCustomer(null)}>Clear</button>
            </div>
          ) : (
            <>
              <input
                className="input" placeholder="Search by name/email/phone…"
                value={customerQuery} onChange={(e) => setCustomerQuery(e.target.value)}
              />
              {customerQuery.length > 1 && customerSearch.data?.data?.length > 0 && (
                <div className="border border-slate-200 rounded mt-2 divide-y divide-slate-100">
                  {customerSearch.data.data.map((c) => (
                    <button
                      key={c.id} type="button"
                      className="w-full text-left p-2 text-sm hover:bg-slate-50"
                      onClick={() => { setCustomer(c); setCustomerQuery(''); }}
                    >
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-slate-500">{c.email || c.phone || '—'}</div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="card-pad space-y-3">
          <div className="flex justify-between text-sm"><span>Subtotal</span><span className="mono">{fmtMoney(subtotal)}</span></div>
          <div className="flex justify-between items-center text-sm">
            <span>Discount</span>
            <input
              className="input w-24 text-right mono" type="number" min="0" step="0.01"
              value={discount} onChange={(e) => setDiscount(e.target.value)}
            />
          </div>
          <div className="flex justify-between items-center text-sm">
            <span>Tax rate</span>
            <input
              className="input w-24 text-right mono" type="number" min="0" step="0.0025"
              value={taxRate} onChange={(e) => setTaxRate(e.target.value)}
            />
          </div>
          <div className="flex justify-between text-sm"><span>Tax</span><span className="mono">{fmtMoney(tax)}</span></div>
          {customer && (
            <>
              <div className="flex justify-between items-center text-sm">
                <span>Redeem points (5¢ each)</span>
                <input
                  className="input w-24 text-right mono" type="number" min="0" max={customer.loyalty_points}
                  value={redeemPoints} onChange={(e) => setRedeemPoints(Number(e.target.value))}
                />
              </div>
              <div className="flex justify-between items-center text-sm">
                <span>Apply store credit</span>
                <input
                  className="input w-24 text-right mono" type="number" min="0" step="0.01" max={customer.store_credit}
                  value={redeemCredit} onChange={(e) => setRedeemCredit(Number(e.target.value))}
                />
              </div>
            </>
          )}
          <div className="border-t pt-2 flex justify-between font-bold text-lg">
            <span>Total</span><span className="mono">{fmtMoney(total)}</span>
          </div>
        </div>

        <div className="card-pad space-y-2">
          <label className="label">Payment method</label>
          <select className="input" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
            {PAYMENT_METHODS.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
          </select>
          {paymentMethod === 'cash' && (
            <div>
              <label className="label">Cash tendered</label>
              <input
                className="input mono" type="number" min="0" step="0.01"
                value={cashTendered} onChange={(e) => setCashTendered(e.target.value)}
              />
              {cashTendered !== '' && (
                <div className="text-sm mt-1">
                  Change due: <span className="mono font-semibold">{fmtMoney(Math.max(0, change))}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {err && <div className="rounded border border-red-200 bg-red-50 text-red-700 text-sm p-3">{err}</div>}

        <button
          className="btn-primary w-full text-base py-3"
          disabled={cart.length === 0 || checkout.isPending}
          onClick={handleCheckout}
        >
          {checkout.isPending ? 'Processing…' : `Complete sale · ${fmtMoney(total)}`}
        </button>
      </div>
    </div>
  );
}

function ReceiptPanel({ receipt, onClose }) {
  return (
    <div className="card-pad bg-green-50 border-green-200">
      <div className="flex items-center justify-between mb-2">
        <div className="font-bold text-green-800">✓ Sale completed</div>
        <button className="btn-ghost text-xs" onClick={onClose}>Dismiss</button>
      </div>
      <div className="text-sm text-green-900 space-y-1">
        <div>Receipt ID: <code className="text-xs">{receipt.id}</code></div>
        <div>Total: <span className="mono font-semibold">{fmtMoney(receipt.total)}</span></div>
        <div>Payment: {receipt.payment_method}</div>
        <div>Loyalty points earned: {receipt.loyalty_points_earned}</div>
      </div>
      <div className="mt-3">
        <button onClick={() => window.print()} className="btn-secondary text-xs">🖨️ Print receipt</button>
      </div>
    </div>
  );
}
