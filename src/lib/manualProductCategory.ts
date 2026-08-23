const MANUAL_CATEGORY_BOX_CLASS = 'ora-manual-product-category-box';
const MANUAL_CATEGORY_LIST_ID = 'ora-manual-product-category-list';

const normalizeCategoryText = (value: string) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

interface CategoryOptionRow {
  value: string;
  name: string;
  fullText: string;
}

const manualCategoryBySection = new WeakMap<HTMLElement, string>();
const autoCategoryBySection = new WeakMap<HTMLElement, boolean>();

const savedCategoryOptions = (select: HTMLSelectElement): CategoryOptionRow[] =>
  Array.from(select.options)
    .map((option) => {
      const fullText = String(option.textContent || '').trim();
      const name = fullText.replace(/^Auto:\s*/i, '').split(' (')[0].trim();
      return { value: option.value, name, fullText };
    })
    .filter((row) => row.value && !/^Auto:\s*/i.test(row.fullText));

const setReactSelectValue = (select: HTMLSelectElement, value: string) => {
  if (select.value === value) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  if (setter) setter.call(select, value);
  else select.value = value;
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
};

const enforceManualCategory = (section: HTMLElement, select: HTMLSelectElement) => {
  if (autoCategoryBySection.get(section) !== false) return;
  const manualValue = manualCategoryBySection.get(section);
  if (!manualValue || !section.isConnected || !select.isConnected) return;
  if (select.value !== manualValue) setReactSelectValue(select, manualValue);
};

