// Load the generated Apps Script/editor code only when a Sheet action is used.
// Preserve the existing functions, arguments and network behavior.
export const syncOrderToGoogleSheets: typeof import('./googleSheets').syncOrderToGoogleSheets = async (...args) => (await import('./googleSheets')).syncOrderToGoogleSheets(...args);
export const syncOrdersBatchToGoogleSheets: typeof import('./googleSheets').syncOrdersBatchToGoogleSheets = async (...args) => (await import('./googleSheets')).syncOrdersBatchToGoogleSheets(...args);
export const syncProductCatalogToGoogleSheets: typeof import('./googleSheets').syncProductCatalogToGoogleSheets = async (...args) => (await import('./googleSheets')).syncProductCatalogToGoogleSheets(...args);
export const clearGoogleSheetTestData: typeof import('./googleSheets').clearGoogleSheetTestData = async (...args) => (await import('./googleSheets')).clearGoogleSheetTestData(...args);
export const clearGoogleSheetLiveStartData: typeof import('./googleSheets').clearGoogleSheetLiveStartData = async (...args) => (await import('./googleSheets')).clearGoogleSheetLiveStartData(...args);
export const deleteOrderFromGoogleSheets: typeof import('./googleSheets').deleteOrderFromGoogleSheets = async (...args) => (await import('./googleSheets')).deleteOrderFromGoogleSheets(...args);
