import React from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUpDown,
  BadgeDollarSign,
  Check,
  ChevronDown,
  Grid2X2,
  RotateCcw,
  SlidersHorizontal,
  X,
} from 'lucide-react';

export type CatalogSortMode = 'relevance' | 'newest' | 'price-low' | 'price-high';
export type CatalogPriceRange = 'all' | '100-500' | '500-1000' | '1000-2000' | '2000-3500' | '3500-5000' | '5000-plus';

export interface CatalogCategoryOption {
  slug: string | null;
  label: string;
  count: number;
  icon?: string;
}

interface ProductFilterBarProps {
  language: 'en' | 'si';
  categories: CatalogCategoryOption[];
  selectedCategorySlug: string | null;
  priceRange: CatalogPriceRange;
  sortMode: CatalogSortMode;
  visibleCount: number;
  totalCount: number;
  hasActiveFilters: boolean;
  onCategoryChange: (slug: string | null) => void;
  onPriceChange: (range: CatalogPriceRange) => void;
  onSortChange: (mode: CatalogSortMode) => void;
  onClearAll: () => void;
}

type PanelKind = 'category' | 'price' | 'sort';

const priceOptions: { value: CatalogPriceRange; label: string }[] = [
  { value: 'all', label: 'All Prices' },
  { value: '100-500', label: 'Rs. 100 – 500' },
  { value: '500-1000', label: 'Rs. 500 – 1,000' },
  { value: '1000-2000', label: 'Rs. 1,000 – 2,000' },
  { value: '2000-3500', label: 'Rs. 2,000 – 3,500' },
  { value: '3500-5000', label: 'Rs. 3,500 – 5,000' },
  { value: '5000-plus', label: 'Rs. 5,000+' },
];

const sortOptions: { value: CatalogSortMode; label: string }[] = [
  { value: 'relevance', label: 'Most Relevant' },
  { value: 'newest', label: 'Newest' },
  { value: 'price-low', label: 'Price: Low to High' },
  { value: 'price-high', label: 'Price: High to Low' },
];

