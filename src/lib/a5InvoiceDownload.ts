import type { Order, StoreSettings } from '../types';

// The A5 print exports are supplied by a5InvoiceDownloadPatch at build time.
// Keep the untransformed TypeScript caller typed at that module boundary.
export const downloadA5Invoices = async (orders: Order[], settings: StoreSettings, fileName?: string) => {
  const module = await import('./pdfGenerator') as typeof import('./pdfGenerator') & {
    generateA5SingleInvoicesPDF: (orders: Order[], settings: StoreSettings, fileName?: string) => Promise<void>;
  };
  return module.generateA5SingleInvoicesPDF(orders, settings, fileName);
};

/** Download an existing whole packing batch as 2 A5 invoices per A4 page. */
export const downloadA4TwoUpA5Invoices = async (orders:Order[],settings:StoreSettings,fileName?:string):Promise<void> => {
  const module=await import('./pdfGenerator') as typeof import('./pdfGenerator') & {
    generateA4TwoUpA5InvoicesPDF: (orders:Order[],settings:StoreSettings,fileName?:string)=>Promise<void>;
  };
  return module.generateA4TwoUpA5InvoicesPDF(orders,settings,fileName);
};
