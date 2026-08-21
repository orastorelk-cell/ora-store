import { Order, StoreSettings } from '../types';
import {
  buildExactInvoiceSvg as buildExactInvoiceSvgBase,
  svgToBrowserPngBytes,
} from './exactInvoiceTemplateBase';

export { svgToBrowserPngBytes };

const escInvoiceDistrict = (v: unknown) => String(v ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// Keep the approved Invoice V6 template untouched. Add only the requested
// District line in the unused customer-details space directly below City.
export function buildExactInvoiceSvg(
  order: Order,
  settings: StoreSettings,
  sample = false,
  pageItems?: Order['items'],
  pageIndex = 0,
  totalPages = 1,
) {
  const svg = buildExactInvoiceSvgBase(order, settings, sample, pageItems, pageIndex, totalPages);
  const district = String((order as any)?.district || '').trim();
  if (!district) return svg;

  const marker = '<!-- Waybill: no redundant courier name -->';
  if (!svg.includes(marker)) return svg;

  const districtLine = [
    '<text class="t label" x="650" y="350">District</text>',
    '<text class="t label" x="760" y="350">-</text>',
    `<text class="t value" x="790" y="350">${escInvoiceDistrict(district)}</text>`,
  ].join('');

  return svg.replace(marker, `${districtLine}\n\n${marker}`);
}
