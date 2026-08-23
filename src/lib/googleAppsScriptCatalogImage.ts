export const GOOGLE_APPS_SCRIPT_CATALOG_IMAGE = String.raw`// ============================================================
// O-RA STORE - PRODUCT CATALOG IMAGE DISPLAY PATCH
// Only changes how PRODUCT CATALOG -> Item Image is written.
// All catalog values / order tabs / pricing / stock logic remain unchanged.
// ============================================================

function oraSyncCatalog_(body) {
  var ss = oraTarget_(), sh = oraEnsureCatalog_(ss), rows = oraCatalogRows_(body.products || []);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, ORA_CATALOG_HEADERS.length).clearContent();
  if (rows.length) {
    sh.getRange(2, 1, rows.length, ORA_CATALOG_HEADERS.length).setValues(rows);

    // Put a real in-cell image in Item Image instead of leaving only a URL/formula text.
    // Image URL stays untouched because existing catalog logic may still use that column.
    var hm = oraHeaderMap_(sh);
    var imageCol = hm['Item Image'] || 1;
    var urlCol = hm['Image URL'] || 10;
    for (var i = 0; i < rows.length; i++) {
      var imageUrl = oraStr_(rows[i][urlCol - 1]).trim();
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
        // Compatibility fallback for older Apps Script runtimes.
        cell.setFormula('=IFERROR(IMAGE("' + imageUrl.replace(/"/g, '""') + '",4,60,60),"")');
      }
    }
    sh.setRowHeights(2, rows.length, 65);
  }
  SpreadsheetApp.flush();
  return { ok: true, status: 'catalog_synced', rows: rows.length, version: ORA_VERSION };
}
`;