export const ProductFilterBar: React.FC<ProductFilterBarProps> = ({
  language,
  categories,
  selectedCategorySlug,
  priceRange,
  sortMode,
  visibleCount,
  totalCount,
  hasActiveFilters,
  onCategoryChange,
  onPriceChange,
  onSortChange,
  onClearAll,
}) => {
  const [openPanel, setOpenPanel] = React.useState<PanelKind | null>(null);
  const dialogTitleId = React.useId();

  React.useEffect(() => {
    if (!openPanel) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenPanel(null);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [openPanel]);

  const selectedCategory = categories.find((option) => option.slug === selectedCategorySlug) || categories[0];
  const selectedPrice = priceOptions.find((option) => option.value === priceRange) || priceOptions[0];
  const selectedSort = sortOptions.find((option) => option.value === sortMode) || sortOptions[0];

  const labels = language === 'si'
    ? {
        eyebrow: 'භාණ්ඩ සොයන්න',
        result: `${visibleCount} / ${totalCount} භාණ්ඩ පෙන්වයි`,
        category: 'වර්ගය',
        price: 'මිල',
        sort: 'පෙළගැස්ම',
        clear: 'සියල්ල ඉවත් කරන්න',
        chooseCategory: 'භාණ්ඩ වර්ගයක් තෝරන්න',
        choosePrice: 'මිල පරාසයක් තෝරන්න',
        chooseSort: 'පෙළගැස්ම තෝරන්න',
        close: 'වසන්න',
      }
    : {
        eyebrow: 'Browse Products',
        result: `Showing ${visibleCount} of ${totalCount} items`,
        category: 'Category',
        price: 'Price',
        sort: 'Sort By',
        clear: 'Clear all',
        chooseCategory: 'Choose a category',
        choosePrice: 'Choose a price range',
        chooseSort: 'Choose how to sort',
        close: 'Close',
      };

  const panelTitle = openPanel === 'category'
    ? labels.chooseCategory
    : openPanel === 'price'
      ? labels.choosePrice
      : labels.chooseSort;

  const FilterButton = ({
    kind,
    label,
    value,
    icon,
    className = '',
  }: {
    kind: PanelKind;
    label: string;
    value: string;
    icon: React.ReactNode;
    className?: string;
  }) => (
    <button
      type="button"
      onClick={() => setOpenPanel(kind)}
      className={`group flex min-w-0 items-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-left shadow-sm transition-colors hover:border-orange-300 hover:bg-orange-50/40 ${className}`}
      aria-haspopup="dialog"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[9px] font-black uppercase tracking-wider text-gray-400">{label}</span>
        <span className="block truncate text-[11px] font-black text-gray-900">{value}</span>
      </span>
      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform group-hover:text-orange-600" />
    </button>
  );

  const selectOption = (kind: PanelKind, value: string | null) => {
    if (kind === 'category') onCategoryChange(value);
    if (kind === 'price') onPriceChange(value as CatalogPriceRange);
    if (kind === 'sort') onSortChange(value as CatalogSortMode);
    setOpenPanel(null);
  };

  const options = openPanel === 'category'
    ? categories.map((option) => ({ value: option.slug, label: option.label, count: option.count, icon: option.icon }))
    : openPanel === 'price'
      ? priceOptions.map((option) => ({ ...option, count: undefined, icon: undefined }))
      : sortOptions.map((option) => ({ ...option, count: undefined, icon: undefined }));

  const currentValue = openPanel === 'category' ? selectedCategorySlug : openPanel === 'price' ? priceRange : sortMode;

  return (
    <>
      <section id="categories-section" aria-label="Product filters" className="rounded-3xl border border-gray-200 bg-white p-3 shadow-sm sm:p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-black text-orange-400">
              <SlidersHorizontal className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-black text-gray-900 sm:text-sm">{labels.eyebrow}</p>
              <p className="truncate text-[10px] font-medium text-gray-500 sm:text-xs">{labels.result}</p>
            </div>
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={onClearAll}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-orange-50 px-2.5 py-1.5 text-[10px] font-black text-orange-700 hover:bg-orange-100"
            >
              <RotateCcw className="h-3 w-3" />
              <span>{labels.clear}</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <FilterButton
            kind="category"
            label={labels.category}
            value={selectedCategory?.label || 'All Categories'}
            icon={<Grid2X2 className="h-4 w-4" />}
            className="col-span-2 sm:col-span-1"
          />
          <FilterButton
            kind="price"
            label={labels.price}
            value={priceRange === 'all' && language === 'si' ? 'සියලු මිල' : selectedPrice.label}
            icon={<BadgeDollarSign className="h-4 w-4" />}
          />
          <FilterButton
            kind="sort"
            label={labels.sort}
            value={selectedSort.label}
            icon={<ArrowUpDown className="h-4 w-4" />}
          />
        </div>
      </section>

      {openPanel && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpenPanel(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            className="w-full overflow-hidden rounded-t-3xl border border-gray-200 bg-white shadow-2xl sm:max-w-md sm:rounded-3xl"
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-black text-orange-400">
                  <SlidersHorizontal className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-[9px] font-black uppercase tracking-[0.16em] text-orange-600">O-RA Store</p>
                  <h3 id={dialogTitleId} className="truncate text-sm font-black text-gray-900">{panelTitle}</h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpenPanel(null)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-black"
                aria-label={labels.close}
                autoFocus
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[66vh] overflow-y-auto p-3 sm:max-h-[60vh]">
              <div className="space-y-1.5">
                {options.map((option) => {
                  const isSelected = option.value === currentValue;
                  return (
                    <button
                      key={option.value ?? 'all'}
                      type="button"
                      onClick={() => selectOption(openPanel, option.value)}
                      className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-colors ${
                        isSelected
                          ? 'border-orange-200 bg-orange-50 text-gray-950'
                          : 'border-transparent bg-white text-gray-700 hover:border-gray-200 hover:bg-gray-50'
                      }`}
                      aria-pressed={isSelected}
                    >
                      {option.icon && <span className="text-lg leading-none">{option.icon}</span>}
                      <span className="min-w-0 flex-1 truncate text-sm font-bold">{option.label}</span>
                      {typeof option.count === 'number' && (
                        <span className={`rounded-full px-2 py-1 text-[10px] font-black ${isSelected ? 'bg-white text-orange-700' : 'bg-gray-100 text-gray-500'}`}>
                          {option.count}
                        </span>
                      )}
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${isSelected ? 'border-orange-600 bg-orange-600 text-white' : 'border-gray-300 text-transparent'}`}>
                        <Check className="h-3.5 w-3.5" />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};
