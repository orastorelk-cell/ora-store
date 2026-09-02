import type { Category, Product, ProductVariant } from '../types';
import { createProductBackup } from './productBackup';

export interface ProductFolderZipProgress {
  completed: number;
  total: number;
  current: string;
  failedImages: number;
}

export interface ProductFolderZipResult {
  productCount: number;
  savedImages: number;
  failedImages: number;
  fileName: string;
  sizeBytes: number;
}

export interface ProductFolderZipOptions {
  includeCatalogFiles?: boolean;
  referenceProducts?: Product[];
  fileNamePrefix?: string;
}

interface ZipFileMeta {
  nameBytes: Uint8Array;
  crc: number;
  size: number;
  localOffset: number;
  dosTime: number;
  dosDate: number;
}

const encoder = new TextEncoder();

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const dosDateTime = (input = new Date()) => {
  const year = Math.max(1980, input.getFullYear());
  return {
    dosTime: ((input.getHours() & 0x1f) << 11)
      | ((input.getMinutes() & 0x3f) << 5)
      | ((Math.floor(input.getSeconds() / 2)) & 0x1f),
    dosDate: (((year - 1980) & 0x7f) << 9)
      | (((input.getMonth() + 1) & 0x0f) << 5)
      | (input.getDate() & 0x1f),
  };
};

class StoreOnlyZip {
  private localChunks: BlobPart[] = [];
  private centralRecords: Uint8Array[] = [];
  private localOffset = 0;
  private entryCount = 0;

  addFile(name: string, data: Uint8Array, modifiedAt = new Date()) {
    if (this.entryCount >= 65_535) throw new Error('ZIP contains too many files.');
    if (data.byteLength > 0xffffffff) throw new Error(`File is too large for ZIP: ${name}`);

    const normalizedName = name.replace(/\\/g, '/').replace(/^\/+/, '');
    const nameBytes = encoder.encode(normalizedName);
    if (nameBytes.byteLength > 65_535) throw new Error('ZIP file name is too long.');

    const crc = crc32(data);
    const { dosTime, dosDate } = dosDateTime(modifiedAt);
    const meta: ZipFileMeta = {
      nameBytes,
      crc,
      size: data.byteLength,
      localOffset: this.localOffset,
      dosTime,
      dosDate,
    };

    const localHeader = new Uint8Array(30 + nameBytes.byteLength);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, dosTime, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, meta.size, true);
    localView.setUint32(22, meta.size, true);
    localView.setUint16(26, nameBytes.byteLength, true);
    localView.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    this.localChunks.push(localHeader as unknown as BlobPart, data as unknown as BlobPart);
    this.localOffset += localHeader.byteLength + data.byteLength;

    const centralHeader = new Uint8Array(46 + nameBytes.byteLength);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, dosTime, true);
    centralView.setUint16(14, dosDate, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, meta.size, true);
    centralView.setUint32(24, meta.size, true);
    centralView.setUint16(28, nameBytes.byteLength, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, meta.localOffset, true);
    centralHeader.set(nameBytes, 46);

    this.centralRecords.push(centralHeader);
    this.entryCount += 1;
  }

  addText(name: string, text: string) {
    this.addFile(name, encoder.encode(text));
  }

  build() {
    const centralOffset = this.localOffset;
    let centralSize = 0;
    const centralChunks: BlobPart[] = [];

    for (const record of this.centralRecords) {
      centralChunks.push(record as unknown as BlobPart);
      centralSize += record.byteLength;
    }

    if (centralOffset > 0xffffffff || centralSize > 0xffffffff) {
      throw new Error('ZIP is larger than the supported 4 GB limit.');
    }

    const end = new Uint8Array(22);
    const view = new DataView(end.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(4, 0, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, this.entryCount, true);
    view.setUint16(10, this.entryCount, true);
    view.setUint32(12, centralSize, true);
    view.setUint32(16, centralOffset, true);
    view.setUint16(20, 0, true);

    return new Blob(
      [...this.localChunks, ...centralChunks, end as unknown as BlobPart],
      { type: 'application/zip' },
    );
  }
}

const safeSegment = (value: unknown, fallback: string) => {
  const cleaned = String(value ?? '')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/[. ]+$/g, '')
    .replace(/\s+/g, ' ');
  return cleaned || fallback;
};

const yesNo = (value: unknown) => value === true ? 'Yes' : value === false ? 'No' : '';

const printable = (value: unknown) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return yesNo(value);
  return String(value);
};

