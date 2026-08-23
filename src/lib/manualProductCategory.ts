const CATEGORY_INPUT_CLASS = 'ora-product-category-input';

interface CategoryOptionRow {
  value: string;
  name: string;
  fullText: string;
}

interface ManualCategoryState {
  productKey: string;
  manualName: string;
}

const stateBySection = new WeakMap<HTMLElement, ManualCategoryState>();
let listCounter = 0;

const normalize = (value: string) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const slugify = (value: string) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 80) || `category-${Date.now()}`;

const savedCategoryOptions = (select: HTMLSelectElement): CategoryOptionRow[] =>
  Array.from(select.options)
    .map((option) => {
      const fullText = String(option.textContent || '').trim();
      const name = fullText.replace(/^Auto:\s*/i, '').split(' (')[0].trim();
      return { value: option.value, name, fullText };
    })
    .filter((row) => row.value && row.name && !/^Auto:\s*/i.test(row.fullText));

const exactCategory = (select: HTMLSelectElement, typed: string) => {
  const key = normalize(typed);
  return savedCategoryOptions(select).find((row) =>
    normalize(row.name) === key || normalize(row.fullText) === key || normalize(row.value) === key
  );
};

const setReactSelectValue = (select: HTMLSelectElement, value: string) => {
  if (!value || select.value === value) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  if (setter) setter.call(select, value);
  else select.value = value;
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
};

const findProductKey = (section: HTMLElement) => {
  const form = section.closest('form');
  if (!form) return '';
  const skuLabel = Array.from(form.querySelectorAll<HTMLLabelElement>('label'))
    .find((label) => String(label.textContent || '').includes('Item Code / SKU'));
  const block = skuLabel?.parentElement?.parentElement;
  const input = block?.querySelector<HTMLInputElement>('input[type="text"]');
  return String(input?.value || '').trim().toUpperCase();
};

const findProductName = (section: HTMLElement) => {
  const form = section.closest('form');
  if (!form) return '';
  const label = Array.from(form.querySelectorAll<HTMLLabelElement>('label'))
    .find((row) => String(row.textContent || '').includes('Name (English)'));
  const input = label?.parentElement?.querySelector<HTMLInputElement>('input[type="text"]');
  return String(input?.value || '').trim();
};

const hideAutoCategoryUi = (form: HTMLFormElement | null, categoryHeader: HTMLElement | null) => {
  const label = categoryHeader?.querySelector<HTMLLabelElement>('label');
  if (label) label.textContent = 'Product Category';
  const button = categoryHeader?.querySelector<HTMLButtonElement>('button');
  if (button && /Auto Fill Again/i.test(String(button.textContent || ''))) button.style.display = 'none';

  if (!form) return;
  Array.from(form.querySelectorAll<HTMLElement>('span')).forEach((span) => {
    if (/Auto Category/i.test(String(span.textContent || ''))) span.style.display = 'none';
  });
  Array.from(form.querySelectorAll<HTMLParagraphElement>('p')).forEach((paragraph) => {
    const text = String(paragraph.textContent || '');
    if (/Tags auto-filled below|Category and tags update immediately|Auto-selected from the English item name/i.test(text)) {
      paragraph.style.display = 'none';
    }
  });
};

