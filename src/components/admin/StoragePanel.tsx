import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Database, HardDrive, RefreshCw, ShieldCheck } from 'lucide-react';

type StorageRow = {
  id: string;
  name: string;
  provider: string;
  bucket?: string;
  used_bytes: number;
  object_count: number;
  free_limit_bytes: number;
  remaining_free_bytes: number;
  status?: string;
};

type StoragePayload = {
  ok: boolean;
  updated_at?: string;
  storages?: StorageRow[];
  error?: string;
};

const formatBytes = (bytes: number) => {
  const value = Math.max(0, Number(bytes || 0));
  if (value < 1024) return `${value.toFixed(0)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let amount = value / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && amount >= 1024; i += 1) {
    amount /= 1024;
    unit = units[i];
  }
  const digits = amount >= 100 ? 0 : amount >= 10 ? 1 : 2;
  return `${amount.toFixed(digits)} ${unit}`;
};

export const StoragePanel: React.FC = () => {
  const [data, setData] = useState<StoragePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadStorage = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const token = localStorage.getItem('ora_staff_session_token') || '';
    try {
      const response = await fetch('/api/admin/storage-usage', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: 'no-store',
      });
      const payload: StoragePayload = await response.json().catch(() => ({ ok: false, error: 'Invalid server response.' }));
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Storage usage is unavailable.');
      setData(payload);
      setError('');
    } catch (err: any) {
      setError(String(err?.message || 'Storage usage is unavailable.'));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStorage(false);
    const timer = window.setInterval(() => void loadStorage(true), 60_000);
    return () => window.clearInterval(timer);
  }, [loadStorage]);

  const rows = useMemo(() => Array.isArray(data?.storages) ? data!.storages! : [], [data]);

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-xl border border-orange-500/20 bg-orange-500/10 p-2.5">
              <HardDrive className="h-5 w-5 text-orange-400" />
            </div>
            <div>
              <h2 className="text-lg font-black text-white">Storage</h2>
              <p className="mt-1 text-xs leading-5 text-neutral-400">Live read-only usage monitor for the storage services connected to O-RA Store.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void loadStorage(false)}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-neutral-700 bg-neutral-950 px-3.5 py-2 text-xs font-black text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh Now
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[10px] text-neutral-500">
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-1 font-bold text-emerald-300"><ShieldCheck className="h-3.5 w-3.5" />Read only</span>
          <span>Auto refresh: every 60 seconds</span>
          {data?.updated_at && <span>• Last updated: {new Date(data.updated_at).toLocaleString()}</span>}
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-xs font-bold text-red-300">{error}</div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {rows.map((row) => {
          const limit = Math.max(1, Number(row.free_limit_bytes || 0));
          const used = Math.max(0, Number(row.used_bytes || 0));
          const remaining = Math.max(0, Number(row.remaining_free_bytes ?? (limit - used)));
          const percent = Math.min(100, Math.max(0, (used / limit) * 100));
          return (
            <div key={row.id} className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="rounded-xl bg-neutral-950 p-2.5"><Database className="h-5 w-5 text-orange-400" /></div>
                  <div>
                    <p className="text-sm font-black text-white">{row.name}</p>
                    <p className="mt-0.5 text-[10px] text-neutral-500">{row.provider}{row.bucket ? ` • ${row.bucket}` : ''}</p>
                  </div>
                </div>
                <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-black text-emerald-300">LIVE</span>
              </div>

              <div className="mt-5 flex items-end justify-between gap-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Used</p>
                  <p className="mt-1 text-2xl font-black text-white">{formatBytes(used)}</p>
                </div>
                <p className="text-right text-xs font-black text-neutral-300">{percent < 0.01 && used > 0 ? '<0.01' : percent.toFixed(percent >= 10 ? 1 : 2)}%</p>
              </div>

              <div className="mt-3 h-3 overflow-hidden rounded-full bg-neutral-950 ring-1 ring-neutral-800">
                <div className="h-full rounded-full bg-orange-500 transition-[width] duration-500" style={{ width: `${Math.max(used > 0 ? 0.35 : 0, percent)}%` }} />
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3">
                  <p className="text-[9px] font-bold text-neutral-500">FREE LIMIT</p>
                  <p className="mt-1 text-xs font-black text-white">{formatBytes(limit)}</p>
                </div>
                <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3">
                  <p className="text-[9px] font-bold text-neutral-500">FREE LEFT</p>
                  <p className="mt-1 text-xs font-black text-emerald-300">{formatBytes(remaining)}</p>
                </div>
                <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3">
                  <p className="text-[9px] font-bold text-neutral-500">FILES</p>
                  <p className="mt-1 text-xs font-black text-white">{Number(row.object_count || 0).toLocaleString()}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {!loading && !error && rows.length === 0 && (
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5 text-xs text-neutral-400">No storage services were returned by the server.</div>
      )}

      <p className="px-1 text-[10px] leading-4 text-neutral-500">The limits shown are the configured free-tier storage references. This page only reads usage; it cannot upload, delete, move or edit files.</p>
    </div>
  );
};