const imageExtension = (source: string, contentType?: string | null) => {
  const mime = String(contentType || '').toLowerCase().split(';')[0].trim();
  const byMime: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
  };
  if (byMime[mime]) return byMime[mime];

  try {
    const pathname = new URL(source, window.location.href).pathname;
    const match = pathname.match(/\.([a-z0-9]{2,5})$/i);
    if (match && /^(jpe?g|png|webp|gif|avif|svg|bmp)$/i.test(match[1])) {
      return match[1].toLowerCase().replace('jpeg', 'jpg');
    }
  } catch {}

  return 'img';
};

const dataUrlBytes = (source: string) => {
  const match = source.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) throw new Error('Invalid data image URL.');
  const mime = match[1] || '';
  const payload = match[3] || '';

  if (match[2]) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return { bytes, contentType: mime };
  }

  return { bytes: encoder.encode(decodeURIComponent(payload)), contentType: mime };
};

const fetchImageBytes = async (source: string) => {
  if (source.startsWith('data:')) return dataUrlBytes(source);

  const url = new URL(source, window.location.href);
  const sameOrigin = url.origin === window.location.origin;
  const response = await fetch(url.toString(), {
    credentials: sameOrigin ? 'same-origin' : 'omit',
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') || '',
  };
};

const categoryLabel = (product: Product, categories: Category[]) => {
  const category = categories.find((item) => item.id === product.category_id)
    || categories.find((item) => item.slug === product.category_slug);
  if (!category) return product.category_slug || product.category_id || '';
  return [category.name_en, category.name_si].filter(Boolean).join(' / ');
};

const buildVariantLines = (variant: ProductVariant, index: number) => {
  const lines = [
    `Variant ${index + 1}`,
    `  Item Code: ${printable(variant.sku)}`,
    `  Option Name: ${printable(variant.option_name)}`,
    `  Option Value: ${printable(variant.option_value)}`,
    `  Buying Price: ${printable(variant.buying_price)}`,
    `  Selling Price: ${printable(variant.selling_price)}`,
    `  Discount Price: ${printable(variant.discount_price)}`,
    `  Discount Enabled: ${printable(variant.discount_enabled)}`,
    `  Offer Buying Price: ${printable(variant.offer_buying_price)}`,
    `  Supplier Offer Enabled: ${printable(variant.supplier_offer_enabled)}`,
    `  Supplier Offer Saved At: ${printable(variant.supplier_offer_saved_at)}`,
    `  Auto Price Enabled: ${printable(variant.auto_price_enabled)}`,
    `  Auto Discount On Cost Drop: ${printable(variant.auto_discount_on_cost_drop)}`,
    `  Stock Quantity: ${printable(variant.stock_quantity)}`,
    `  Status: ${printable(variant.status)}`,
    `  Force Out Of Stock: ${printable(variant.force_out_of_stock)}`,
    `  Image Source: ${printable(variant.image)}`,
  ];

  if ((variant.options || []).length) {
    lines.push('  Options:');
    for (const option of variant.options || []) {
      lines.push(`    • ${option.name}: ${option.value}`);
    }
  }

  if ((variant.price_history || []).length) {
    lines.push('  Price History:');
    for (const history of variant.price_history || []) {
      lines.push(`    • ${history.changed_at || ''} | ${history.reason || ''} | Buy ${history.buying_price} | Sell ${history.selling_price} | Discount ${history.discount_price ?? ''} | Enabled ${yesNo(history.discount_enabled)}`);
    }
  }

  return lines;
};

const buildDetailsText = (product: Product, categories: Category[], products: Product[]) => {
  const lines: string[] = [
    'O-RA STORE PRODUCT DETAILS',
    '===========================',
    '',
    `Item Code: ${printable(product.sku)}`,
    `Product Name: ${printable(product.name_en)}`,
    `Sinhala Product Name: ${printable(product.name_si)}`,
    `Category: ${categoryLabel(product, categories)}`,
    `Category ID: ${printable(product.category_id)}`,
    `Category Slug: ${printable(product.category_slug)}`,
    `Product Type: ${printable(product.product_type || 'normal')}`,
    `Status: ${printable(product.status)}`,
    `Force Out Of Stock: ${printable(product.force_out_of_stock)}`,
    `Stock Quantity: ${printable(product.stock_quantity)}`,
    `Brand: ${printable(product.brand)}`,
    `Search Keywords: ${printable(product.search_keywords)}`,
    `Source Shop Name: ${printable(product.source_shop_name)}`,
    `Source Shop Price: ${printable(product.source_shop_price)}`,
    `Buying Price: ${printable(product.buying_price)}`,
    `Selling Price: ${printable(product.selling_price)}`,
    `Discount Price: ${printable(product.discount_price)}`,
    `Discount Enabled: ${printable(product.discount_enabled)}`,
    `Offer Buying Price: ${printable(product.offer_buying_price)}`,
    `Supplier Offer Enabled: ${printable(product.supplier_offer_enabled)}`,
    `Supplier Offer Saved At: ${printable(product.supplier_offer_saved_at)}`,
    `Auto Price Enabled: ${printable(product.auto_price_enabled)}`,
    `Auto Discount On Cost Drop: ${printable(product.auto_discount_on_cost_drop)}`,
    `Bundle Auto Price: ${printable(product.bundle_auto_price)}`,
    `Bundle Discount Amount: ${printable(product.bundle_discount_amount)}`,
    `Featured: ${printable(product.is_featured)}`,
    `Latest: ${printable(product.is_latest)}`,
    `Test Product: ${printable(product.is_test_product)}`,
    `Created At: ${printable(product.created_at)}`,
    '',
    'DESCRIPTION - ENGLISH',
    '---------------------',
    product.description_en || '',
    '',
    'DESCRIPTION - SINHALA',
    '---------------------',
    product.description_si || '',
    '',
    'SIZE / MEASUREMENT DETAILS',
    '--------------------------',
  ];

  if ((product.specifications || []).length) {
    for (const item of product.specifications || []) {
      lines.push(`• ${item.label}: ${item.value}${item.unit ? ` ${item.unit}` : ''}`);
    }
  } else {
    lines.push('(none)');
  }

  lines.push('', 'ITEM DETAILS', '------------');
  if ((product.item_details || []).length) {
    for (const item of product.item_details || []) {
      lines.push(`• ${item.label_en}: ${item.value_en}`);
      if (item.label_si || item.value_si) {
        lines.push(`  Sinhala: ${item.label_si || item.label_en}: ${item.value_si || ''}`);
      }
    }
  } else {
    lines.push('(none)');
  }

  lines.push('', 'PRODUCT IMAGE SOURCES', '---------------------');
  if ((product.images || []).length) {
    (product.images || []).forEach((image, index) => lines.push(`• Image ${index + 1}: ${image}`));
  } else {
    lines.push('(none)');
  }

  lines.push('', 'VARIANTS', '--------');
  if ((product.variants || []).length) {
    (product.variants || []).forEach((variant, index) => {
      lines.push(...buildVariantLines(variant, index), '');
    });
  } else {
    lines.push('(none)');
  }

  lines.push('', 'BUNDLE COMPONENTS', '-----------------');
  if ((product.bundle_components || []).length) {
    for (const component of product.bundle_components || []) {
      const child = products.find((candidate) => candidate.id === component.product_id);
      const variant = child?.variants?.find((candidate) => candidate.id === component.variant_id);
      lines.push(
        `• ${variant?.sku || child?.sku || component.product_id} | ${child?.name_en || 'Unknown Product'} | Qty ${component.quantity}`
      );
    }
  } else {
    lines.push('(none)');
  }

  lines.push('', 'PRICE HISTORY', '-------------');
  if ((product.price_history || []).length) {
    for (const history of product.price_history || []) {
      lines.push(`• ${history.changed_at || ''} | ${history.reason || ''} | Buy ${history.buying_price} | Sell ${history.selling_price} | Discount ${history.discount_price ?? ''} | Enabled ${yesNo(history.discount_enabled)}`);
    }
  } else {
    lines.push('(none)');
  }

  lines.push(
    '',
    'NOTE',
    '----',
    'SYSTEM-DATA.json in this same folder contains the exact complete product record saved in the O-RA Store system at export time.',
    '',
  );

  return lines.join('\r\n');
};

const triggerDownload = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
};

