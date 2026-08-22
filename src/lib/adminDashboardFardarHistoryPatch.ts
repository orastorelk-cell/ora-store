export const adminDashboardFardarHistoryPatch = () => ({
  name: 'ora-admin-fardar-history-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/components/admin/AdminDashboard.tsx')) return null;
    if (!code.includes('const [unifiedConfirmBatch, setUnifiedConfirmBatch]')) return null;

    let text = code;

    const stateMarker = "  // Branding changes stay as a draft until the admin explicitly saves them.\n";
    if (!text.includes('const [unifiedConfirmHistory, setUnifiedConfirmHistory]')) {
      if (!text.includes(stateMarker)) throw new Error('[O-RA Fardar history] state marker not found');
      const stateInsert = String.raw`  const [unifiedConfirmHistory, setUnifiedConfirmHistory] = useState<Array<{
    orderNumbers: string[];
    uploaded: number;
    failed: number;
    ignored: number;
    errors: string[];
    fileCount: number;
    at: string;
  }>>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('ora_unified_confirm_history_v1') || '[]');
      return Array.isArray(parsed) ? parsed.slice(0, 500) : [];
    } catch {
      return [];
    }
  });
  const [unifiedConfirmHistoryDate, setUnifiedConfirmHistoryDate] = useState('');
  const unifiedHistoryDateKey = (value?: string) => {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  };

`;
      text = text.replace(stateMarker, stateInsert + stateMarker);
    }

    const oldBatchSave = String.raw`    setUnifiedConfirmBatch({
      orderNumbers: Array.from(new Set(orderNumbers)),
      uploaded,
      failed,
      ignored,
      errors,
      fileCount: files.length,
      at: new Date().toISOString(),
    });`;
    if (text.includes(oldBatchSave)) {
      const newBatchSave = String.raw`    const unifiedBatchAt = new Date().toISOString();
    const nextUnifiedBatch = {
      orderNumbers: Array.from(new Set(orderNumbers)),
      uploaded,
      failed,
      ignored,
      errors,
      fileCount: files.length,
      at: unifiedBatchAt,
    };
    setUnifiedConfirmBatch(nextUnifiedBatch);
    setUnifiedConfirmHistory((prev) => {
      const next = [nextUnifiedBatch, ...prev].slice(0, 500);
      try { localStorage.setItem('ora_unified_confirm_history_v1', JSON.stringify(next)); } catch {}
      return next;
    });
    setUnifiedConfirmHistoryDate(unifiedHistoryDateKey(unifiedBatchAt));`;
      text = text.replace(oldBatchSave, newBatchSave);
    } else if (!text.includes('const nextUnifiedBatch = {')) {
      throw new Error('[O-RA Fardar history] unified upload save marker not found');
    }

    const countsMarker = "        const tkCount = batchOrders.filter(o => o.order_source === 'TikTok Ads').length;\n";
    if (!text.includes('const fardarHistoryDates =')) {
      if (!text.includes(countsMarker)) throw new Error('[O-RA Fardar history] confirm count marker not found');
      const historyDerived = String.raw`
        const fardarHistoryDates = Array.from(new Set(unifiedConfirmHistory.map(batch => unifiedHistoryDateKey(batch.at)).filter(Boolean))).sort().reverse();
        const selectedFardarHistoryDate = unifiedConfirmHistoryDate || fardarHistoryDates[0] || '';
        const selectedDateBatches = unifiedConfirmHistory
          .filter(batch => unifiedHistoryDateKey(batch.at) === selectedFardarHistoryDate)
          .sort((a,b) => new Date(b.at).getTime() - new Date(a.at).getTime());
        const selectedDateOrderNumbers = Array.from(new Set(selectedDateBatches.flatMap(batch => batch.orderNumbers)));
        const selectedDateOrders = orders.filter(order => selectedDateOrderNumbers.includes(order.order_number));
        const selectedDateReadyOrders = selectedDateOrders.filter(order =>
          order.call_center_status === 'Confirmed' &&
          order.stock_allocated &&
          Boolean(order.waybill_number) &&
          order.order_status !== 'Cancelled'
        );
`;
      text = text.replace(countsMarker, countsMarker + historyDerived);
    }

    if (!text.includes('Fardar CSV History')) {
      const endMarker = "            )}\n          </div>\n        );\n      })()}";
      if (!text.includes(endMarker)) throw new Error('[O-RA Fardar history] confirm section end marker not found');
      const historyPanel = String.raw`            )}

            <div className="rounded-3xl border border-violet-200 bg-white p-5 sm:p-6 shadow-sm space-y-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-wider text-violet-700">Fardar CSV History</p>
                  <h3 className="mt-1 text-base font-black text-gray-900">Download any previous Confirm upload again</h3>
                  <p className="mt-1 text-[11px] leading-5 text-gray-500">New uploads are added to history instead of replacing older batches. Choose a date, then download the whole date or one specific batch.</p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <label className="text-[10px] font-black uppercase tracking-wide text-gray-600">
                    Upload Date
                    <input
                      type="date"
                      value={selectedFardarHistoryDate}
                      onChange={e=>setUnifiedConfirmHistoryDate(e.target.value)}
                      className="mt-1 block rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs font-bold text-gray-800 outline-none focus:border-violet-400"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={selectedDateReadyOrders.length === 0}
                    onClick={()=>downloadFardarUploadCsv(selectedDateOrders)}
                    className="rounded-xl border border-violet-300 bg-violet-50 px-4 py-2.5 text-xs font-black text-violet-800 disabled:opacity-40"
                  ><Download className="mr-1 inline h-4 w-4"/> Download Date CSV ({selectedDateReadyOrders.length})</button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 text-[10px] font-black">
                <span className="rounded-lg bg-violet-100 px-2.5 py-1.5 text-violet-800">Saved Batches {unifiedConfirmHistory.length}</span>
                <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-slate-700">Selected Date {selectedFardarHistoryDate || '—'}</span>
                <span className="rounded-lg bg-emerald-100 px-2.5 py-1.5 text-emerald-800">Date Batches {selectedDateBatches.length}</span>
                <span className="rounded-lg bg-cyan-100 px-2.5 py-1.5 text-cyan-800">Waybill Ready {selectedDateReadyOrders.length}</span>
              </div>

              {selectedDateBatches.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-5 text-center text-xs font-bold text-gray-500">No Confirm / Cancel upload history for this date.</div>
              ) : (
                <div className="space-y-2">
                  {selectedDateBatches.map((historyBatch, index) => {
                    const historyBatchOrders = orders.filter(order => historyBatch.orderNumbers.includes(order.order_number));
                    const historyBatchReady = historyBatchOrders.filter(order =>
                      order.call_center_status === 'Confirmed' &&
                      order.stock_allocated &&
                      Boolean(order.waybill_number) &&
                      order.order_status !== 'Cancelled'
                    );
                    return (
                      <div key={historyBatch.at + '-' + index} className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-xs font-black text-gray-900">{new Date(historyBatch.at).toLocaleTimeString()} • {historyBatch.fileCount} file(s)</p>
                          <p className="mt-1 text-[10px] text-gray-500">Processed {historyBatch.uploaded} • Orders {historyBatch.orderNumbers.length} • Not Found {historyBatch.failed} • Ignored {historyBatch.ignored}</p>
                        </div>
                        <button
                          type="button"
                          disabled={historyBatchReady.length === 0}
                          onClick={()=>downloadFardarUploadCsv(historyBatchOrders)}
                          className="rounded-xl border border-violet-300 bg-white px-3 py-2 text-[11px] font-black text-violet-800 disabled:opacity-40"
                        ><Download className="mr-1 inline h-3.5 w-3.5"/> Fardar CSV ({historyBatchReady.length})</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })()}`;
      text = text.replace(endMarker, historyPanel);
    }

    return text === code ? null : { code: text, map: null };
  },
});
