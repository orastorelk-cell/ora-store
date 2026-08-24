import React, { useEffect, useMemo, useState } from 'react';
import { Bell, BellRing, X } from 'lucide-react';

interface CustomerNotificationRow {
  id: string;
  title: string;
  body: string;
  url?: string;
  created_at: string;
}

const LAST_SEEN_KEY = 'ora_customer_notification_last_seen_at';
const ENABLED_KEY = 'ora_customer_notifications_enabled';

export const CustomerNotifications: React.FC = () => {
  const [rows, setRows] = useState<CustomerNotificationRow[]>([]);
  const [open, setOpen] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() => 'Notification' in window ? Notification.permission : 'unsupported');
  const [enabled, setEnabled] = useState(() => localStorage.getItem(ENABLED_KEY) === '1');

  const fetchRows = async (notify = false) => {
    try {
      const response = await fetch('/api/customer-notifications');
      if (!response.ok) return;
      const data = await response.json();
      const next: CustomerNotificationRow[] = Array.isArray(data?.notifications) ? data.notifications : [];
      setRows(next);
      if (!notify || !enabled || permission !== 'granted' || !next.length) return;
      const lastSeen = Number(localStorage.getItem(LAST_SEEN_KEY) || 0);
      const fresh = next.filter((row) => new Date(row.created_at).getTime() > lastSeen).sort((a,b)=>new Date(a.created_at).getTime()-new Date(b.created_at).getTime());
      for (const row of fresh.slice(-3)) {
        try {
          if ('serviceWorker' in navigator) {
            const registration = await navigator.serviceWorker.ready;
            await registration.showNotification(row.title, { body: row.body, icon: '/icons/ora-192.png', badge: '/icons/ora-192.png', data: { url: row.url || '/' }, tag: row.id });
          } else {
            const n = new Notification(row.title, { body: row.body, icon: '/icons/ora-192.png', tag: row.id });
            n.onclick = () => { window.focus(); window.location.href = row.url || '/'; };
          }
        } catch {}
      }
      if (fresh.length) localStorage.setItem(LAST_SEEN_KEY, String(Math.max(...fresh.map((row)=>new Date(row.created_at).getTime()))));
    } catch {}
  };

  useEffect(() => {
    void fetchRows(false);
    const timer = window.setInterval(() => void fetchRows(true), 45000);
    const onFocus = () => void fetchRows(true);
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [permission, enabled]);

  const enable = async () => {
    if (!('Notification' in window)) return setPermission('unsupported');
    const next = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    setPermission(next);
    if (next === 'granted') {
      localStorage.setItem(ENABLED_KEY, '1');
      setEnabled(true);
      localStorage.setItem(LAST_SEEN_KEY, String(Date.now()));
      try {
        if ('serviceWorker' in navigator) {
          const registration = await navigator.serviceWorker.ready;
          await registration.showNotification('O-RA Notifications Enabled', { body: 'You can now receive O-RA store updates while the website/PWA is active.', icon:'/icons/ora-192.png', data:{url:'/'} });
        }
      } catch {}
    }
  };

  const disable = () => {
    localStorage.setItem(ENABLED_KEY, '0');
    setEnabled(false);
  };

  const unread = useMemo(() => {
    const lastSeen = Number(localStorage.getItem(LAST_SEEN_KEY) || 0);
    return rows.filter((row)=>new Date(row.created_at).getTime()>lastSeen).length;
  }, [rows, open]);

  const openPanel = () => {
    setOpen(true);
    if (rows.length) localStorage.setItem(LAST_SEEN_KEY, String(Math.max(...rows.map((row)=>new Date(row.created_at).getTime()))));
  };

  return <>
    <button type="button" onClick={openPanel} className="relative rounded-full border border-gray-200 bg-white p-1.5 sm:p-2 text-gray-700 shadow-sm hover:border-orange-300 hover:text-orange-600" title="O-RA Notifications">
      {permission === 'granted' ? <BellRing className="h-4 w-4"/> : <Bell className="h-4 w-4"/>}
      {unread > 0 && <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-orange-600 px-1 text-center text-[9px] font-black leading-4 text-white">{Math.min(99, unread)}</span>}
    </button>
    {open && <div className="fixed inset-0 z-[90] bg-black/35 p-4 backdrop-blur-[2px]" onClick={()=>setOpen(false)}>
      <div className="ml-auto mt-16 w-full max-w-sm overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-2xl" onClick={(e)=>e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 p-4"><div><p className="text-sm font-black text-gray-900">O-RA Notifications</p><p className="text-[10px] text-gray-500">Store updates and offers</p></div><button onClick={()=>setOpen(false)} className="rounded-full bg-gray-100 p-2 text-gray-500"><X className="h-4 w-4"/></button></div>
        <div className="border-b border-gray-100 p-3">
          {permission === 'unsupported' ? <div className="rounded-xl bg-gray-50 px-3 py-2 text-[10px] text-gray-600">Notifications are not supported in this browser.</div> : permission === 'granted' && enabled ? <div className="flex items-center justify-between gap-3 rounded-xl bg-emerald-50 px-3 py-2"><span className="text-[10px] font-bold text-emerald-700">O-RA notifications are ON.</span><button type="button" onClick={disable} className="rounded-lg bg-white px-2 py-1 text-[9px] font-black text-gray-700 shadow-sm">Turn Off</button></div> : <button type="button" onClick={()=>void enable()} className="w-full rounded-xl bg-black px-3 py-2.5 text-xs font-black text-white">Turn On Notifications</button>}
        </div>
        <div className="max-h-[420px] overflow-y-auto divide-y divide-gray-100">
          {rows.length === 0 ? <div className="p-8 text-center text-xs text-gray-400">No notifications yet.</div> : rows.map((row)=><button key={row.id} type="button" onClick={()=>{setOpen(false); window.location.href=row.url||'/';}} className="block w-full p-4 text-left hover:bg-gray-50"><p className="text-xs font-black text-gray-900">{row.title}</p><p className="mt-1 text-[11px] leading-5 text-gray-600">{row.body}</p><p className="mt-2 text-[9px] text-gray-400">{new Date(row.created_at).toLocaleString()}</p></button>)}
        </div>
      </div>
    </div>}
  </>;
};
