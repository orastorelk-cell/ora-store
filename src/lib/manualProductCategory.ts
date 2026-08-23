const MANUAL_CATEGORY_FIELD_CLASS = 'ora-manual-product-category-field';
const MANUAL_CATEGORY_LIST_ID = 'ora-manual-product-category-list';

const normalizeCategoryText = (value: string) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

interface CategoryOptionRow {
  value: string;
  name: string;
  fullText: string;
}

const manualCategoryBySection = new WeakMap<HTMLElement, string>();
const resubmittingForms = new WeakSet<HTMLFormElement>();

const savedCategoryOptions = (select: HTMLSelectElement): CategoryOptionRow[] =>
  Array.from(select.options)
    .map((option) => {
      const fullText = String(option.textContent || '').trim();
      const name = fullText.replace(/^Auto:\s*/i, '').split(' (')[0].trim();
      return { value: option.value, name, fullText };
    })
    .filter((row) => row.value && !/^Auto:\s*/i.test(row.fullText));

const setReactSelectValue = (select: HTMLSelectElement, value: string, forceEvent = false) => {
  const changed = select.value !== value;
  if (changed) {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    if (setter) setter.call(select, value);
    else select.value = value;
  }
  if (!changed && !forceEvent) return;
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
};

const findCurrentSavedCategory = (select: HTMLSelectElement) =>
  savedCategoryOptions(select).find((row) => row.value === select.value);

const findProductKey = (section: HTMLElement) => {
  const form = section.closest('form');
  if (!form) return '';
  const skuLabel = Array.from(form.querySelectorAll<HTMLLabelElement>('label'))
    .find((label) => String(label.textContent || '').includes('Item Code / SKU'));
  const skuArea = skuLabel?.parentElement?.parentElement;
  const skuInput = skuArea?.querySelector<HTMLInputElement>('input[type="text"]');
  return String(skuInput?.value || '').trim().toUpperCase();
};

const updateCategoryList = (select: HTMLSelectElement, datalist: HTMLDataListElement) => {
  const rows = savedCategoryOptions(select);
  const signature = rows.map((row) => `${row.value}:${row.fullText}`).join('|');
  if (datalist.dataset.signature === signature) return;
  datalist.dataset.signature = signature;
  datalist.replaceChildren(...rows.map((row) => {
    const option = document.createElement('option');
    option.value = row.name;
    option.label = row.fullText;
    return option;
  }));
};

const setFieldState = (
  input: HTMLInputElement,
  status: HTMLParagraphElement,
  row?: CategoryOptionRow,
) => {
  if (row) {
    input.value = row.name;
    status.textContent = `Selected: ${row.name}`;
    status.className = 'mt-1 text-[10px] font-bold text-emerald-400';
  } else {
    status.textContent = 'Type or choose a saved category.';
    status.className = 'mt-1 text-[10px] text-neutral-500';
  }
};

const syncManualFromSelect = (
  section: HTMLElement,
  select: HTMLSelectElement,
  input: HTMLInputElement,
  status: HTMLParagraphElement,
) => {
  const current = findCurrentSavedCategory(select);
  if (!current) {
    manualCategoryBySection.delete(section);
    input.value = '';
    setFieldState(input, status);
    return;
  }
  manualCategoryBySection.set(section, current.value);
  setFieldState(input, status, current);
};

const enforceManualCategory = (section: HTMLElement, select: HTMLSelectElement) => {
  const manualValue = manualCategoryBySection.get(section);
  if (!manualValue || !section.isConnected || !select.isConnected) return;
  if (select.value !== manualValue) setReactSelectValue(select, manualValue);
};

const queueManualCategoryEnforce = (section: HTMLElement, select: HTMLSelectElement) => {
  if (!manualCategoryBySection.has(section)) return;
  const run = () => enforceManualCategory(section, select);
  window.setTimeout(run, 0);
  window.requestAnimationFrame(() => {
    run();
    window.requestAnimationFrame(run);
  });
  window.setTimeout(run, 80);
};

const resolveTypedCategory = (select: HTMLSelectElement, typed: string, allowPartial = false) => {
  const query = normalizeCategoryText(typed);
  if (!query) return undefined;
  const rows = savedCategoryOptions(select);
  const exact = rows.find((row) =>
    normalizeCategoryText(row.name) === query ||
    normalizeCategoryText(row.fullText) === query ||
    normalizeCategoryText(row.value) === query
  );
  if (exact || !allowPartial) return exact;
  const matches = rows.filter((row) =>
    normalizeCategoryText(row.name).includes(query) ||
    normalizeCategoryText(row.value).includes(query)
  );
  return matches.length === 1 ? matches[0] : undefined;
};

const applyTypedCategory = (
  section: HTMLElement,
  select: HTMLSelectElement,
  input: HTMLInputElement,
  status: HTMLParagraphElement,
  allowPartial = false,
) => {
  const match = resolveTypedCategory(select, input.value, allowPartial);
  if (!match) {
    status.textContent = input.value.trim()
      ? 'Choose a saved category from the suggestions.'
      : 'Type or choose a saved category.';
    status.className = input.value.trim()
      ? 'mt-1 text-[10px] font-bold text-amber-300'
      : 'mt-1 text-[10px] text-neutral-500';
    return false;
  }

  manualCategoryBySection.set(section, match.value);
  setReactSelectValue(select, match.value, true);
  setFieldState(input, status, match);
  queueManualCategoryEnforce(section, select);
  return true;
};

