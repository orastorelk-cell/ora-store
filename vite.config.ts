import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import { adminDashboardUnifiedUploadPatch } from './src/lib/adminDashboardUnifiedUploadPatch';
import { confirmUploadPackingBatchPatch } from './src/lib/confirmUploadPackingBatchPatch';
import { confirmUploadCrossPriceSnapshotPatch } from './src/lib/confirmUploadCrossPriceSnapshotPatch';
import { confirmUploadCustomerNamePatch } from './src/lib/confirmUploadCustomerNamePatch';
import { packingDownloadUxPatch } from './src/lib/packingDownloadUxPatch';
import { pdfPerformancePatch } from './src/lib/pdfPerformancePatch';
import { invoiceRepairMoneyParsingPatch } from './src/lib/invoiceRepairMoneyParsingPatch';
import { invoiceCrossedPriceMathPatch } from './src/lib/invoiceCrossedPriceMathPatch';
import { invoiceCombinedDiscountPatch } from './src/lib/invoiceCombinedDiscountPatch';
import { invoiceSnapshotConsistencyPatch } from './src/lib/invoiceSnapshotConsistencyPatch';
import { repairA4FourUpCsvPatch } from './src/lib/repairA4FourUpCsvPatch';
import { googleAppsScriptCurrencyParsePatch } from './src/lib/googleAppsScriptCurrencyParsePatch';
import { googleAppsScriptOrderCrossPricePatch } from './src/lib/googleAppsScriptOrderCrossPricePatch';
import { orderCrossPriceActualSourcePatch } from './src/lib/orderCrossPriceActualSourcePatch';
import { adminDashboardFardarHistoryPatch } from './src/lib/adminDashboardFardarHistoryPatch';
import { adminDashboardFardarHistoryDurablePatch } from './src/lib/adminDashboardFardarHistoryDurablePatch';
import { adminDashboardVisibleTemplatePatch } from './src/lib/adminDashboardVisibleTemplatePatch';
import { adminDashboardLeadPreviewPatch } from './src/lib/adminDashboardLeadPreviewPatch';
import { adminDashboardLeadServerPreviewPatch } from './src/lib/adminDashboardLeadServerPreviewPatch';
import { adminDashboardProductAutoPopularPatch } from './src/lib/adminDashboardProductAutoPopularPatch';
import { adminDashboardStoragePatch } from './src/lib/adminDashboardStoragePatch';
import { mainCategoryHierarchyPatch } from './src/lib/mainCategoryHierarchyPatch';
import { roundSpecialOfferPatch } from './src/lib/roundSpecialOfferPatch';
import { specialOfferPercentageRulePatch } from './src/lib/specialOfferPercentageRulePatch';
import { specialOfferAdminPreviewPatch } from './src/lib/specialOfferAdminPreviewPatch';
import { specialOfferLivePreviewDecimalPatch } from './src/lib/specialOfferLivePreviewDecimalPatch';
import { roundSpecialOfferPercentBadgePatch } from './src/lib/roundSpecialOfferPercentBadgePatch';
import { productCardOfferLayoutPatch } from './src/lib/productCardOfferLayoutPatch';
import { bundleComponentOfferDisplayPatch } from './src/lib/bundleComponentOfferDisplayPatch';
import { qtyOfferMergedDisplayPatch } from './src/lib/qtyOfferMergedDisplayPatch';
import { checkoutCombinedOfferPatch } from './src/lib/checkoutCombinedOfferPatch';
import { bundleCheckoutOfferPatch } from './src/lib/bundleCheckoutOfferPatch';
import { productCatalogOfferColumnsPatch } from './src/lib/productCatalogOfferColumnsPatch';
import { productBackupDryRunPatch } from './src/lib/productBackupDryRunPatch';
import { customerCartWordingPatch } from './src/lib/customerCartWordingPatch';
import { welcomeSplashAppPatch } from './src/lib/welcomeSplashAppPatch';
import { maintenanceBilingualNoticePatch } from './src/lib/maintenanceBilingualNoticePatch';
import { deliveryCityAcceptancePatch } from './src/lib/deliveryCityAcceptancePatch';
import { waybillDuplicateSafetyPatch } from './src/lib/waybillDuplicateSafetyPatch';
import { waybillExistingGarbageCleanupPatch } from './src/lib/waybillExistingGarbageCleanupPatch';
import { leadItemCodeBlankDefaultPatch } from './src/lib/leadItemCodeBlankDefaultPatch';

export default defineConfig(() => {
  return {
    plugins: [leadItemCodeBlankDefaultPatch(), waybillExistingGarbageCleanupPatch(), waybillDuplicateSafetyPatch(), deliveryCityAcceptancePatch(), maintenanceBilingualNoticePatch(), mainCategoryHierarchyPatch(), roundSpecialOfferPatch(), specialOfferPercentageRulePatch(), specialOfferAdminPreviewPatch(), specialOfferLivePreviewDecimalPatch(), roundSpecialOfferPercentBadgePatch(), productCardOfferLayoutPatch(), bundleComponentOfferDisplayPatch(), qtyOfferMergedDisplayPatch(), checkoutCombinedOfferPatch(), bundleCheckoutOfferPatch(), productCatalogOfferColumnsPatch(), googleAppsScriptCurrencyParsePatch(), googleAppsScriptOrderCrossPricePatch(), orderCrossPriceActualSourcePatch(), productBackupDryRunPatch(), welcomeSplashAppPatch(), customerCartWordingPatch(), adminDashboardStoragePatch(), adminDashboardUnifiedUploadPatch(), confirmUploadPackingBatchPatch(), confirmUploadCrossPriceSnapshotPatch(), confirmUploadCustomerNamePatch(), packingDownloadUxPatch(), pdfPerformancePatch(), invoiceRepairMoneyParsingPatch(), invoiceCrossedPriceMathPatch(), invoiceCombinedDiscountPatch(), invoiceSnapshotConsistencyPatch(), repairA4FourUpCsvPatch(), adminDashboardFardarHistoryPatch(), adminDashboardFardarHistoryDurablePatch(), adminDashboardVisibleTemplatePatch(), adminDashboardLeadPreviewPatch(), adminDashboardLeadServerPreviewPatch(), adminDashboardProductAutoPopularPatch(), react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