export const downloadProductFoldersZip = async (
  products: Product[],
  categories: Category[],
  onProgress?: (progress: ProductFolderZipProgress) => void,
  options: ProductFolderZipOptions = {},
): Promise<ProductFolderZipResult> => {
  if (!products.length) throw new Error('There are no products to export.');

  const zip = new StoreOnlyZip();
  const backup = createProductBackup(products, categories);
  const includeCatalogFiles = options.includeCatalogFiles !== false;
  const referenceProducts = options.referenceProducts || products;
  const failed: string[] = [];
  let savedImages = 0;

  const imageJobs = products.reduce(
    (sum, product) => sum + (product.images || []).length + (product.variants || []).filter((variant) => Boolean(variant.image)).length,
    0,
  );
  const total = products.length + imageJobs;
  let completed = 0;

  const updateProgress = (current: string) => {
    onProgress?.({
      completed,
      total,
      current,
      failedImages: failed.length,
    });
  };

  if (includeCatalogFiles) {
    zip.addText(
      '_README.txt',
      [
        'O-RA STORE PRODUCT FOLDER EXPORT',
        '================================',
        '',
        'Each top-level product folder is named with the current Item Code (SKU).',
        'Inside every product folder:',
        '• DETAILS.txt = readable product details from the system',
        '• SYSTEM-DATA.json = exact complete product record from the system',
        '• product images = downloaded copies of all saved product image references',
        '• variant images = downloaded with VARIANT-<item-code> file names when available',
        '',
        'The root O-RA-Products-Backup.json is the normal O-RA catalog backup and can be kept as an additional safety copy.',
        '',
        `Exported At: ${backup.exported_at}`,
        `Products: ${products.length}`,
        `Categories: ${categories.length}`,
      ].join('\r\n'),
    );
    zip.addText('O-RA-Products-Backup.json', JSON.stringify(backup, null, 2));
    zip.addText('CATEGORIES.json', JSON.stringify(categories, null, 2));
  }

  const indexLines = [
    'O-RA STORE PRODUCT INDEX',
    '========================',
    '',
    `Exported At: ${backup.exported_at}`,
    '',
  ];

  for (let productIndex = 0; productIndex < products.length; productIndex += 1) {
    const product = products[productIndex];
    const folder = safeSegment(product.sku, `NO-CODE-${productIndex + 1}`);
    const base = `${folder}/`;

    zip.addText(`${base}DETAILS.txt`, buildDetailsText(product, categories, referenceProducts));
    zip.addText(`${base}SYSTEM-DATA.json`, JSON.stringify(product, null, 2));
    indexLines.push(`${folder} | ${product.name_en || ''} | ${product.product_type || 'normal'} | ${product.status || ''}`);

    completed += 1;
    updateProgress(`${product.sku} details`);

    for (let imageIndex = 0; imageIndex < (product.images || []).length; imageIndex += 1) {
      const source = product.images[imageIndex];
      try {
        updateProgress(`${product.sku} image ${imageIndex + 1}`);
        const { bytes, contentType } = await fetchImageBytes(source);
        const ext = imageExtension(source, contentType);
        zip.addFile(`${base}${String(imageIndex + 1).padStart(2, '0')}.${ext}`, bytes);
        savedImages += 1;
      } catch (error:any) {
        const message = `${product.sku} | Product image ${imageIndex + 1} | ${source} | ${error?.message || 'Download failed'}`;
        failed.push(message);
        zip.addText(
          `${base}FAILED-IMAGE-${String(imageIndex + 1).padStart(2, '0')}.txt`,
          `Image could not be copied into the ZIP.\r\nSource: ${source}\r\nError: ${error?.message || 'Download failed'}\r\n`,
        );
      } finally {
        completed += 1;
        updateProgress(`${product.sku} image ${imageIndex + 1}`);
      }
    }

    for (let variantIndex = 0; variantIndex < (product.variants || []).length; variantIndex += 1) {
      const variant = product.variants?.[variantIndex];
      if (!variant?.image) continue;
      const source = variant.image;
      const variantSku = safeSegment(variant.sku, `VARIANT-${variantIndex + 1}`);
      try {
        updateProgress(`${product.sku} variant ${variantSku}`);
        const { bytes, contentType } = await fetchImageBytes(source);
        const ext = imageExtension(source, contentType);
        zip.addFile(`${base}VARIANT-${variantSku}.${ext}`, bytes);
        savedImages += 1;
      } catch (error:any) {
        const message = `${product.sku} | Variant ${variant.sku} | ${source} | ${error?.message || 'Download failed'}`;
        failed.push(message);
        zip.addText(
          `${base}FAILED-VARIANT-IMAGE-${variantSku}.txt`,
          `Variant image could not be copied into the ZIP.\r\nVariant Item Code: ${variant.sku}\r\nSource: ${source}\r\nError: ${error?.message || 'Download failed'}\r\n`,
        );
      } finally {
        completed += 1;
        updateProgress(`${product.sku} variant ${variantSku}`);
      }
    }
  }

  if (includeCatalogFiles) {
    zip.addText('_PRODUCT-INDEX.txt', indexLines.join('\r\n'));
    if (failed.length) {
      zip.addText(
        '_IMAGE-DOWNLOAD-FAILURES.txt',
        [
          'Some image files could not be downloaded while the ZIP was being created.',
          'Their original system URLs are preserved below and inside the affected product folders.',
          '',
          ...failed,
        ].join('\r\n'),
      );
    }
  }

  updateProgress('Creating ZIP file');
  const blob = zip.build();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const prefix = safeSegment(options.fileNamePrefix || 'O-RA-Product-Folders', 'O-RA-Product-Folders');
  const fileName = `${prefix}-${timestamp}.zip`;
  triggerDownload(blob, fileName);

  return {
    productCount: products.length,
    savedImages,
    failedImages: failed.length,
    fileName,
    sizeBytes: blob.size,
  };
};
