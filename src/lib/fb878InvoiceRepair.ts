// PDF-only invoice-source guard for the user-confirmed FB-000878 correction.
// The original order, COD amount, invoice lock and inventory are never rewritten.
export const FB878_ORDER = 'FB-000878';
export const FB878_CSV_TOTAL = 1250;

const readAmount = (value: unknown): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  const text = String(value ?? '').trim().replace(/^(?:LKR|Rs\.?|රු\.?)[\s.]*/i, '').replace(/,/g,'');
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return NaN;
  return Number(text);
};

export const confirmedFB878CsvTotal = (
  orderNumber: unknown,
  snapshot: {final_total?:unknown;items?:unknown}|null|undefined
): 1250 => {
  if (String(orderNumber ?? '').trim().toUpperCase() !== FB878_ORDER)
    throw new Error('This correction is authorized for FB-000878 only.');
  if (!snapshot || !Array.isArray(snapshot.items) || !snapshot.items.length)
    throw new Error('FB-000878: confirmed CSV item lines are missing. Upload the original Confirm CSV.');
  const amount = readAmount(snapshot.final_total);
  if (amount !== FB878_CSV_TOTAL)
    throw new Error('FB-000878: the confirmed CSV Final Total must be Rs. 1,250. Current source does not match; upload the correct Confirm CSV.');
  return FB878_CSV_TOTAL;
};
