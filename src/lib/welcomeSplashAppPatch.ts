export const welcomeSplashAppPatch = () => ({
  name: 'ora-welcome-splash-app-patch',
  enforce: 'pre' as const,
  transform(code: string, rawId: string) {
    const id = rawId.split('?')[0].replace(/\\/g, '/');
    if (!id.endsWith('/src/App.tsx')) return null;

    let text = code;

    const importMarker = "import { HeroBanner } from './components/HeroBanner';";
    if (!text.includes("import { WelcomeSplash } from './components/WelcomeSplash';")) {
      if (!text.includes(importMarker)) throw new Error('[O-RA welcome splash] App import marker not found');
      text = text.replace(importMarker, `${importMarker}\nimport { WelcomeSplash } from './components/WelcomeSplash';`);
    }

    const infoMarker = '<div className="ora-storefront min-h-screen bg-gray-50 text-gray-900 pb-20 md:pb-12 font-sans">\n        <Header />';
    if (text.includes(infoMarker) && !text.includes(`${infoMarker.split('\n')[0]}\n        <WelcomeSplash />`)) {
      text = text.replace(
        infoMarker,
        '<div className="ora-storefront min-h-screen bg-gray-50 text-gray-900 pb-20 md:pb-12 font-sans">\n        <WelcomeSplash />\n        <Header />'
      );
    }

    const homeMarker = '<div className="ora-storefront min-h-screen bg-gray-50 text-gray-900 pb-20 md:pb-12 font-sans selection:bg-orange-100 selection:text-orange-900">\n      <Header />';
    if (text.includes(homeMarker) && !text.includes(`${homeMarker.split('\n')[0]}\n      <WelcomeSplash />`)) {
      text = text.replace(
        homeMarker,
        '<div className="ora-storefront min-h-screen bg-gray-50 text-gray-900 pb-20 md:pb-12 font-sans selection:bg-orange-100 selection:text-orange-900">\n      <WelcomeSplash />\n      <Header />'
      );
    }

    return text === code ? null : { code: text, map: null };
  },
});
