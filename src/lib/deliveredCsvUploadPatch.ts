export const deliveredCsvUploadPatch = () => ({
  name: 'ora-delivered-csv-upload-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    let text = code;

    if (id.endsWith('/src/types.ts')) {
      if (!text.includes("| 'delivered_csv_upload'")) {
        text = text.replace("  | 'dispatch'\n", "  | 'dispatch'\n  | 'delivered_csv_upload'\n");
      }
      return text === code ? null : { code: text, map: null };
    }

    if (id.endsWith('/src/context/StoreContext.tsx')) {
      if (!text.includes("'dispatch','delivered_csv_upload','cod_payments'")) {
        text = text.replace(
          "'delivery','dispatch','cod_payments'",
          "'delivery','dispatch','delivered_csv_upload','cod_payments'"
        );
      }
      return text === code ? null : { code: text, map: null };
    }

    if (!id.endsWith('/src/components/admin/AdminDashboard.tsx')) return null;

    // WAYBILL POOL SOURCE OF TRUTH
    // The browser-local pool status can become stale after real orders are updated
    // from another workflow/browser. Rebuild the dashboard figures from the union of:
    //   1) waybills actually attached to system orders, and
    //   2) pool records already marked Assigned/Used.
    // This keeps TOTAL / ASSIGNED / AVAILABLE mathematically consistent and prevents
    // the dashboard from showing a lower assigned count than the real order data.
    if (!text.includes('const waybillPoolStats = useMemo(() => {')) {
      const statsMarker = "  const [returnMessage, setReturnMessage] = useState('');";
      if (text.includes(statsMarker)) {
        const statsBlock = String.raw`

  const waybillPoolStats = useMemo(() => {
    const normalizeWaybill = (value: unknown) => String(value || '').trim().toLowerCase();
    const uniquePool = new Map<string, any>();
    waybillRecords.forEach((record) => {
      const key = normalizeWaybill(record.waybill_number);
      if (key && !uniquePool.has(key)) uniquePool.set(key, record);
    });

    const consumed = new Set<string>();

    // Real order assignments are authoritative, even if the local pool row is stale.
    orders.forEach((order) => {
      const key = normalizeWaybill(order.waybill_number);
      if (key && uniquePool.has(key)) consumed.add(key);
    });

    // Keep already handed-over / explicitly assigned pool rows protected as well.
    waybillRecords.forEach((record) => {
      if (record.status !== 'Assigned' && record.status !== 'Used') return;
      const key = normalizeWaybill(record.waybill_number);
      if (key && uniquePool.has(key)) consumed.add(key);
    });

    const totalImported = uniquePool.size;
    const assigned = consumed.size;
    const available = Math.max(0, totalImported - assigned);
    const preferredCourier = settings.courier_provider || 'Fardar';

    const records = Array.from(uniquePool.entries());
    const preferredNext = records.find(([, record]) => record.courier_name === preferredCourier && !consumed.has(normalizeWaybill(record.waybill_number)));
    const fallbackNext = records.find(([, record]) => !consumed.has(normalizeWaybill(record.waybill_number)));
    const nextWaybill = (preferredNext?.[1] || fallbackNext?.[1])?.waybill_number || '';

    return { totalImported, assigned, available, nextWaybill };
  }, [waybillRecords, orders, settings.courier_provider]);`;
        text = text.replace(statsMarker, statsMarker + statsBlock);
      }
    }

    const oldNextWaybill = "{waybillRecords.find((w) => w.status === 'Available' && w.courier_name === (settings.courier_provider || 'Fardar'))?.waybill_number || waybillRecords.find((w) => w.status === 'Available')?.waybill_number || 'NO AVAILABLE WAYBILL'}";
    if (text.includes(oldNextWaybill)) {
      text = text.split(oldNextWaybill).join("{waybillPoolStats.nextWaybill || 'NO AVAILABLE WAYBILL'}");
    }

    const oldAvailableCount = "{waybillRecords.filter((w) => w.status === 'Available').length}";
    if (text.includes(oldAvailableCount)) {
      text = text.split(oldAvailableCount).join('{waybillPoolStats.available}');
    }

    const oldTotalImported = '{waybillRecords.length}';
    if (text.includes(oldTotalImported)) {
      text = text.split(oldTotalImported).join('{waybillPoolStats.totalImported}');
    }

    const oldAssignedCount = "{waybillRecords.filter((w) => w.status === 'Assigned').length}";
    const oldAssignedAndUsedCount = "{waybillRecords.filter((w) => w.status === 'Assigned' || w.status === 'Used').length}";
    if (text.includes(oldAssignedCount)) {
      text = text.split(oldAssignedCount).join('{waybillPoolStats.assigned}');
    }
    if (text.includes(oldAssignedAndUsedCount)) {
      text = text.split(oldAssignedAndUsedCount).join('{waybillPoolStats.assigned}');
    }

    // Keep this feature isolated from the large AdminDashboard runtime.
    // The actual CSV parser/updater lives in public/delivered-upload.html.
    // This avoids any page crash from an injected click-handler function.
    if (!text.includes("| 'dispatch' | 'delivered_csv_upload' | 'cod_payments'")) {
      text = text.replace(
        "| 'delivery' | 'dispatch' | 'cod_payments'",
        "| 'delivery' | 'dispatch' | 'delivered_csv_upload' | 'cod_payments'"
      );
    }

    if (!text.includes("'dispatch','delivered_csv_upload','returns'")) {
      text = text.replace(
        "'packing','delivery','dispatch','returns'",
        "'packing','delivery','dispatch','delivered_csv_upload','returns'"
      );
    }

    if (!text.includes("delivered_csv_upload: 'Delivered CSV Upload'")) {
      text = text.replace(
        "dispatch: 'Dispatch Scan', cod_payments:",
        "dispatch: 'Dispatch Scan', delivered_csv_upload: 'Delivered CSV Upload', cod_payments:"
      );
    }

    if (!text.includes("{ id:'delivered_csv_upload', label:'Delivered CSV Upload'")) {
      const sidebarMarker = "      { id:'dispatch', label:`Dispatch Scan (${orders.filter((o)=>o.dispatch_status==='Handed Over').length})`, icon:ScanLine },";
      if (text.includes(sidebarMarker)) {
        text = text.replace(
          sidebarMarker,
          sidebarMarker + "\n      { id:'delivered_csv_upload', label:'Delivered CSV Upload', icon:CheckCircle2 },"
        );
      }
    }

    if (!text.includes("activeTab === 'delivered_csv_upload'")) {
      const panelMarker = "      {activeTab === 'invoices' && (";
      if (text.includes(panelMarker)) {
        const panel = [
          "      {activeTab === 'delivered_csv_upload' && canAccessTab('delivered_csv_upload') && (",
          '        <div className="space-y-3">',
          '          <div className="rounded-2xl border border-emerald-500/25 bg-neutral-900 p-4">',
          '            <div className="flex items-start gap-3">',
          '              <div className="rounded-xl bg-emerald-500/10 p-2.5"><CheckCircle2 className="h-5 w-5 text-emerald-300"/></div>',
          '              <div className="min-w-0">',
          '                <h2 className="text-lg font-black text-white">Delivered CSV Upload</h2>',
          '                <p className="mt-1 text-xs leading-5 text-neutral-400">Fardar Delivered status sync runs in an isolated page so it cannot break the rest of the Admin System.</p>',
          '              </div>',
          '            </div>',
          '          </div>',
          '          <iframe',
          '            title="Delivered CSV Upload"',
          '            src="/delivered-upload.html"',
          '            className="h-[760px] w-full rounded-2xl border border-neutral-800 bg-neutral-950"',
          '          />',
          '        </div>',
          '      )}',
          '',
          panelMarker,
        ].join('\n');
        text = text.replace(panelMarker, panel);
      }
    }

    return text === code ? null : { code: text, map: null };
  },
});
