import { returnContainersFromRows } from './returnSheets';

export const RETURN_SCAN_PREFIX = 'return-scan-v1:';
export const RETURN_SCAN_TIME_ZONE = 'Asia/Colombo';
export type ReturnScan = {
  id: string; waybill: string; scanned_at: string; scanned_by: string;
  sheet_id?: string; order_number?: string; sequence?: number;
};

const scanDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: RETURN_SCAN_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});
export const returnScanDate = (at: string) => {
  const parts = scanDay.formatToParts(new Date(at));
  return ['year','month','day'].map(type => parts.find(part => part.type === type)!.value).join('-');
};
export const compareReturnScans = (a: ReturnScan,b: ReturnScan) => Date.parse(b.scanned_at) - Date.parse(a.scanned_at)
  || (b.sequence || 0) - (a.sequence || 0) || b.id.localeCompare(a.id);

// Earlier parcels already have a first-scan timestamp. Read it in place so
// deployment needs no backfill or rewrite of receipts being checked by staff.
export const returnScanHistory = (rows: readonly any[]): ReturnScan[] => {
  const parcels = returnContainersFromRows(rows).flatMap(sheet => sheet.parcels.map(parcel => ({ sheet,parcel })));
  const owners = new Map(parcels.map(value => [value.parcel.waybill,value]));
  const scans = new Map<string,ReturnScan>(), recorded = new Set<string>();
  for (const row of rows) {
    if (!String(row.key).startsWith(RETURN_SCAN_PREFIX)) continue;
    const event = row.payload;
    if (!event?.waybill || !Number.isFinite(Date.parse(event.scanned_at))) continue;
    const owner = owners.get(event.waybill);
    const id = String(row.key).slice(RETURN_SCAN_PREFIX.length);
    scans.set(id,{ id,waybill: event.waybill,scanned_at: event.scanned_at,scanned_by: String(event.scanned_by || ''),sequence: Number(event.sequence) || 0,
      sheet_id: owner?.sheet.id || undefined,order_number: owner?.parcel.order_number });
    recorded.add(event.waybill + '|' + event.scanned_at);
  }
  for (const {sheet,parcel} of parcels) {
    if (!parcel.scanned_at || !Number.isFinite(Date.parse(parcel.scanned_at)) || recorded.has(parcel.waybill + '|' + parcel.scanned_at)) continue;
    const id = 'legacy:' + parcel.waybill;
    scans.set(id,{ id,waybill: parcel.waybill,scanned_at: parcel.scanned_at,scanned_by: parcel.scanned_by || '',
      sheet_id: sheet.id || undefined,order_number: parcel.order_number });
  }
  return [...scans.values()].sort(compareReturnScans);
};
