import React, { useEffect, useState } from 'react';
import type { Language } from '../types';
import type { CourierCityOption } from '../lib/courierCitySearch';

type Props = {
  value: string;
  language: Language;
  onChange: (value: string) => void;
  onSelect: (city: CourierCityOption) => void;
};

export const CityAutocomplete: React.FC<Props> = ({ value, language, onChange, onSelect }) => {
  const [open, setOpen] = useState(false);
  const [cities, setCities] = useState<CourierCityOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [searched, setSearched] = useState(false);
  const [active, setActive] = useState(0);
  const [retry, setRetry] = useState(0);
  const q = value.trim();
  const sinhala = language === 'si';

  useEffect(() => {
    setCities([]);
    setError(false);
    setSearched(false);
    setActive(0);
    if (!open || q.length < 2) { setLoading(false); return; }
    let cancelled = false;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    setLoading(true);
    const debounce = setTimeout(async () => {
      timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(`/api/courier/fardar/search?q=${encodeURIComponent(q)}`, { cache: 'no-store', signal: controller.signal });
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.cities)) throw new Error('City search failed');
        if (!cancelled) {
          setCities(data.cities.filter((city: any) => typeof city?.city === 'string' && typeof city?.district === 'string'));
          setSearched(true);
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        clearTimeout(timeout);
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(debounce); clearTimeout(timeout); controller.abort(); };
  }, [q, open, retry]);

  const pick = (city: CourierCityOption) => { setOpen(false); setCities([]); onSelect(city); };
  const showCities = open && cities.length > 0;
  return (
    <div className="relative" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
    }}>
      <input
        id="checkout-city"
        type="text"
        required
        maxLength={100}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showCities}
        aria-controls={showCities ? 'checkout-city-options' : undefined}
        aria-activedescendant={showCities ? `checkout-city-option-${active}` : undefined}
        aria-describedby="checkout-city-help"
        value={value}
        onFocus={() => setOpen(true)}
        onChange={(event) => { setOpen(true); setCities([]); onChange(event.target.value); }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
          if (!showCities) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + cities.length) % cities.length);
          }
          if (event.key === 'Enter') { event.preventDefault(); pick(cities[active]); }
        }}
        placeholder="e.g. Colombo, Kandy, Galle..."
        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-orange-500"
      />
      {showCities && (
        <div id="checkout-city-options" role="listbox" className="absolute left-0 right-0 top-full z-50 mt-1 max-h-52 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg">
          {cities.map((city, index) => (
            <button key={city.city + '\n' + city.district} id={`checkout-city-option-${index}`} type="button" role="option" tabIndex={-1} aria-selected={active === index}
              onMouseDown={(event) => event.preventDefault()} onClick={() => pick(city)}
              className={`block w-full px-3 py-3 text-left text-xs hover:bg-orange-50 ${active === index ? 'bg-orange-50' : ''}`}>
              <span className="font-bold text-gray-900">{city.city}</span>
              {city.district && <span className="ml-2 text-gray-500">• {city.district}</span>}
            </button>
          ))}
        </div>
      )}
      <div id="checkout-city-help" aria-live="polite" className="mt-1 text-[11px] text-gray-500">
        {open && loading ? (sinhala ? 'නගර සොයමින්…' : 'Searching cities…') : open && error ? (
          <span className="text-red-600">{sinhala ? 'නගර ලැයිස්තුව ලබාගත නොහැකි විය. ' : 'Could not load cities. '}
            <button type="button" className="font-bold underline" onClick={() => setRetry((count) => count + 1)}>{sinhala ? 'නැවත උත්සාහ කරන්න' : 'Try again'}</button>
          </span>
        ) : open && searched && !cities.length ? (sinhala ? 'නගරය හමු නොවීය. English නම පරීක්ෂා කරන්න.' : 'No matching city. Check the English spelling.') :
          (sinhala ? 'නගරයේ English නමේ අකුරු 2ක් හෝ වැඩි ගණනක් ලියා ලැයිස්තුවෙන් තෝරන්න.' : 'Type at least 2 letters in English and select your city.')}
      </div>
    </div>
  );
};
