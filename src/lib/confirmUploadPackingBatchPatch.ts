// Packing batch behavior is intentionally driven by the existing AUTO INVOICE QUEUE
// in StoreContext.tsx.
//
// Important business rule:
// - Confirming/uploading an order does NOT reserve its future PDF/packing batch.
// - If an order is Waiting for Stock, it stays outside every invoice batch.
// - When stock later becomes available (and the existing waybill is still valid),
//   the AUTO INVOICE QUEUE creates a fresh PACK-AUTO-* batch at that readiness time.
// - Waybill assignment/number is not changed by this patch.
//
// This plugin remains registered only so older deployments that imported it do not
// need a vite.config migration. It deliberately performs no source transforms.
export const confirmUploadPackingBatchPatch = () => ({
  name: 'ora-confirm-upload-packing-batch-patch',
  enforce: 'pre' as const,
  transform() {
    return null;
  },
});
