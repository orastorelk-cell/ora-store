export const GOOGLE_APPS_SCRIPT_CATALOG_OFFER_COLUMNS = String.raw`// ============================================================
// O-RA STORE - PRODUCT CATALOG OFFER DISPLAY COLUMNS
// Append-only: existing PRODUCT CATALOG columns keep their exact positions.
// Selling Price stays the real working price used by item/variant change logic.
// Crossed Price + Offer % are display/reference values only.
// ============================================================
ORA_VERSION = 'O-RA Store Google Sheets Clean V1 + Catalog Offer Columns';

if (ORA_CATALOG_HEADERS.indexOf('Crossed Price (Rs)') < 0) ORA_CATALOG_HEADERS.push('Crossed Price (Rs)');
if (ORA_CATALOG_HEADERS.indexOf('Offer %') < 0) ORA_CATALOG_HEADERS.push('Offer %');

var oraCatalogRowsOfferColumnsBase_ = oraCatalogRows_;
oraCatalogRows_ = function(products) {
  var rows = oraCatalogRowsOfferColumnsBase_(products);
  var rowIndex = 0;
  products = Array.isArray(products) ? products : [];

  function appendOfferMeta_(target) {
    if (rowIndex >= rows.length) return;
    target = target || {};
    var crossed = oraRound_(target.sheet_crossed_price || 0);
    var percent = Number(target.sheet_offer_percent || 0);
    rows[rowIndex].push(crossed > 0 ? crossed : '');
    rows[rowIndex].push(isFinite(percent) && percent > 0 ? Math.round(percent * 10) / 10 : '');
    rowIndex++;
  }

  for (var i = 0; i < products.length; i++) {
    var p = products[i] || {};
    var variants = Array.isArray(p.variants) && p.variants.length ? p.variants : null;
    if (variants) {
      for (var v = 0; v < variants.length; v++) appendOfferMeta_(variants[v]);
    } else {
      appendOfferMeta_(p);
    }
  }

  // Defensive padding: never let an unexpected row mismatch break catalog sync.
  while (rowIndex < rows.length) appendOfferMeta_({});
  return rows;
};
`;
