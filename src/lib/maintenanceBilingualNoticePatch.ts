export const maintenanceBilingualNoticePatch = () => ({
  name: 'ora-maintenance-bilingual-notice-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/App.tsx')) return null;

    const oldBlock = `          <h1 className="text-2xl font-black">O-RA Store</h1>\n          <p className="mt-3 text-sm leading-6 text-gray-600">\n            {settings.maintenance_message || 'Website is currently under maintenance. Please check back soon.'}\n          </p>\n          <p className="mt-5 text-xs text-gray-400">We will be back shortly.</p>`;

    const newBlock = `          <h1 className="text-2xl font-black">O-RA Store</h1>\n          <p className="mt-2 text-xs font-black uppercase tracking-[0.16em] text-orange-600">Website Maintenance</p>\n          <p className="mt-4 text-sm font-semibold leading-6 text-gray-700">\n            {settings.maintenance_message || 'Website is currently under maintenance. Please check back soon.'}\n          </p>\n          <div lang="si" className="mt-4 rounded-2xl border border-orange-100 bg-orange-50 px-4 py-3 text-sm font-semibold leading-7 text-gray-800">\n            වෙබ් අඩවිය දැනට නඩත්තු කිරීමක් සහ යාවත්කාලීන කිරීමක් සිදු කරමින් පවතී. කරුණාකර මඳ වේලාවකින් නැවත පිවිසෙන්න.\n          </div>\n          <p className="mt-5 text-xs leading-5 text-gray-400">\n            We will be back shortly. <span className="mx-1">•</span> <span lang="si">අපි ඉක්මනින් නැවත පැමිණෙන්නෙමු.</span>\n          </p>`;

    if (!code.includes(oldBlock)) {
      throw new Error('[O-RA maintenance bilingual] maintenance notice marker not found');
    }

    return { code: code.replace(oldBlock, newBlock), map: null };
  },
});