const getAdminState = async () => {
  const token = localStorage.getItem('ora_staff_session_token') || '';
  if (!token) throw new Error('Admin session expired. Please log in again.');
  const response = await fetch('/api/admin/storefront/state', {
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || 'Could not load product catalog.');
  return { token, state: data?.state };
};

const saveAdminState = async (token: string, state: any) => {
  const response = await fetch('/api/admin/storefront/state', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      products: Array.isArray(state?.products) ? state.products : [],
      categories: Array.isArray(state?.categories) ? state.categories : [],
      settings: state?.settings && typeof state.settings === 'object' ? state.settings : {},
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || 'Could not save manual product category.');
  return data;
};

const persistManualCategory = async (productKey: string, productName: string, manualName: string) => {
  const cleanName = String(manualName || '').trim();
  if (!productKey || !cleanName) return;

  // React publishes product edits with a short debounce. Wait until that normal save
  // has had time to finish, then change only category data in the authoritative state.
  await new Promise((resolve) => window.setTimeout(resolve, 1200));

  const { token, state } = await getAdminState();
  if (!state || !Array.isArray(state.products) || !Array.isArray(state.categories)) {
    throw new Error('Shared product catalog is unavailable.');
  }

  const product = state.products.find((row: any) =>
    String(row?.sku || '').trim().toUpperCase() === productKey
  );
  if (!product) throw new Error(`Saved product ${productKey} was not found.`);

  const wanted = normalize(cleanName);
  let category = state.categories.find((row: any) =>
    normalize(String(row?.name_en || '')) === wanted || normalize(String(row?.slug || '')) === wanted
  );

  if (!category) {
    const slug = slugify(cleanName);
    category = state.categories.find((row: any) => String(row?.slug || '') === slug);
    if (!category) {
      category = {
        id: `manual-${slug}`,
        name_en: cleanName,
        name_si: cleanName,
        slug,
        icon: '📦',
      };
      state.categories = [...state.categories, category];
    }
  }

  const currentProductName = String(product?.name_en || '').trim();
  if (productName && currentProductName && normalize(currentProductName) !== normalize(productName)) {
    // A stale server read can happen immediately after Save. Retry once after the
    // normal React publish completes instead of overwriting other product edits.
    await new Promise((resolve) => window.setTimeout(resolve, 700));
    return persistManualCategory(productKey, '', cleanName);
  }

  product.category_id = category.id;
  product.category_slug = category.slug;
  await saveAdminState(token, state);
};

const syncInputFromSavedProduct = (
  section: HTMLElement,
  select: HTMLSelectElement,
  input: HTMLInputElement,
) => {
  const productKey = findProductKey(section);
  const current = savedCategoryOptions(select).find((row) => row.value === select.value);
  const state = stateBySection.get(section);
  if (state?.productKey === productKey && state.manualName) return;
  const manualName = current?.name || '';
  stateBySection.set(section, { productKey, manualName });
  input.value = manualName;
};

const installCategoryInput = (section: HTMLElement, select: HTMLSelectElement) => {
  const form = section.closest('form');
  const header = select.previousElementSibling instanceof HTMLElement ? select.previousElementSibling : null;
  hideAutoCategoryUi(form, header);

  let input = section.querySelector<HTMLInputElement>(`.${CATEGORY_INPUT_CLASS}`);
  if (input) {
    const productKey = findProductKey(section);
    if (stateBySection.get(section)?.productKey !== productKey) syncInputFromSavedProduct(section, select, input);
    return;
  }

  // Keep the original React select in the DOM as the proven save bridge, but show
  // only one typeable Product Category field to the admin.
  select.style.display = 'none';
  Array.from(select.options).forEach((option) => {
    if (/^Auto:\s*/i.test(String(option.textContent || '').trim())) option.hidden = true;
  });

  input = document.createElement('input');
  input.type = 'text';
  input.autocomplete = 'off';
  input.placeholder = 'Type category or choose a saved category';
  input.className = `${CATEGORY_INPUT_CLASS} w-full bg-neutral-950 border border-neutral-700 focus:border-amber-400 rounded-xl px-3 py-2 text-white`;

  const datalist = document.createElement('datalist');
  datalist.id = `ora-product-category-list-${++listCounter}`;
  input.setAttribute('list', datalist.id);
  savedCategoryOptions(select).forEach((row) => {
    const option = document.createElement('option');
    option.value = row.name;
    option.label = row.fullText;
    datalist.appendChild(option);
  });

  const updateManualChoice = () => {
    const manualName = input!.value.trim();
    const productKey = findProductKey(section);
    stateBySection.set(section, { productKey, manualName });
    const existing = exactCategory(select, manualName);
    if (existing) setReactSelectValue(select, existing.value);
  };

  input.addEventListener('input', updateManualChoice);
  input.addEventListener('change', updateManualChoice);
  input.addEventListener('blur', updateManualChoice);

  // The old product-name auto code may still change the hidden select. If the typed
  // category is an existing saved category, immediately restore the manual choice.
  const keepExistingManualChoice = () => {
    const manualName = stateBySection.get(section)?.manualName || input!.value.trim();
    const existing = exactCategory(select, manualName);
    if (existing) window.setTimeout(() => setReactSelectValue(select, existing.value), 0);
  };
  form?.addEventListener('input', keepExistingManualChoice);
  form?.addEventListener('change', keepExistingManualChoice);
  form?.addEventListener('focusout', keepExistingManualChoice);

  form?.addEventListener('submit', (event) => {
    const manualName = input!.value.trim();
    if (!manualName) {
      event.preventDefault();
      event.stopPropagation();
      alert('Product Category is required.');
      input!.focus();
      return;
    }

    const productKey = findProductKey(section);
    const productName = findProductName(section);
    stateBySection.set(section, { productKey, manualName });

    // For an existing category, send it through React normally. For a brand-new
    // typed category, keep a valid existing category only as a temporary save bridge;
    // after the normal product save closes the form, the authoritative server state
    // is patched to the exact typed category and the new category is added once.
    const existing = exactCategory(select, manualName);
    const fallback = existing || savedCategoryOptions(select).find((row) => row.value === select.value) || savedCategoryOptions(select)[0];
    if (fallback) setReactSelectValue(select, fallback.value);

    window.setTimeout(() => {
      if (form?.isConnected) return; // normal product validation/save did not finish
      void persistManualCategory(productKey, productName, manualName)
        .then(() => window.location.reload())
        .catch((error) => alert(error?.message || 'Manual category could not be saved.'));
    }, 250);
  }, true);

  select.insertAdjacentElement('beforebegin', input);
  input.insertAdjacentElement('afterend', datalist);
  syncInputFromSavedProduct(section, select, input);
};

const scan = () => {
  const labels = Array.from(document.querySelectorAll<HTMLLabelElement>('label'));
  labels.forEach((label) => {
    const text = String(label.textContent || '').trim();
    if (text !== 'Auto Category' && text !== 'Product Category' && text !== 'Product Category (Manual)') return;
    const header = label.parentElement;
    const section = header?.parentElement;
    if (!(section instanceof HTMLElement)) return;
    const select = section.querySelector<HTMLSelectElement>('select');
    if (!select) return;
    installCategoryInput(section, select);
  });
};

let scanQueued = false;
const queueScan = () => {
  if (scanQueued) return;
  scanQueued = true;
  window.requestAnimationFrame(() => {
    scanQueued = false;
    scan();
  });
};

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', queueScan, { once: true });
  else queueScan();
  const observer = new MutationObserver(queueScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
