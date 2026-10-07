// Runs after the existing allocator rewrites so their exact markers stay intact.
export const returnWorkflowPatch = () => ({
  name: 'ora-return-workflow-patch',enforce: 'pre' as const,
  transform(code: string,rawId: string) {
    if (!rawId.split('?')[0].replace(/\\/g,'/').endsWith('/src/context/StoreContext.tsx')) return null;
    let text = code;
    const marker = '    const allocatorSignature=JSON.stringify({';
    if (!text.includes(marker)) throw new Error('[O-RA returns] allocator marker missing');
    text = text.replace(marker,'    if(returnPackingPending)return;\n' + marker);
    const deps = 'waybillPoolRetry]);';
    if (!text.includes(deps)) throw new Error('[O-RA returns] allocator dependencies missing');
    text = text.replace(deps,'waybillPoolRetry,returnPackingPending]);');
    return { code: text,map: null };
  },
});
