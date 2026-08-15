import React from 'react';
import { MessageSquare, PhoneCall } from 'lucide-react';
import { useStore } from '../context/StoreContext';

export const WhatsAppFloatingButton: React.FC = () => {
  const { settings } = useStore();

  const openWhatsApp = () => {
    const text = encodeURIComponent('Hello O-RA Online Store! I would like to inquire about products and delivery.');
    window.open(`https://wa.me/${settings.whatsapp_number.replace('+', '')}?text=${text}`, '_blank');
  };

  return (
    <div className="fixed bottom-20 md:bottom-6 right-4 z-40 flex flex-col space-y-2">
      <a
        href="tel:+94771234567"
        className="p-3 rounded-full bg-neutral-900 border border-neutral-700 text-amber-400 hover:text-amber-300 shadow-xl transition-transform hover:scale-110 flex items-center justify-center"
        title="Direct Call Hotline"
      >
        <PhoneCall className="w-5 h-5" />
      </a>

      <button
        onClick={openWhatsApp}
        className="p-3.5 rounded-full bg-emerald-500 text-neutral-950 font-bold shadow-xl shadow-emerald-500/30 transition-transform hover:scale-110 flex items-center justify-center group relative"
        title="Chat on WhatsApp (+94 77 123 4567)"
      >
        <MessageSquare className="w-6 h-6 fill-current" />
        <span className="absolute right-full mr-3 bg-neutral-900 text-white text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-neutral-800 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
          Chat on WhatsApp
        </span>
      </button>
    </div>
  );
};
