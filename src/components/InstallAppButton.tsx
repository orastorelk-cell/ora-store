import React from 'react';
import { Download, Smartphone } from 'lucide-react';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

export const InstallAppButton: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const [promptEvent, setPromptEvent] = React.useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = React.useState(false);
  const [showHint, setShowHint] = React.useState(false);

  React.useEffect(() => {
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
    setInstalled(Boolean(standalone));
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed) return null;

  const install = async () => {
    if (promptEvent) {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice.catch(() => null);
      if (choice?.outcome === 'accepted') setInstalled(true);
      setPromptEvent(null);
      return;
    }
    setShowHint((v) => !v);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={install}
        className={compact
          ? 'inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 p-1.5 sm:px-2 sm:py-2 text-[11px] font-black text-orange-800 hover:bg-orange-100'
          : 'inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-black text-orange-800 hover:bg-orange-100'}
        title="Install O-RA App"
      >
        {compact ? <Smartphone className="h-4 w-4" /> : <Download className="h-4 w-4" />}
        <span className={compact ? 'hidden sm:inline' : ''}>{compact ? 'Install' : 'Install App'}</span>
      </button>
      {showHint && !promptEvent && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-2xl border border-gray-200 bg-white p-3 text-[11px] leading-5 text-gray-600 shadow-xl">
          If your browser does not show the install prompt, open the browser menu and choose <b>Install app</b> or <b>Add to Home Screen</b>. The live HTTPS site gives the best install experience.
        </div>
      )}
    </div>
  );
};
