export const GOOGLE_APPS_SCRIPT_CATALOG_IMAGE = String.raw`// ============================================================
// O-RA STORE - PRODUCT CATALOG IMAGE DISPLAY PATCH
// Only changes how PRODUCT CATALOG -> Item Image is written.
// All catalog values / order tabs / pricing / stock logic remain unchanged.
// ============================================================

function oraCatalogPublicImageUrl_(value) {
  var imageUrl = oraStr_(value).trim();
  if (!imageUrl) return '';
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  return 'https://ora-store.orastore-lk.workers.dev/' + imageUrl.replace(/^\/+/, '');
}

function oraSyncCatalog_(body) {
  var ss = oraTarget_(), sh = oraEnsureCatalog_(ss), rows = oraCatalogRows_(body.products || []);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, ORA_CATALOG_HEADERS.length).clearContent();
  if (rows.length) {
    sh.getRange(2, 1, rows.length, ORA_CATALOG_HEADERS.length).setValues(rows);

    // Put a real in-cell image in Item Image automatically. Image URL stays untouched
    // because existing catalog / item-change logic may still use that column.
    var hm = oraHeaderMap_(sh);
    var imageCol = hm['Item Image'] || 1;
    var urlCol = hm['Image URL'] || 10;
    for (var i = 0; i < rows.length; i++) {
      var rawImageUrl = oraStr_(rows[i][urlCol - 1]).trim();
      var imageUrl = oraCatalogPublicImageUrl_(rawImageUrl);
      var cell = sh.getRange(i + 2, imageCol);
      if (!imageUrl) {
        cell.clearContent();
        continue;
      }
      try {
        var cellImage = SpreadsheetApp.newCellImage()
          .setSourceUrl(imageUrl)
          .setAltTextTitle('Product Image')
          .build();
        cell.setValue(cellImage);
      } catch (imageError) {
        // Compatibility fallback. Same result as the old manual
        // =IMAGE("https://.../"&J2,4,150,150) formula, but automatic.
        cell.setFormula('=IFERROR(IMAGE("' + imageUrl.replace(/"/g, '""') + '",4,150,150),"")');
      }
    }
    sh.setColumnWidth(imageCol, 160);
    sh.setRowHeights(2, rows.length, 155);
  }
  SpreadsheetApp.flush();
  return { ok: true, status: 'catalog_synced', rows: rows.length, version: ORA_VERSION };
}
`;
