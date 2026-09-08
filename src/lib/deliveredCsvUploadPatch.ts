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
