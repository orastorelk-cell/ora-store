import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import { adminDashboardUnifiedUploadPatch } from './src/lib/adminDashboardUnifiedUploadPatch';
import { confirmUploadPackingBatchPatch } from './src/lib/confirmUploadPackingBatchPatch';
import { packingDownloadUxPatch } from './src/lib/packingDownloadUxPatch';
import { pdfPerformancePatch } from './src/lib/pdfPerformancePatch';
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
import { qtyOfferMergedDisplayPatch } from './src/lib/qtyOfferMergedDisplayPatch';
import { customerCartWordingPatch } from './src/lib/customerCartWordingPatch';
import { welcomeSplashAppPatch } from './src/lib/welcomeSplashAppPatch';
import { maintenanceBilingualNoticePatch } from './src/lib/maintenanceBilingualNoticePatch';
import { deliveryCityAcceptancePatch } from './src/lib/deliveryCityAcceptancePatch';
import { waybillDuplicateSafetyPatch } from './src/lib/waybillDuplicateSafetyPatch';
import { waybillExistingGarbageCleanupPatch } from './src/lib/waybillExistingGarbageCleanupPatch';
import { leadItemCodeBlankDefaultPatch } from './src/lib/leadItemCodeBlankDefaultPatch';

export default defineConfig(() => {
  return {
    plugins: [leadItemCodeBlankDefaultPatch(), waybillExistingGarbageCleanupPatch(), waybillDuplicateSafetyPatch(), deliveryCityAcceptancePatch(), maintenanceBilingualNoticePatch(), mainCategoryHierarchyPatch(), roundSpecialOfferPatch(), specialOfferPercentageRulePatch(), specialOfferAdminPreviewPatch(), specialOfferLivePreviewDecimalPatch(), roundSpecialOfferPercentBadgePatch(), productCardOfferLayoutPatch(), qtyOfferMergedDisplayPatch(), welcomeSplashAppPatch(), customerCartWordingPatch(), adminDashboardStoragePatch(), adminDashboardUnifiedUploadPatch(), confirmUploadPackingBatchPatch(), packingDownloadUxPatch(), pdfPerformancePatch(), adminDashboardFardarHistoryPatch(), adminDashboardFardarHistoryDurablePatch(), adminDashboardVisibleTemplatePatch(), adminDashboardLeadPreviewPatch(), adminDashboardLeadServerPreviewPatch(), adminDashboardProductAutoPopularPatch(), react(), tailwindcss()],
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
