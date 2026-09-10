import type { Plugin } from 'vite';

/** Keep the last unified Confirm/Cancel upload result across logout/login/refresh in the same browser. */
export const confirmUploadResultPersistencePatch = (): Plugin => ({
  name: 'ora-confirm-upload-result-persistence-patch',
  enforce: 'pre',
  transform(code, rawId) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/components/admin/AdminDashboard.tsx')) return null;
    if (code.includes('CONFIRM UPLOAD RESULT PERSISTENCE')) return null;

    const marker = "  // Branding changes stay as a draft until the admin explicitly saves them.\n";
    if (!code.includes(marker)) {
      throw new Error('[O-RA confirm upload persistence] state insertion marker not found');
    }

    const insert = String.raw`  // CONFIRM UPLOAD RESULT PERSISTENCE
  // The upload result used to live only in React state, so logout/login or refresh
  // erased the visible Ignored/Processed details. Restore and persist the latest result
  // in this browser so staff can inspect it after logging back in.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('ora_last_unified_confirm_upload_result') || 'null');
      if (saved && typeof saved === 'object' && saved.at) {
        setUnifiedConfirmBatch((current) => current.at ? current : {
          orderNumbers: Array.isArray(saved.orderNumbers) ? saved.orderNumbers.map(String) : [],
          uploaded: Number(saved.uploaded || 0),
          failed: Number(saved.failed || 0),
          ignored: Number(saved.ignored || 0),
          errors: Array.isArray(saved.errors) ? saved.errors.map(String) : [],
          fileCount: Number(saved.fileCount || 0),
          at: String(saved.at),
        });
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!unifiedConfirmBatch.at) return;
    try {
      localStorage.setItem('ora_last_unified_confirm_upload_result', JSON.stringify(unifiedConfirmBatch));
    } catch {}
  }, [unifiedConfirmBatch]);

`;

    return { code: code.replace(marker, insert + marker), map: null };
  },
});
