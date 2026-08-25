const replaceRequired = (text: string, from: string, to: string, label: string) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[O-RA invoice repair money] ${label} marker not found`);
  return text.replace(from, to);
};

/**
 * Fixes currency parsing for Confirm/Cancel CSV values such as "Rs. 1,590".
 * The previous generic character-stripper preserved the period in "Rs." and
 * accidentally converted "Rs. 1,590" into .1590. This patch extracts the first
 * actual numeric token after removing thousands separators.
 */
export const invoiceRepairMoneyParsingPatch = () => ({
  name: 'ora-invoice-repair-money-parsing-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    let text = code;

    if (id.endsWith('/src/lib/pdfGenerator.ts')) {
      const oldMoney = `const repairMoney = (value:unknown) => {\n  const n=Number(String(value ?? '').replace(/[^0-9.-]/g,''));\n  return Number.isFinite(n)?Math.max(0,n):0;\n};`;
      const newMoney = `const repairMoney = (value:unknown) => {\n  if(typeof value==='number') return Number.isFinite(value)?Math.max(0,value):0;\n  const raw=String(value ?? '').trim().replace(/,/g,'');\n  const match=raw.match(/-?(?:\\d+(?:\\.\\d+)?|\\.\\d+)/);\n  const n=match?Number(match[0]):0;\n  return Number.isFinite(n)?Math.max(0,n):0;\n};`;
      text = replaceRequired(text, oldMoney, newMoney, 'PDF repairMoney');

      const unitMarker = `    const unit=repairMoney(row.unit_price);\n    const line=repairMoney(row.line_total) || Math.round(unit*qty*100)/100;`;
      const unitReplacement = `    const unit=repairMoney(row.unit_price);\n    const priorUnit=repairMoney(prior?.unit_price);\n    if(unit<=0 && priorUnit>0) throw new Error('Repair price is invalid for '+(code || String(index+1))+'. Use the original Confirm CSV and try again.');\n    const line=repairMoney(row.line_total) || Math.round(unit*qty*100)/100;`;
      text = replaceRequired(text, unitMarker, unitReplacement, 'repair item price guard');

      const finalMarker = `  const finalTotal=repairMoney(snapshot.final_total) || computed;`;
      const finalReplacement = `  const parsedFinal=repairMoney(snapshot.final_total);\n  if(parsedFinal<=0 && repairMoney(order.total_amount)>0) throw new Error('Repair Final Total is invalid. Use the original Confirm CSV and try again.');\n  const finalTotal=parsedFinal || computed;`;
      text = replaceRequired(text, finalMarker, finalReplacement, 'repair final-total guard');

      return { code: text, map: null };
    }

    if (id.endsWith('/src/context/StoreContext.tsx')) {
      const oldCsvMoney = `      const csvMoney=(col:number)=>col>=0?Number(String(rows.map(c=>c[col]).find(v=>String(v||'').trim())||0).replace(/[^0-9.-]/g,'')):0;`;
      const newCsvMoney = `      const parseConfirmedMoney=(value:any)=>{\n        if(typeof value==='number') return Number.isFinite(value)?value:0;\n        const raw=String(value ?? '').trim().replace(/,/g,'');\n        const match=raw.match(/-?(?:\\d+(?:\\.\\d+)?|\\.\\d+)/);\n        const n=match?Number(match[0]):0;\n        return Number.isFinite(n)?n:0;\n      };\n      const csvMoney=(col:number)=>col>=0?parseConfirmedMoney(rows.map(c=>c[col]).find(v=>String(v||'').trim())):0;`;
      text = replaceRequired(text, oldCsvMoney, newCsvMoney, 'Confirm snapshot money helper');

      text = replaceRequired(
        text,
        `          unit_price:unitPriceI>=0?Number(String(c[unitPriceI]||0).replace(/[^0-9.-]/g,'')):0,`,
        `          unit_price:unitPriceI>=0?parseConfirmedMoney(c[unitPriceI]):0,`,
        'Confirm snapshot unit price',
      );
      text = replaceRequired(
        text,
        `          line_total:lineTotalI>=0?Number(String(c[lineTotalI]||0).replace(/[^0-9.-]/g,'')):0,`,
        `          line_total:lineTotalI>=0?parseConfirmedMoney(c[lineTotalI]):0,`,
        'Confirm snapshot line total',
      );

      return { code: text, map: null };
    }

    return null;
  },
});
