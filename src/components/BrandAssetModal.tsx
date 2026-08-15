import React from 'react';
import { X, Sparkles, Download, Layers, ShieldCheck, Check } from 'lucide-react';
import { useStore } from '../context/StoreContext';

export const BrandAssetModal: React.FC = () => {
  const { isBrandModalOpen, setIsBrandModalOpen } = useStore();

  if (!isBrandModalOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/40 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-3xl bg-white border border-gray-100 rounded-3xl shadow-2xl overflow-hidden my-auto p-6 sm:p-8 space-y-6 text-gray-900">
        {/* Close Button */}
        <button
          onClick={() => setIsBrandModalOpen(false)}
          className="absolute top-4 right-4 p-2 rounded-full bg-gray-100 text-gray-500 hover:text-black hover:bg-gray-200"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="space-y-1">
          <div className="inline-flex items-center space-x-2 px-3.5 py-1 rounded-full bg-orange-50 border border-orange-100 text-orange-600 text-xs font-bold">
            <Sparkles className="w-3.5 h-3.5 text-orange-600" />
            <span>O-RA BRAND IDENTITY & LOGO ASSETS</span>
          </div>
          <h2 className="text-2xl font-extrabold text-gray-900">
            Official Brand Assets Specification
          </h2>
          <p className="text-xs text-gray-500">
            Professional high-resolution vectors & raster logos designed for Website, Mobile App, Facebook Ads, TikTok Ads, and Luxury Packaging.
          </p>
        </div>

        {/* Brand Logos Showcase Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* 1. Full Brand Logo */}
          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 space-y-3">
            <div className="aspect-video rounded-xl bg-white border border-gray-200 flex items-center justify-center p-4">
              <div className="text-3xl font-black tracking-tighter text-black">
                O<span className="text-orange-600">-</span>RA
              </div>
            </div>

            <div className="flex justify-between items-center text-xs">
              <div>
                <p className="font-bold text-gray-900">1. Full Primary Logo</p>
                <p className="text-[10px] text-gray-500">For Website Header & Banners</p>
              </div>
              <a
                href="/src/assets/images/ora_brand_logo_1786042333675.jpg"
                download="O-RA_Full_Logo.jpg"
                className="px-3.5 py-1.5 rounded-full bg-black text-white font-bold text-xs hover:bg-orange-600 transition-colors flex items-center space-x-1"
              >
                <Download className="w-3 h-3" />
                <span>Download</span>
              </a>
            </div>
          </div>

          {/* 2. Icon-Only Logo */}
          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 space-y-3">
            <div className="aspect-video rounded-xl bg-white border border-gray-200 flex items-center justify-center p-4">
              <div className="w-14 h-14 rounded-2xl bg-black text-white flex items-center justify-center font-black text-xl tracking-tighter">
                O<span className="text-orange-600">-</span>RA
              </div>
            </div>

            <div className="flex justify-between items-center text-xs">
              <div>
                <p className="font-bold text-gray-900">2. Icon-Only Logo (Monogram)</p>
                <p className="text-[10px] text-gray-500">For Mobile Icon, FB & TikTok Ads</p>
              </div>
              <a
                href="/src/assets/images/ora_brand_logo_1786042333675.jpg"
                download="O-RA_Icon_Monogram.jpg"
                className="px-3.5 py-1.5 rounded-full bg-black text-white font-bold text-xs hover:bg-orange-600 transition-colors flex items-center space-x-1"
              >
                <Download className="w-3 h-3" />
                <span>Download</span>
              </a>
            </div>
          </div>
        </div>

        {/* High Resolution Image Generation Asset Preview */}
        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 flex items-center space-x-4">
          <img
            src="/src/assets/images/ora_brand_logo_1786042333675.jpg"
            alt="O-RA High Res Brand Logo"
            className="w-20 h-20 object-cover rounded-xl border border-gray-200"
          />
          <div className="flex-1 text-xs space-y-1">
            <p className="font-bold text-gray-900 text-sm">O-RA High-Resolution Master Asset</p>
            <p className="text-gray-500">
              High-resolution vector-scaled graphics for product packaging boxes, stickers, invoices, and social media ad creatives.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
