import type { Order, StoreSettings } from '../types';
import { correctedFB878PrintOrder, resolveFB878InvoiceSnapshot } from './fb878InvoiceA4';

export type PackingInvoiceRecovery = {
  printable: Order[];
  held: Array<{order_number:string;reason:string}>;
  repaired: string[];
};

/**
 * Fix only the known historical FB-000878 snapshot mismatch in the COPY used
 * to print a whole batch. Everything else is preserved exactly. The authoritative
 * Confirm snapshot/Sheet or uploaded Confirm CSV must prove the Rs.1250 amount
 * and the full item/delivery breakdown before that invoice is included.
 *
 * Importantly, an unverified FB-000878 must not prevent the OTHER safe invoices
 * in this batch from downloading. Only printed IDs may be marked Downloaded.
 */
export const preparePackingInvoicesForPrint = async (
  batch:readonly Order[],settings:StoreSettings,confirmCsv?:string,
):Promise<PackingInvoiceRecovery> => {
  const printable:Order[]=[],held:PackingInvoiceRecovery['held']=[],repaired:string[]=[];
  for(const order of batch){
    if(String(order.order_number||'').trim().toUpperCase()!=='FB-000878'){
      printable.push(order);
      continue;
    }
    try {
      const snapshot=await resolveFB878InvoiceSnapshot(order,settings,confirmCsv);
      printable.push(correctedFB878PrintOrder(order,snapshot));
      repaired.push('FB-000878');
    }catch(error:any){
      held.push({order_number:'FB-000878',reason:String(error?.message||'Confirm CSV or saved invoice snapshot is needed')});
    }
  }
  return {printable,held,repaired};
};

export const pendingPackingInvoiceMessage = (result:PackingInvoiceRecovery):string=>
  result.held.map(({order_number,reason})=>order_number+' was NOT included or marked Downloaded: '+reason).join('\n');
