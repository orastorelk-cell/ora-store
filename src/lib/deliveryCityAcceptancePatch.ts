export const deliveryCityAcceptancePatch = () => ({
  name: 'ora-delivery-city-acceptance-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    let text = code;

    if (id.endsWith('/src/context/StoreContext.tsx')) {
      const oldAssignGate = "    const resolvedCity = order.fardar_city || resolveFardarCity(order.city).city;\n    if (fardarCities.length > 0 && !resolvedCity) return null;";
      const newAssignGate = "    const resolvedCity = order.fardar_city || resolveFardarCity(order.city).city || String(order.city || '').trim();\n    if (!resolvedCity) return null;";
      if (!text.includes(oldAssignGate)) throw new Error('[O-RA delivery city patch] assignNextWaybill city gate marker not found');
      text = text.replace(oldAssignGate, newAssignGate);

      text = text.replace(
        "fardar_city: resolvedCity || o.fardar_city, city_verified: fardarCities.length ? true : o.city_verified",
        "fardar_city: resolvedCity || o.fardar_city, city_verified: Boolean(resolvedCity) ? true : o.city_verified"
      );
    }

    if (id.endsWith('/src/components/admin/AdminDashboard.tsx')) {
      const oldUiGate = "                const resolved = order.fardar_city || resolveFardarCity(order.city).city;\n                const needsCity = fardarCities.length > 0 && !resolved;";
      const newUiGate = "                const resolved = order.fardar_city || resolveFardarCity(order.city).city || String(order.city || '').trim();\n                const needsCity = !resolved;";
      if (!text.includes(oldUiGate)) throw new Error('[O-RA delivery city patch] delivery UI city gate marker not found');
      text = text.replace(oldUiGate, newUiGate);
      text = text.replace("{fardarCities.length ? 'Verified / Auto matched' : 'City list not uploaded yet'}", "{order.fardar_city || resolveFardarCity(order.city).city ? 'Verified / Auto matched' : 'Order / CSV city accepted'}");
    }

    return text === code ? null : { code: text, map: null };
  },
});
