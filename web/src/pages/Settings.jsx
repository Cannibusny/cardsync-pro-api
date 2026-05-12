import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiPost } from '../api';
import { useAuth, hasRole } from '../auth.jsx';

export default function SettingsPage() {
  const { user } = useAuth();
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  if (!hasRole(user, 'manager')) {
    return <div className="text-slate-500">You don't have access to this page.</div>;
  }

  const refresh = useMutation({
    mutationFn: () => apiPost('/api/prices/refresh', {}),
    onSuccess: (d) => { setErr(null); setMsg(`Refresh started for categories [${(d.categories || []).join(', ')}]. Check server logs for completion.`); },
    onError:   (e) => { setMsg(null); setErr(e.message); },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Settings</h1>

      <div className="card-pad">
        <div className="font-semibold mb-1">TCGCSV pricing refresh</div>
        <p className="text-sm text-slate-500">
          Refreshes the price cache from <a className="text-primary-600 underline" href="https://tcgcsv.com" target="_blank" rel="noreferrer">tcgcsv.com</a> for the configured categories (default: Pokemon, Magic, Yu-Gi-Oh, One Piece).
          Runs nightly automatically; trigger now to refresh on demand.
        </p>
        <button
          className="btn-primary mt-3"
          disabled={refresh.isPending}
          onClick={() => refresh.mutate()}
        >
          {refresh.isPending ? 'Starting…' : 'Refresh now'}
        </button>
        {msg && <div className="mt-3 text-sm text-green-700">{msg}</div>}
        {err && <div className="mt-3 text-sm text-red-700">{err}</div>}
      </div>

      <div className="card-pad">
        <div className="font-semibold mb-1">About</div>
        <div className="text-sm text-slate-600 space-y-1">
          <div>CardSync Pro — Electronic Valet</div>
          <div>Phase 1 (inventory · POS · CRM · reporting · multi-user)</div>
        </div>
      </div>
    </div>
  );
}
