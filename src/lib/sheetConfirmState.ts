export const SHEET_CONFIRM_CONTROL_KEY = 'sheet-confirm-control-v1';
export const SHEET_CONFIRM_API = '/api/google-sheets/confirm';
export const sheetConfirmInProgress = (rows:readonly any[],owner?:string) => {
  const control=rows.find(row=>row.key===SHEET_CONFIRM_CONTROL_KEY)?.payload;
  return !!control?.invoice_hold && control.active_id!==owner;
};
export const sheetConfirmPhaseLabel = (phase:string) => ({
  reading:'Reading Google Sheet',saving:'Saving all Confirm / Cancel decisions',verifying:'Checking the latest Sheet changes',
  packing:'Creating one invoice batch',colouring:'Updating Sheet colours',complete:'Finished',blocked:'Sheet changes need attention',
  sheet_update_failed:'Invoices ready · Sheet update needs retry',
} as Record<string,string>)[phase] || 'Continuing saved work';
