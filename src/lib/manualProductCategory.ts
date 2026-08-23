const MANUAL_CATEGORY_BOX_CLASS = 'ora-manual-product-category-box';
const MANUAL_CATEGORY_LIST_ID = 'ora-manual-product-category-list';

const normalizeCategoryText = (value: string) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

interface CategoryOptionRow {
  value: string;
  name: string;
  fullText: string;
}

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

const selectTypedCategory = (
  select: HTMLSelectElement,
  input: HTMLInputElement,
  status: HTMLParagraphElement,
  allowPartial = false,
) => {
  const query = normalizeCategoryText(input.value);
  if (!query) {
    status.textContent = 'Leave blank to keep Auto Category.';
    status.className = 'mt-1 text-[10px] text-neutral-500';
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

  setReactSelectValue(select, match.value);
  if (input.value !== match.name) input.value = match.name;
  status.textContent = `Manual category selected: ${match.name}`;
  status.className = 'mt-1 text-[10px] font-bold text-emerald-400';
};

const installManualCategoryInput = (section: HTMLElement, select: HTMLSelectElement) => {
  let box = section.querySelector<HTMLElement>(`.${MANUAL_CATEGORY_BOX_CLASS}`);
  if (box) {
    const datalist = box.querySelector<HTMLDataListElement>('datalist');
    if (datalist) updateCategoryList(select, datalist);
    return;
  }

  box = document.createElement('div');
  box.className = `${MANUAL_CATEGORY_BOX_CLASS} mt-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3`;

  const label = document.createElement('label');
  label.className = 'block text-[10px] font-bold text-amber-300 mb-1';
  label.textContent = 'Manual Category (if Auto is wrong)';

  const input = document.createElement('input');
  input.type = 'text';
  input.setAttribute('list', MANUAL_CATEGORY_LIST_ID);
  input.placeholder = 'Type the correct category name';
  input.autocomplete = 'off';
  input.className = 'w-full bg-neutral-950 border border-amber-500/30 focus:border-amber-400 rounded-xl px-3 py-2 text-white';

  const datalist = document.createElement('datalist');
  datalist.id = MANUAL_CATEGORY_LIST_ID;
  updateCategoryList(select, datalist);

  const status = document.createElement('p');
  status.className = 'mt-1 text-[10px] text-neutral-500';
  status.textContent = 'Leave blank to keep Auto Category. Type a saved category name to override it.';

  input.addEventListener('input', () => selectTypedCategory(select, input, status, false));
  input.addEventListener('change', () => selectTypedCategory(select, input, status, true));
  input.addEventListener('blur', () => selectTypedCategory(select, input, status, true));
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    selectTypedCategory(select, input, status, true);
  });

  box.append(label, input, datalist, status);
  select.insertAdjacentElement('afterend', box);
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
