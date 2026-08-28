import React from 'react';
import { Sparkles } from 'lucide-react';
import { useStore } from '../context/StoreContext';

const SESSION_KEY = 'ora_welcome_splash_seen_v1';

const isManagerPath = () =>
  typeof window !== 'undefined' &&
  (window.location.pathname.startsWith('/system') || window.location.pathname.startsWith('/ora-manager'));

const shouldShowWelcomeIntro = () => {
  if (typeof window === 'undefined' || isManagerPath()) return false;
  try {
    return window.sessionStorage.getItem(SESSION_KEY) !== '1';
  } catch {
    return true;
  }
};

export const WelcomeSplash: React.FC = () => {
  const { settings, language, sharedStoreReady } = useStore();

  // Decide on the FIRST render, not in useEffect. This prevents the homepage from
  // flashing for one frame before the welcome animation appears.
  const [introVisible, setIntroVisible] = React.useState<boolean>(() => shouldShowWelcomeIntro());
  const introWasRequested = React.useRef(introVisible);
  const [introMinimumDone, setIntroMinimumDone] = React.useState(false);
  const [leaving, setLeaving] = React.useState(false);

  React.useEffect(() => {
    if (!introWasRequested.current) return;

    try {
      window.sessionStorage.setItem(SESSION_KEY, '1');
    } catch {}

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const minimumTimer = window.setTimeout(() => setIntroMinimumDone(true), reduceMotion ? 650 : 1650);
    const removeTimer = window.setTimeout(() => setIntroVisible(false), reduceMotion ? 900 : 2150);

    return () => {
      window.clearTimeout(minimumTimer);
      window.clearTimeout(removeTimer);
    };
  }, []);

  // Never fade the welcome cover away while the real storefront is still loading.
  // If loading takes longer than the intro, it changes into the small boot loader
  // instead of exposing stale/default data underneath.
  React.useEffect(() => {
    if (introVisible && introMinimumDone && sharedStoreReady) setLeaving(true);
  }, [introVisible, introMinimumDone, sharedStoreReady]);

  if (isManagerPath()) return null;

  // After the intro has already been seen (including normal refreshes), keep a
  // clean white boot cover until the shared server catalog/settings finish loading.
  // This prevents stale/reset/default storefront data from flashing for ~1 second.
  if (!introVisible && sharedStoreReady) return null;

  const bootOnly = !introVisible;
  const logo = String(settings.website_logo || settings.mobile_logo || '').trim();
  const storeName = String(settings.brand_store_name || 'O-RA Online Store').trim();

  return (
    <div
      aria-hidden="true"
      className={`ora-welcome-splash fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-white px-6 transition-opacity duration-500 ${
        introVisible && leaving ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
    >
      <style>{`
        @keyframes oraWelcomeLogo {
          0% { opacity: 0; transform: translateY(14px) scale(.88); filter: blur(5px); }
          55% { opacity: 1; transform: translateY(0) scale(1.04); filter: blur(0); }
          100% { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
        }
        @keyframes oraWelcomeText {
          0% { opacity: 0; transform: translateY(10px); letter-spacing: .32em; }
          100% { opacity: 1; transform: translateY(0); letter-spacing: .08em; }
        }
        @keyframes oraWelcomeLine {
          0% { transform: scaleX(0); opacity: 0; }
          35% { opacity: 1; }
          100% { transform: scaleX(1); opacity: 1; }
        }
        @keyframes oraWelcomeGlow {
          0%,100% { transform: scale(.92); opacity: .24; }
          50% { transform: scale(1.12); opacity: .46; }
        }
        @keyframes oraBootPulse {
          0%,100% { opacity: .35; transform: scaleX(.45); }
          50% { opacity: 1; transform: scaleX(1); }
        }
        .ora-welcome-logo { animation: oraWelcomeLogo .8s cubic-bezier(.2,.8,.2,1) both; }
        .ora-welcome-text { animation: oraWelcomeText .7s .28s cubic-bezier(.2,.8,.2,1) both; }
        .ora-welcome-line { animation: oraWelcomeLine .75s .5s ease-out both; transform-origin: center; }
        .ora-welcome-glow { animation: oraWelcomeGlow 1.7s ease-in-out infinite; }
        .ora-boot-line { animation: oraBootPulse 1.05s ease-in-out infinite; transform-origin: center; }
        @media (prefers-reduced-motion: reduce) {
          .ora-welcome-logo,.ora-welcome-text,.ora-welcome-line,.ora-welcome-glow,.ora-boot-line { animation: none !important; }
        }
      `}</style>

      <div className={`${bootOnly ? '' : 'ora-welcome-glow'} absolute h-72 w-72 rounded-full bg-orange-300/30 blur-3xl sm:h-96 sm:w-96`} />
      <div className="relative flex w-full max-w-lg flex-col items-center text-center">
        <div className={`${bootOnly ? '' : 'ora-welcome-logo'} mb-5 flex min-h-20 items-center justify-center`}>
          {logo ? (
            <img
              src={logo}
              alt=""
              className="max-h-24 max-w-[260px] object-contain sm:max-h-28 sm:max-w-[320px]"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="text-5xl font-black tracking-[-0.08em] text-gray-950 sm:text-6xl">O-RA</div>
          )}
        </div>

        {bootOnly ? (
          <>
            <div className="text-[10px] font-black uppercase tracking-[.08em] text-gray-500 sm:text-xs">
              {language === 'si' ? 'Store එක load වෙමින්...' : `Loading ${storeName}...`}
            </div>
            <div className="ora-boot-line mt-4 h-[2px] w-24 rounded-full bg-orange-500 sm:w-28" />
          </>
        ) : (
          <>
            <div className="ora-welcome-text flex items-center gap-2 text-[10px] font-black uppercase text-orange-600 sm:text-xs">
              <Sparkles className="h-4 w-4" />
              <span>{language === 'si' ? 'O-RA Online Store වෙත සාදරයෙන් පිළිගනිමු' : `Welcome to ${storeName}`}</span>
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="ora-welcome-line mt-4 h-[2px] w-28 rounded-full bg-gradient-to-r from-transparent via-orange-500 to-transparent sm:w-36" />
            <p className="ora-welcome-text mt-3 text-[10px] font-semibold text-gray-400 sm:text-[11px]">
              Shop smart. Shop with confidence.
            </p>
          </>
        )}
      </div>
    </div>
  );
};
