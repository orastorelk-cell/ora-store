export const adminDashboardStoragePatch = () => ({
  name: 'ora-admin-storage-monitor-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/components/admin/AdminDashboard.tsx')) return null;

    let text = code;

    const importMarker = "import { NotificationsPanel } from './NotificationsPanel';\n";
    if (!text.includes("import { StoragePanel } from './StoragePanel';")) {
      if (!text.includes(importMarker)) throw new Error('[O-RA storage patch] import marker not found');
      text = text.replace(importMarker, importMarker + "import { StoragePanel } from './StoragePanel';\n");
    }

    const unionMarker = "'activity' | 'branding' | 'website_info' | 'settings' | 'user_access' | 'deploy'";
    if (!text.includes("'activity' | 'branding' | 'website_info' | 'storage' | 'settings' | 'user_access' | 'deploy'")) {
      if (!text.includes(unionMarker)) throw new Error('[O-RA storage patch] active tab marker not found');
      text = text.replace(unionMarker, "'activity' | 'branding' | 'website_info' | 'storage' | 'settings' | 'user_access' | 'deploy'");
    }

    const sidebarMarker = "      { id:'website_info', label:'Website Info & Policies', icon:FileText },\n      { id:'settings', label:'Store Settings', icon:Settings },";
    if (!text.includes("{ id:'storage', label:'Storage', icon:Database }")) {
      if (!text.includes(sidebarMarker)) throw new Error('[O-RA storage patch] sidebar marker not found');
      text = text.replace(
        sidebarMarker,
        "      { id:'website_info', label:'Website Info & Policies', icon:FileText },\n      { id:'storage', label:'Storage', icon:Database },\n      { id:'settings', label:'Store Settings', icon:Settings },",
      );
    }

    const renderMarker = "      {activeTab === 'settings' && (\n";
    if (!text.includes("activeTab === 'storage'")) {
      if (!text.includes(renderMarker)) throw new Error('[O-RA storage patch] render marker not found');
      text = text.replace(
        renderMarker,
        "      {activeTab === 'storage' && adminUser?.role === 'admin' && <StoragePanel />}\n\n" + renderMarker,
      );
    }

    return text === code ? null : { code: text, map: null };
  },
});
