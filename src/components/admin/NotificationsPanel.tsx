import React, { useEffect, useMemo, useState } from 'react';
import { Bell, RefreshCw, Send, Trash2 } from 'lucide-react';

interface CustomerNotificationRow {
  id: string;
  title: string;
  body: string;
  url?: string;
  created_at: string;
  created_by?: string;
}

const staffRequest = async (url: string, init: RequestInit = {}) => {
  const token = localStorage.getItem('ora_staff_session_token') || '';
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || 'Request failed.');
  return data;
};

export const NotificationsPanel: React.FC = () => {
  const [rows, setRows] = useState<CustomerNotificationRow[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('/');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = async () => {
    try {
      const data = await staffRequest('/api/admin/customer-notifications');
      setRows(Array.isArray(data?.notifications) ? data.notifications : []);
    } catch (error: any) {
      setMessage(error?.message || 'Notifications could not be loaded.');
    }
  };

  useEffect(() => { void load(); }, []);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setBusy(true);
    setMessage('');
    try {
      const data = await staffRequest('/api/admin/customer-notifications', {
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), body: body.trim(), url: url.trim() || '/' }),
      });
      setRows((previous) => [data.notification, ...previous].filter(Boolean));
      setTitle(''); setBody(''); setUrl('/');
      setMessage('Notification published. Customers who enabled website notifications will receive it while the O-RA site/PWA is active.');
    } catch (error: any) {
      setMessage(error?.message || 'Notification publish failed.');
    } finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this notification from customer notification history?')) return;
    try {
      await staffRequest(`/api/admin/customer-notifications/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setRows((previous) => previous.filter((row) => row.id !== id));
    } catch (error: any) { alert(error?.message || 'Delete failed.'); }
  };

  const recentCount = useMemo(() => rows.filter((row) => Date.now() - new Date(row.created_at).getTime() < 24 * 60 * 60 * 1000).length, [rows]);

  return <div className="space-y-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex items-center gap-2 text-white"><Bell className="h-5 w-5 text-orange-400"/><h2 className="text-lg font-black">Customer Notifications</h2></div>
        <p className="mt-1 text-xs text-neutral-400">Publish store updates. Customers choose whether browser notifications are allowed.</p>
      </div>
      <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs font-black text-neutral-300"><RefreshCw className="h-4 w-4"/>Refresh</button>
    </div>

    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,520px)_1fr]">
      <form onSubmit={send} className="space-y-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
        <div className="flex items-center justify-between"><h3 className="text-sm font-black text-white">New Notification</h3><span className="rounded-full bg-orange-500/10 px-2 py-1 text-[9px] font-black text-orange-300">{recentCount} sent in 24h</span></div>
        <label className="block text-[10px] font-bold text-neutral-400">Title<input maxLength={90} value={title} onChange={(e)=>setTitle(e.target.value)} placeholder="New Combo Pack Available" className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-white"/></label>
        <label className="block text-[10px] font-bold text-neutral-400">Message<textarea maxLength={240} rows={4} value={body} onChange={(e)=>setBody(e.target.value)} placeholder="Check the latest O-RA offer." className="mt-1 w-full resize-y rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-white"/></label>
        <label className="block text-[10px] font-bold text-neutral-400">Open Link<input value={url} onChange={(e)=>setUrl(e.target.value)} placeholder="/" className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-white"/><span className="mt-1 block text-[9px] font-normal text-neutral-600">Use / for home, or a safe store path.</span></label>
        <button disabled={busy || !title.trim() || !body.trim()} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-xs font-black text-black disabled:opacity-50"><Send className="h-4 w-4"/>{busy ? 'Publishing...' : 'Publish Notification'}</button>
        {message && <p className="rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-[10px] leading-5 text-neutral-300">{message}</p>}
      </form>

      <div className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900">
        <div className="border-b border-neutral-800 px-4 py-3"><h3 className="text-sm font-black text-white">Notification History ({rows.length})</h3></div>
        <div className="max-h-[560px] overflow-y-auto divide-y divide-neutral-800">
          {rows.length === 0 ? <div className="p-8 text-center text-xs text-neutral-500">No customer notifications yet.</div> : rows.map((row) => <div key={row.id} className="flex items-start gap-3 p-4">
            <div className="mt-0.5 rounded-xl bg-orange-500/10 p-2 text-orange-300"><Bell className="h-4 w-4"/></div>
            <div className="min-w-0 flex-1"><p className="text-xs font-black text-white">{row.title}</p><p className="mt-1 text-[11px] leading-5 text-neutral-300">{row.body}</p><p className="mt-1 text-[9px] text-neutral-600">{new Date(row.created_at).toLocaleString()} • {row.url || '/'}</p></div>
            <button type="button" onClick={()=>void remove(row.id)} className="rounded-lg bg-red-950 p-2 text-red-300"><Trash2 className="h-3.5 w-3.5"/></button>
          </div>)}
        </div>
      </div>
    </div>
  </div>;
};
