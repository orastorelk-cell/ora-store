export const fardarParcelTypeOnePatch = () => ({
  name: 'ora-fardar-parcel-type-one-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/components/admin/AdminDashboard.tsx')) return null;

    const from = "        settings.fardar_parcel_type || '',";
    const to = "        1,";

    if (code.includes(to) && !code.includes(from)) return null;
    if (!code.includes(from)) throw new Error('[O-RA Fardar parcel type] export row marker not found');

    return { code: code.replace(from, to), map: null };
  },
});
