export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseCsv(text: string): ParsedCsv {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  const pushField = () => {
    row.push(field.trim());
    field = '';
  };
  const pushRow = () => {
    pushField();
    if (row.some((cell) => cell.length > 0)) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      pushField();
    } else if (ch === '\n') {
      pushRow();
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field.length || row.length) pushRow();
  if (!rows.length) return { headers: [], rows: [] };

  const headers = rows[0].map((h, i) => String(h || `Column ${i + 1}`).trim());
  const objects = rows.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    headers.forEach((header, i) => { obj[header] = String(cells[i] || '').trim(); });
    return obj;
  });
  return { headers, rows: objects };
}

export function autoMapHeader(headers: string[], needles: string[]): string {
  const lower = headers.map((h) => ({ original: h, value: h.toLowerCase().replace(/[_-]+/g, ' ') }));
  for (const needle of needles) {
    const n = needle.toLowerCase();
    const exact = lower.find((h) => h.value === n);
    if (exact) return exact.original;
  }
  for (const needle of needles) {
    const n = needle.toLowerCase();
    const partial = lower.find((h) => h.value.includes(n));
    if (partial) return partial.original;
  }
  return '';
}

export function toNumber(value: unknown): number {
  const cleaned = String(value ?? '').replace(/[^0-9.-]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export function parseFlexibleDate(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  // Sri Lanka/Fardar-style slash dates are treated as DD/MM/YYYY.
  // ISO dates and textual dates still use the browser parser below.
  const m = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = Number(m[3]);
    const parsed = new Date(year, month - 1, day);
    if (parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day) return parsed.toISOString();
  }
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();
  return '';
}

export function downloadCsv(fileName: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const text = String(v ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const csv = rows.map((r) => r.map(esc).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
