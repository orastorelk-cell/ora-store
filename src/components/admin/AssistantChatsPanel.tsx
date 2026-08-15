import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, CheckCircle2, Clock3, MessageCircle, RefreshCcw, Search, Send, UserRound, XCircle } from 'lucide-react';

type AssistantChatMessage = {
  id: string;
  role: 'customer' | 'assistant' | 'agent' | string;
  text: string;
  at?: string;
  agent_name?: string;
  context_only?: boolean;
};

type AssistantChat = {
  id: string;
  session_id: string;
  language: 'en' | 'si' | 'ta';
  status: 'Needs Agent' | 'Replied' | 'Resolved';
  order_number?: string | null;
  messages: AssistantChatMessage[];
  created_at: string;
  updated_at: string;
  last_replied_by?: string;
};

const staffRequest = async (url: string, init: RequestInit = {}) => {
  const token = localStorage.getItem('ora_staff_session_token') || '';
  const headers = new Headers(init.headers || {});
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(url, { ...init, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status})`);
  return data;
};

const languageLabel = (lang: string) => lang === 'si' ? 'සිංහල' : lang === 'ta' ? 'தமிழ்' : 'English';
const statusClass = (status: string) => status === 'Needs Agent'
  ? 'border-amber-400/40 bg-amber-400/10 text-amber-300'
  : status === 'Resolved'
    ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
    : 'border-sky-400/40 bg-sky-400/10 text-sky-300';

export const AssistantChatsPanel: React.FC = () => {
  const [chats, setChats] = useState<AssistantChat[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'active' | 'needs' | 'resolved' | 'all'>('active');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const previousNeedsRef = useRef<number | null>(null);

  const loadChats = async (notify = false) => {
    try {
      const data = await staffRequest('/api/admin/assistant-chats');
      const rows: AssistantChat[] = Array.isArray(data?.chats) ? data.chats : [];
      const needs = rows.filter((c) => c.status === 'Needs Agent').length;
      if (notify && previousNeedsRef.current !== null && needs > previousNeedsRef.current && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('O-RA Assistant — Agent Reply Needed', { body: `${needs} customer chat${needs === 1 ? '' : 's'} waiting for an agent reply.` });
      }
      previousNeedsRef.current = needs;
      setChats(rows);
      setSelectedId((current) => current && rows.some((r) => r.id === current) ? current : rows.find((r) => r.status === 'Needs Agent')?.id || rows[0]?.id || '');
    } catch (e) {
      console.warn('Assistant chat refresh failed:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadChats(false);
    const timer = window.setInterval(() => void loadChats(true), 25000);
    return () => window.clearInterval(timer);
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return chats.filter((chat) => {
      if (filter === 'active' && chat.status === 'Resolved') return false;
      if (filter === 'needs' && chat.status !== 'Needs Agent') return false;
      if (filter === 'resolved' && chat.status !== 'Resolved') return false;
      if (!q) return true;
      const text = (chat.messages || []).map((m) => m.text).join(' ').toLowerCase();
      return [chat.id, chat.order_number || '', text].some((value) => String(value).toLowerCase().includes(q));
    });
  }, [chats, query, filter]);

  const selected = chats.find((c) => c.id === selectedId) || null;
  const needsCount = chats.filter((c) => c.status === 'Needs Agent').length;

  const sendReply = async () => {
    if (!selected || !reply.trim() || busy) return;
    setBusy(true);
    try {
      await staffRequest(`/api/admin/assistant-chats/${selected.id}/reply`, { method: 'POST', body: JSON.stringify({ message: reply.trim() }) });
      setReply('');
      await loadChats(false);
    } catch (e: any) {
      alert(e?.message || 'Reply failed.');
    } finally { setBusy(false); }
  };

  const setStatus = async (status: 'Needs Agent' | 'Replied' | 'Resolved') => {
    if (!selected || busy) return;
    setBusy(true);
    try {
      await staffRequest(`/api/admin/assistant-chats/${selected.id}`, { method:'PATCH', body:JSON.stringify({ status }) });
      await loadChats(false);
    } catch (e:any) { alert(e?.message || 'Status update failed.'); }
    finally { setBusy(false); }
  };

  const enableNotifications = async () => {
    if (!('Notification' in window)) return alert('Browser notifications are not supported on this device.');
    const permission = await Notification.requestPermission();
    alert(permission === 'granted' ? 'Assistant chat alerts enabled.' : 'Notification permission was not enabled.');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-white"><MessageCircle className="h-5 w-5 text-orange-400" /><h2 className="font-black">Assistant Chats</h2></div>
          <p className="mt-1 text-[11px] text-neutral-400">AI-handled questions stay private to the customer. Only chats that need a human agent appear here.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-center"><div className="text-[9px] font-black uppercase text-amber-300">Needs Agent</div><div className="text-xl font-black text-white">{needsCount}</div></div>
          <button type="button" onClick={enableNotifications} className="inline-flex items-center gap-1.5 rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-[10px] font-black text-white"><Bell className="h-4 w-4" />Enable Alerts</button>
          <button type="button" onClick={() => void loadChats(false)} className="rounded-xl border border-neutral-700 bg-neutral-950 p-2 text-neutral-300"><RefreshCcw className="h-4 w-4" /></button>
        </div>
      </div>

      <div className="grid min-h-[620px] gap-4 lg:grid-cols-[330px_minmax(0,1fr)]">
        <div className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900">
          <div className="space-y-2 border-b border-neutral-800 p-3">
            <label className="flex items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2"><Search className="h-4 w-4 text-neutral-500" /><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Chat ID, Order ID, message..." className="w-full bg-transparent text-xs text-white outline-none" /></label>
            <select value={filter} onChange={(e)=>setFilter(e.target.value as any)} className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs font-bold text-white outline-none"><option value="active">Open Chats</option><option value="needs">Needs Agent</option><option value="resolved">Resolved</option><option value="all">All</option></select>
          </div>
          <div className="max-h-[540px] overflow-y-auto p-2">
            {loading ? <div className="p-6 text-center text-xs text-neutral-500">Loading chats...</div> : visible.length === 0 ? <div className="p-6 text-center text-xs text-neutral-500">No chats in this view.</div> : visible.map((chat) => {
              const last = [...(chat.messages || [])].reverse().find((m)=>!m.context_only);
              return <button key={chat.id} type="button" onClick={()=>setSelectedId(chat.id)} className={`mb-2 w-full rounded-xl border p-3 text-left ${selectedId === chat.id ? 'border-orange-500/50 bg-orange-500/10' : 'border-neutral-800 bg-neutral-950 hover:border-neutral-700'}`}>
                <div className="flex items-start justify-between gap-2"><div><div className="font-mono text-xs font-black text-white">{chat.id}</div><div className="mt-0.5 text-[10px] text-neutral-500">{chat.order_number || 'General support'} • {languageLabel(chat.language)}</div></div><span className={`rounded-full border px-2 py-1 text-[9px] font-black ${statusClass(chat.status)}`}>{chat.status}</span></div>
                <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-neutral-300">{last?.text || 'No message'}</p>
                <p className="mt-2 text-[9px] text-neutral-600">{new Date(chat.updated_at).toLocaleString()}</p>
              </button>;
            })}
          </div>
        </div>

        <div className="flex min-h-[620px] flex-col overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900">
          {!selected ? <div className="flex flex-1 items-center justify-center text-xs text-neutral-500">Select a customer chat.</div> : <>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-800 p-4"><div><div className="flex items-center gap-2"><UserRound className="h-4 w-4 text-orange-400" /><span className="font-mono text-sm font-black text-white">{selected.id}</span><span className={`rounded-full border px-2 py-1 text-[9px] font-black ${statusClass(selected.status)}`}>{selected.status}</span></div><p className="mt-1 text-[10px] text-neutral-500">{selected.order_number ? `Order ${selected.order_number} • ` : ''}{languageLabel(selected.language)} • Updated {new Date(selected.updated_at).toLocaleString()}</p></div><div className="flex gap-2">{selected.status !== 'Resolved' ? <button type="button" onClick={()=>void setStatus('Resolved')} className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[10px] font-black text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" />Resolve</button> : <button type="button" onClick={()=>void setStatus('Needs Agent')} className="inline-flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[10px] font-black text-amber-300"><Clock3 className="h-3.5 w-3.5" />Reopen</button>}</div></div>
            <div className="flex-1 space-y-3 overflow-y-auto bg-neutral-950/60 p-4">{(selected.messages || []).filter((m)=>!m.context_only).map((m)=><div key={m.id} className={`flex ${m.role === 'customer' ? 'justify-start' : 'justify-end'}`}><div className={`max-w-[82%] rounded-2xl px-3 py-2 text-xs leading-5 ${m.role === 'customer' ? 'border border-neutral-800 bg-neutral-900 text-neutral-200' : 'bg-orange-500 font-semibold text-neutral-950'}`}><div className="whitespace-pre-wrap">{m.text}</div><div className={`mt-1 text-[9px] ${m.role === 'customer' ? 'text-neutral-600' : 'text-neutral-800/70'}`}>{m.role === 'agent' ? (m.agent_name || 'Agent') : 'Customer'} • {m.at ? new Date(m.at).toLocaleString() : ''}</div></div></div>)}</div>
            <div className="border-t border-neutral-800 bg-neutral-900 p-3"><div className="flex items-end gap-2"><textarea value={reply} onChange={(e)=>setReply(e.target.value)} rows={2} placeholder="Reply to customer..." className="flex-1 resize-none rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-white outline-none focus:border-orange-500" /><button type="button" disabled={busy || !reply.trim() || selected.status === 'Resolved'} onClick={()=>void sendReply()} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-orange-500 px-4 text-xs font-black text-neutral-950 disabled:opacity-40"><Send className="h-4 w-4" />Reply</button></div><p className="mt-2 text-[9px] text-neutral-500">The reply appears inside the same O-RA Assistant chat. No WhatsApp is required for normal support.</p></div>
          </>}
        </div>
      </div>
    </div>
  );
};
