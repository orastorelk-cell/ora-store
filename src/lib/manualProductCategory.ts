const MANUAL_CATEGORY_BOX_CLASS = 'ora-manual-product-category-box';
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

const findCurrentSavedCategory = (select: HTMLSelectElement) =>
  savedCategoryOptions(select).find((row) => row.value === select.value);

const findProductKey = (section: HTMLElement) => {
  const form = section.closest('form');
  if (!form) return '';
  const skuLabel = Array.from(form.querySelectorAll<HTMLLabelElement>('label'))
    .find((label) => String(label.textContent || '').includes('Item Code / SKU'));
  const skuInput = skuLabel?.parentElement?.parentElement?.querySelector<HTMLInputElement>('input[type="text"]');
  return String(skuInput?.value || '').trim().toUpperCase();
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
    status.textContent = 'Select or type the correct saved category.';
    status.className = 'mt-1 text-[10px] font-bold text-amber-300';
    return;
  }
  manualCategoryBySection.set(section, current.value);
  input.value = current.name;
  status.textContent = `Manual category: ${current.name}`;
  status.className = 'mt-1 text-[10px] font-bold text-emerald-400';
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

const selectTypedCategory = (
  section: HTMLElement,
  select: HTMLSelectElement,
  input: HTMLInputElement,
  status: HTMLParagraphElement,
  allowPartial = false,
) => {
  const query = normalizeCategoryText(input.value);
  if (!query) {
    status.textContent = 'Select or type the correct saved category.';
    status.className = 'mt-1 text-[10px] font-bold text-amber-300';
    return;
  }

  const rows = savedCategoryOptions(select);
  let match = rows.find((row) =>
    normalizeCategoryText(row.name) === query ||
    normalizeCategoryText(row.fullText) === query ||
    normalizeCategoryText(row.value) === query
  );

  if (!match && allowPartial) {
    const matches = rows.filter((row) =>
      normalizeCategoryText(row.name).includes(query) ||
      normalizeCategoryText(row.value).includes(query)
    );
    if (matches.length === 1) match = matches[0];
  }

  if (!match) {
    status.textContent = 'Type a saved category name from the suggestions.';
    status.className = 'mt-1 text-[10px] text-amber-300';
    return;
  }

  manualCategoryBySection.set(section, match.value);
  setReactSelectValue(select, match.value, true);
  queueManualCategoryEnforce(section, select);
  if (input.value !== match.name) input.value = match.name;
  status.textContent = `Manual category: ${match.name}`;
  status.className = 'mt-1 text-[10px] font-bold text-emerald-400';
};

const installManualCategoryInput = (section: HTMLElement, select: HTMLSelectElement, autoLabel: HTMLLabelElement) => {
  let box = section.querySelector<HTMLElement>(`.${MANUAL_CATEGORY_BOX_CLASS}`);
  if (box) {
    const datalist = box.querySelector<HTMLDataListElement>('datalist');
    const input = box.querySelector<HTMLInputElement>('input[type="text"]');
    const status = box.querySelector<HTMLParagraphElement>('p');
    if (datalist) updateCategoryList(select, datalist);

    const productKey = findProductKey(section);
    if (input && status && productKey && box.dataset.productKey !== productKey) {
      box.dataset.productKey = productKey;
      window.setTimeout(() => syncManualFromSelect(section, select, input, status), 0);
    } else {
      queueManualCategoryEnforce(section, select);
    }
    return;
  }

  // Auto category is intentionally disabled. The existing React category dropdown
  // remains the source of truth so Add and Edit use the same proven save path.
  autoLabel.textContent = 'Product Category (Manual)';
  const header = autoLabel.parentElement;
  const autoFillButton = header?.querySelector<HTMLButtonElement>('button');
  if (autoFillButton && String(autoFillButton.textContent || '').includes('Auto Fill Again')) {
    autoFillButton.disabled = true;
    autoFillButton.style.display = 'none';
  }

  Array.from(select.options).forEach((option) => {
    if (/^Auto:\s*/i.test(String(option.textContent || '').trim())) option.hidden = true;
  });
  select.disabled = false;

  box = document.createElement('div');
  box.className = `${MANUAL_CATEGORY_BOX_CLASS} mt-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3`;
  box.dataset.productKey = findProductKey(section);

  const label = document.createElement('label');
  label.className = 'block text-[10px] font-bold text-amber-300 mb-1';
  label.textContent = 'Manual Category';

  const input = document.createElement('input');
  input.type = 'text';
  input.setAttribute('list', MANUAL_CATEGORY_LIST_ID);
  input.placeholder = 'Type the correct saved category';
  input.autocomplete = 'off';
  input.className = 'w-full bg-neutral-950 border border-amber-500/30 focus:border-amber-400 rounded-xl px-3 py-2 text-white';

  const datalist = document.createElement('datalist');
  datalist.id = MANUAL_CATEGORY_LIST_ID;
  updateCategoryList(select, datalist);

  const status = document.createElement('p');
  status.className = 'mt-1 text-[10px] font-bold text-amber-300';
  status.textContent = 'Select or type the correct saved category.';

  input.addEventListener('input', () => selectTypedCategory(section, select, input, status, false));
  input.addEventListener('change', () => selectTypedCategory(section, select, input, status, true));
  input.addEventListener('blur', () => selectTypedCategory(section, select, input, status, true));
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    selectTypedCategory(section, select, input, status, true);
  });

  // Native dropdown selection is preferred because React receives the user's
  // trusted change directly. This works for both new products and old saved edits.
  select.addEventListener('change', (event) => {
    if (!event.isTrusted) return;
    const current = findCurrentSavedCategory(select);
    if (!current) return;
    manualCategoryBySection.set(section, current.value);
    input.value = current.name;
    status.textContent = `Manual category: ${current.name}`;
    status.className = 'mt-1 text-[10px] font-bold text-emerald-400';
  });

  // Product-name auto logic may still run elsewhere in the old form. Keep only the
  // explicit manual category after those events, without touching tags or any other field.
  const form = section.closest('form');
  const keepManualChoice = () => queueManualCategoryEnforce(section, select);
  form?.addEventListener('input', keepManualChoice);
  form?.addEventListener('change', keepManualChoice);
  form?.addEventListener('focusout', keepManualChoice);

  // Before Save, push the locked manual value through the native React select once
  // and submit on the next tick. This prevents stale category state on older products.
  form?.addEventListener('submit', (event) => {
    if (!form || resubmittingForms.has(form)) {
      if (form) resubmittingForms.delete(form);
      return;
    }
    const manualValue = manualCategoryBySection.get(section);
    if (!manualValue) return;
    event.preventDefault();
    event.stopPropagation();
    setReactSelectValue(select, manualValue, true);
    window.setTimeout(() => {
      if (!form.isConnected) return;
      resubmittingForms.add(form);
      form.requestSubmit();
    }, 0);
  }, true);

  box.append(label, input, datalist, status);
  select.insertAdjacentElement('afterend', box);
  syncManualFromSelect(section, select, input, status);
};

const scanForCategory = () => {
  const labels = Array.from(document.querySelectorAll<HTMLLabelElement>('label'));
  labels.forEach((label) => {
    const text = label.textContent?.trim();
    if (text !== 'Auto Category' && text !== 'Product Category (Manual)') return;
    const header = label.parentElement;
    const section = header?.parentElement;
    if (!(section instanceof HTMLElement)) return;
    const select = section.querySelector<HTMLSelectElement>('select');
    if (!select) return;
    installManualCategoryInput(section, select, label);
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
