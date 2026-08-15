import { compressImageFile } from './imageUpload';

export interface ReceiptOcrResult {
  compressedDataUrl: string;
  text: string;
  confidence: number;
  receiptLike: boolean;
  accountMatch: boolean;
  amountMatch: boolean;
  detectedAmount?: number;
  detectedReference?: string;
  detectedBank?: string;
  notes: string;
}

type TesseractWorker = {
  recognize: (image: string) => Promise<{ data: { text?: string; confidence?: number } }>;
  terminate: () => Promise<void>;
};

type TesseractGlobal = {
  createWorker: (lang?: string) => Promise<TesseractWorker>;
};

declare global {
  interface Window {
    Tesseract?: TesseractGlobal;
  }
}

let tesseractLoader: Promise<TesseractGlobal> | null = null;

async function loadTesseract(): Promise<TesseractGlobal> {
  if (window.Tesseract) return window.Tesseract;
  if (tesseractLoader) return tesseractLoader;

  tesseractLoader = new Promise<TesseractGlobal>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-ora-tesseract="true"]');
    if (existing) {
      existing.addEventListener('load', () => window.Tesseract ? resolve(window.Tesseract) : reject(new Error('OCR library unavailable.')), { once: true });
      existing.addEventListener('error', () => reject(new Error('OCR library could not be loaded.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
    script.async = true;
    script.dataset.oraTesseract = 'true';
    script.onload = () => window.Tesseract ? resolve(window.Tesseract) : reject(new Error('OCR library unavailable.'));
    script.onerror = () => reject(new Error('OCR library could not be loaded.'));
    document.head.appendChild(script);
  });
  return tesseractLoader;
}

const normalizeDigits = (value: unknown) => String(value || '').replace(/\D/g, '');
const normalizeText = (value: unknown) => String(value || '').replace(/\s+/g, ' ').trim();

function extractNumberCandidates(text: string): number[] {
  const candidates: number[] = [];
  const regex = /(?:LKR|Rs\.?|Amount|Total|Paid)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text))) {
    const raw = String(match[1] || '').replace(/,/g, '');
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) candidates.push(value);
  }
  return candidates;
}

function extractReference(text: string): string | undefined {
  const patterns = [
    /(?:transaction|txn|reference|ref|trace|receipt)\s*(?:id|no|number|#|:|-)?\s*([A-Z0-9-]{6,})/i,
    /(?:id|ref)\s*[:#-]?\s*([A-Z0-9-]{8,})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

function extractBank(text: string): string | undefined {
  const known = [
    'Sampath', 'Commercial Bank', "People's Bank", 'Peoples Bank', 'Bank of Ceylon', 'BOC',
    'HNB', 'Hatton National Bank', 'NDB', 'NSB', 'DFCC', 'Seylan', 'Pan Asia', 'Nations Trust',
    'NTB', 'Cargills Bank', 'Amana Bank', 'Dialog Pay', 'Genie', 'FriMi', 'iPay',
  ];
  const lower = text.toLowerCase();
  return known.find((name) => lower.includes(name.toLowerCase()));
}

export async function analyzeReceiptLocally(
  file: File,
  expectedAccountNumber: string,
  expectedAmount: number,
): Promise<ReceiptOcrResult> {
  // Keep one compact image only. It is reused for OCR and the admin receipt preview.
  const compressedDataUrl = await compressImageFile(file, 1400, 320_000);
  const tesseract = await loadTesseract();
  const worker = await tesseract.createWorker('eng');
  try {
    const result = await worker.recognize(compressedDataUrl);
    const text = normalizeText(result.data.text || '');
    const confidence = Math.max(0, Math.min(100, Number(result.data.confidence || 0)));
    const lower = text.toLowerCase();

    const receiptKeywords = [
      'transfer', 'payment', 'transaction', 'reference', 'beneficiary', 'account',
      'amount', 'successful', 'success', 'completed', 'bank', 'lkr', 'rs', 'receipt', 'paid',
    ];
    const keywordHits = receiptKeywords.filter((word) => lower.includes(word)).length;
    const receiptLike = keywordHits >= 2 || (keywordHits >= 1 && confidence >= 45);

    const expectedDigits = normalizeDigits(expectedAccountNumber);
    const visibleDigits = normalizeDigits(text);
    const accountTail = expectedDigits.slice(-6);
    const accountMatch = Boolean(
      expectedDigits && (
        visibleDigits.includes(expectedDigits) ||
        (accountTail.length >= 6 && visibleDigits.includes(accountTail))
      )
    );

    const candidates = extractNumberCandidates(text);
    const expected = Number(expectedAmount || 0);
    let detectedAmount: number | undefined;
    let amountMatch = false;
    if (expected > 0 && candidates.length) {
      detectedAmount = candidates.reduce((best, current) =>
        Math.abs(current - expected) < Math.abs(best - expected) ? current : best
      );
      amountMatch = Math.abs(detectedAmount - expected) <= 1;
    }

    const detectedReference = extractReference(text);
    const detectedBank = extractBank(text);
    const notes: string[] = [];
    notes.push(receiptLike ? 'Receipt-like image detected.' : 'Receipt format could not be confidently identified.');
    notes.push(accountMatch ? 'Destination account matched.' : 'Destination account was not confirmed from OCR.');
    notes.push(amountMatch ? `Amount matched Rs. ${expected.toLocaleString()}.` : 'Expected amount was not confirmed from OCR.');
    notes.push('Final approval requires admin to confirm the money in the bank account.');

    return {
      compressedDataUrl,
      text,
      confidence,
      receiptLike,
      accountMatch,
      amountMatch,
      detectedAmount,
      detectedReference,
      detectedBank,
      notes: notes.join(' '),
    };
  } finally {
    await worker.terminate();
  }
}