const queueManualCategoryEnforce = (section: HTMLElement, select: HTMLSelectElement) => {
  if (autoCategoryBySection.get(section) !== false || !manualCategoryBySection.has(section)) return;
  const run = () => enforceManualCategory(section, select);
  window.setTimeout(run, 0);
  window.requestAnimationFrame(() => {
    run();
    window.requestAnimationFrame(run);
  });
  window.setTimeout(run, 80);
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

const runExistingAutoFill = (section: HTMLElement) => {
  const button = Array.from(section.querySelectorAll<HTMLButtonElement>('button'))
    .find((candidate) => String(candidate.textContent || '').trim() === 'Auto Fill Again');
  button?.click();
};

const setCategoryMode = (
  section: HTMLElement,
  select: HTMLSelectElement,
  input: HTMLInputElement,
  status: HTMLParagraphElement,
  toggle: HTMLInputElement,
  autoOn: boolean,
  recalculate = false,
) => {
  autoCategoryBySection.set(section, autoOn);
  toggle.checked = autoOn;

  if (autoOn) {
    manualCategoryBySection.delete(section);
    input.value = '';
    input.disabled = true;
    select.disabled = true;
    status.textContent = 'AUTO CATEGORY ON — manual category is locked.';
    status.className = 'mt-1 text-[10px] font-bold text-emerald-400';
    if (recalculate) window.setTimeout(() => runExistingAutoFill(section), 0);
    return;
  }

  input.disabled = false;
  select.disabled = false;
  const current = findCurrentSavedCategory(select);
  if (current) {
    manualCategoryBySection.set(section, current.value);
    input.value = current.name;
    status.textContent = `MANUAL CATEGORY ON — locked: ${current.name}`;
    status.className = 'mt-1 text-[10px] font-bold text-amber-300';
  } else {
    manualCategoryBySection.delete(section);
    input.value = '';
    status.textContent = 'MANUAL CATEGORY ON — type or choose the correct saved category.';
    status.className = 'mt-1 text-[10px] font-bold text-amber-300';
  }
};

const selectTypedCategory = (
  section: HTMLElement,
  select: HTMLSelectElement,
  input: HTMLInputElement,
  status: HTMLParagraphElement,
  allowPartial = false,
) => {
  if (autoCategoryBySection.get(section) !== false) return;

  const query = normalizeCategoryText(input.value);
  if (!query) {
    manualCategoryBySection.delete(section);
    status.textContent = 'MANUAL CATEGORY ON — type or choose the correct saved category.';
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
  setReactSelectValue(select, match.value);
  queueManualCategoryEnforce(section, select);
  if (input.value !== match.name) input.value = match.name;
  status.textContent = `MANUAL CATEGORY ON — locked: ${match.name}`;
  status.className = 'mt-1 text-[10px] font-bold text-amber-300';
};

const installManualCategoryInput = (section: HTMLElement, select: HTMLSelectElement) => {
  let box = section.querySelector<HTMLElement>(`.${MANUAL_CATEGORY_BOX_CLASS}`);
  if (box) {
    const datalist = box.querySelector<HTMLDataListElement>('datalist');
    if (datalist) updateCategoryList(select, datalist);
    if (autoCategoryBySection.get(section) !== false) select.disabled = true;
    return;
  }

  box = document.createElement('div');
  box.className = `${MANUAL_CATEGORY_BOX_CLASS} mt-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3`;

  const modeRow = document.createElement('label');
  modeRow.className = 'mb-2 flex items-center justify-between gap-3 text-[10px] font-black text-emerald-300';

  const modeText = document.createElement('span');
  modeText.textContent = 'AUTO CATEGORY';

  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.checked = true;
  toggle.className = 'h-4 w-4 accent-emerald-500';
  toggle.title = 'Turn OFF to choose the category manually';

  modeRow.append(modeText, toggle);

  const label = document.createElement('label');
  label.className = 'block text-[10px] font-bold text-amber-300 mb-1';
  label.textContent = 'Manual Category';

  const input = document.createElement('input');
  input.type = 'text';
  input.setAttribute('list', MANUAL_CATEGORY_LIST_ID);
  input.placeholder = 'Turn Auto OFF, then type category';
  input.autocomplete = 'off';
  input.className = 'w-full bg-neutral-950 border border-amber-500/30 focus:border-amber-400 rounded-xl px-3 py-2 text-white disabled:cursor-not-allowed disabled:opacity-40';

  const datalist = document.createElement('datalist');
  datalist.id = MANUAL_CATEGORY_LIST_ID;
  updateCategoryList(select, datalist);

  const status = document.createElement('p');
  status.className = 'mt-1 text-[10px] font-bold text-emerald-400';
  status.textContent = 'AUTO CATEGORY ON — manual category is locked.';

  toggle.addEventListener('change', () => {
    setCategoryMode(section, select, input, status, toggle, toggle.checked, toggle.checked);
  });

  input.addEventListener('input', () => selectTypedCategory(section, select, input, status, false));
  input.addEventListener('change', () => selectTypedCategory(section, select, input, status, true));
  input.addEventListener('blur', () => selectTypedCategory(section, select, input, status, true));
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    selectTypedCategory(section, select, input, status, true);
  });

  // The existing React category dropdown remains the source of truth. In Manual
  // mode a direct dropdown selection is locked too, so this also works when an
  // older saved product is opened with Edit.
  select.addEventListener('change', (event) => {
    if (autoCategoryBySection.get(section) !== false || !event.isTrusted) return;
    const current = findCurrentSavedCategory(select);
    if (!current) return;
    manualCategoryBySection.set(section, current.value);
    input.value = current.name;
    status.textContent = `MANUAL CATEGORY ON — locked: ${current.name}`;
    status.className = 'mt-1 text-[10px] font-bold text-amber-300';
  });

  // Product-name auto-fill can still run inside React. When Auto is OFF, re-apply
  // only the explicit manual category after React finishes its normal name/tag work.
  // This leaves every unrelated product field and all existing save logic untouched.
  const form = section.closest('form');
  const keepManualChoice = () => queueManualCategoryEnforce(section, select);
  form?.addEventListener('input', keepManualChoice);
  form?.addEventListener('change', keepManualChoice);
  form?.addEventListener('focusout', keepManualChoice);

  box.append(modeRow, label, input, datalist, status);
  select.insertAdjacentElement('afterend', box);
  setCategoryMode(section, select, input, status, toggle, true, false);
};

const scanForAutoCategory = () => {
  const labels = Array.from(document.querySelectorAll<HTMLLabelElement>('label'));
  labels.forEach((label) => {
    if (label.textContent?.trim() !== 'Auto Category') return;
    const header = label.parentElement;
    const section = header?.parentElement;
    if (!(section instanceof HTMLElement)) return;
    const select = section.querySelector<HTMLSelectElement>('select');
    if (!select) return;
    installManualCategoryInput(section, select);
  });
};

let scanQueued = false;
const queueScan = () => {
  if (scanQueued) return;
  scanQueued = true;
  window.requestAnimationFrame(() => {
    scanQueued = false;
    scanForAutoCategory();
  });
};

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', queueScan, { once: true });
  else queueScan();

  const observer = new MutationObserver(queueScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