const removeAutoCategoryHints = () => {
  const labels = Array.from(document.querySelectorAll<HTMLLabelElement>('label'));
  labels.forEach((label) => {
    if (!String(label.textContent || '').includes('Name (English)')) return;
    const autoText = label.querySelector<HTMLSpanElement>('span');
    if (autoText && String(autoText.textContent || '').includes('Auto Category')) {
      autoText.textContent = '→ Auto Tags';
    }
    const parent = label.parentElement;
    const hint = parent?.querySelector<HTMLParagraphElement>('p');
    if (hint && (/Auto Category/i.test(hint.textContent || '') || /Category and tags/i.test(hint.textContent || '') || /Tags auto-filled/i.test(hint.textContent || ''))) {
      hint.style.display = 'none';
    }
  });
};

const installManualCategoryField = (section: HTMLElement, select: HTMLSelectElement, categoryLabel: HTMLLabelElement) => {
  categoryLabel.textContent = 'Product Category';
  const header = categoryLabel.parentElement;
  const autoFillButton = header?.querySelector<HTMLButtonElement>('button');
  if (autoFillButton && String(autoFillButton.textContent || '').includes('Auto Fill Again')) {
    autoFillButton.disabled = true;
    autoFillButton.style.display = 'none';
  }

  // Keep React's original select as the save source of truth, but make it invisible.
  // The one visible field below is typeable and uses all previously saved categories.
  Array.from(select.options).forEach((option) => {
    if (/^Auto:\s*/i.test(String(option.textContent || '').trim())) option.hidden = true;
  });
  select.style.display = 'none';
  select.tabIndex = -1;

  let field = section.querySelector<HTMLElement>(`.${MANUAL_CATEGORY_FIELD_CLASS}`);
  if (field) {
    const input = field.querySelector<HTMLInputElement>('input[type="text"]');
    const datalist = field.querySelector<HTMLDataListElement>('datalist');
    const status = field.querySelector<HTMLParagraphElement>('p');
    if (datalist) updateCategoryList(select, datalist);

    const productKey = findProductKey(section);
    if (input && status && productKey && field.dataset.productKey !== productKey) {
      field.dataset.productKey = productKey;
      window.setTimeout(() => syncManualFromSelect(section, select, input, status), 0);
    } else {
      queueManualCategoryEnforce(section, select);
    }
    return;
  }

  field = document.createElement('div');
  field.className = MANUAL_CATEGORY_FIELD_CLASS;
  field.dataset.productKey = findProductKey(section);

  const input = document.createElement('input');
  input.type = 'text';
  input.setAttribute('list', MANUAL_CATEGORY_LIST_ID);
  input.placeholder = 'Type or choose category';
  input.autocomplete = 'off';
  input.className = 'w-full bg-neutral-950 border border-neutral-700 focus:border-emerald-400 rounded-xl px-3 py-2 text-white';

  const datalist = document.createElement('datalist');
  datalist.id = MANUAL_CATEGORY_LIST_ID;
  updateCategoryList(select, datalist);

  const status = document.createElement('p');
  status.className = 'mt-1 text-[10px] text-neutral-500';
  status.textContent = 'Type or choose a saved category.';

  input.addEventListener('input', () => applyTypedCategory(section, select, input, status, false));
  input.addEventListener('change', () => applyTypedCategory(section, select, input, status, true));
  input.addEventListener('blur', () => applyTypedCategory(section, select, input, status, true));
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    applyTypedCategory(section, select, input, status, true);
  });

  // Old product-name auto code may still calculate tags. Keep the manual category
  // locked after those React events so product names can never replace it.
  const form = section.closest('form');
  const keepManualChoice = () => queueManualCategoryEnforce(section, select);
  form?.addEventListener('input', keepManualChoice);
  form?.addEventListener('change', keepManualChoice);
  form?.addEventListener('focusout', keepManualChoice);

  // Before Save, resolve the one visible field and push that category through the
  // existing React select. This makes Add and old saved-product Edit use the same
  // proven category_slug/category_id save path without touching other product logic.
  form?.addEventListener('submit', (event) => {
    if (!form || resubmittingForms.has(form)) {
      if (form) resubmittingForms.delete(form);
      return;
    }

    const match = resolveTypedCategory(select, input.value, true);
    if (!match) {
      event.preventDefault();
      event.stopPropagation();
      status.textContent = 'Choose a saved category before saving.';
      status.className = 'mt-1 text-[10px] font-bold text-amber-300';
      input.focus();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    manualCategoryBySection.set(section, match.value);
    setReactSelectValue(select, match.value, true);
    setFieldState(input, status, match);
    window.setTimeout(() => {
      if (!form.isConnected) return;
      resubmittingForms.add(form);
      form.requestSubmit();
    }, 0);
  }, true);

  field.append(input, datalist, status);
  select.insertAdjacentElement('afterend', field);
  syncManualFromSelect(section, select, input, status);
};

const scanForCategory = () => {
  removeAutoCategoryHints();
  const labels = Array.from(document.querySelectorAll<HTMLLabelElement>('label'));
  labels.forEach((label) => {
    const text = label.textContent?.trim();
    if (text !== 'Auto Category' && text !== 'Product Category' && text !== 'Product Category (Manual)') return;
    const header = label.parentElement;
    const section = header?.parentElement;
    if (!(section instanceof HTMLElement)) return;
    const select = section.querySelector<HTMLSelectElement>('select');
    if (!select) return;
    installManualCategoryField(section, select, label);
  });
};

let scanQueued = false;
const queueScan = () => {
  if (scanQueued) return;
  scanQueued = true;
  window.requestAnimationFrame(() => {
    scanQueued = false;
    scanForCategory();
  });
};

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', queueScan, { once: true });
  else queueScan();

  const observer = new MutationObserver(queueScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
