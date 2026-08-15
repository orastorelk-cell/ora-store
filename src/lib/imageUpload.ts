export async function compressImageFile(file: File, maxDimension = 1280, maxBytes = 450_000): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) throw new Error('Please use JPG, PNG or WEBP images only.');
  if (file.size > 8 * 1024 * 1024) throw new Error('Image is too large. Please choose an image under 8 MB.');

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Image could not be read.'));
    reader.readAsDataURL(file);
  });

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image could not be decoded.'));
    img.src = dataUrl;
  });

  const initialScale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  let width = Math.max(1, Math.round(image.width * initialScale));
  let height = Math.max(1, Math.round(image.height * initialScale));
  let smallestResult = '';
  let smallestBytes = Number.POSITIVE_INFINITY;

  const bytes = (value: string) => Math.ceil((value.length - value.indexOf(',') - 1) * 0.75);

  // Try quality reduction first, then gently reduce dimensions. This keeps one
  // compact image per upload instead of storing a full-size original + thumbnail.
  for (let resizeAttempt = 0; resizeAttempt < 8; resizeAttempt += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Image processor unavailable.');
    ctx.drawImage(image, 0, 0, width, height);

    for (let quality = 0.82; quality >= 0.36; quality -= 0.07) {
      const result = canvas.toDataURL('image/jpeg', quality);
      const resultBytes = bytes(result);
      if (resultBytes < smallestBytes) {
        smallestResult = result;
        smallestBytes = resultBytes;
      }
      if (resultBytes <= maxBytes) return result;
    }

    if (width <= 320 && height <= 320) break;
    width = Math.max(320, Math.round(width * 0.82));
    height = Math.max(320, Math.round(height * 0.82));
  }

  if (smallestResult && smallestBytes <= maxBytes) return smallestResult;
  throw new Error(`Image could not be compressed below ${Math.round(maxBytes / 1000)} KB. Please choose a simpler or smaller image.`);
}

export async function uploadPublicImage(file: File | string, purpose: 'review' | 'product-request' | 'product' | 'branding' | 'payment-receipt'): Promise<string> {
  const dataUrl = typeof file === 'string' ? file : await compressImageFile(file);
  const response = await fetch('/api/uploads/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUrl, purpose }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || 'Image upload failed.');
  return String(data.url || '');
}

export async function uploadRawImageFile(
  file: File,
  purpose: 'branding',
  maxBytes = 700_000,
): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) throw new Error('Please use PNG, JPG or WEBP for logo images.');
  if (file.size > maxBytes) throw new Error(`Logo image is too large. Please use a file under ${Math.round(maxBytes / 1000)} KB.`);
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Image could not be read.'));
    reader.readAsDataURL(file);
  });
  return uploadPublicImage(dataUrl, purpose);
}
