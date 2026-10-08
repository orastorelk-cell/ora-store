import thumbnails from '../data/catalogThumbnails.json';

// The key is the original immutable URL. A newly uploaded or unknown image uses
// its original immediately; saved catalog records are never changed to previews.
export const catalogThumbnail = (source: string) => (thumbnails as Record<string, string>)[source] || source;
export const restoreOriginalImage = (image: HTMLImageElement, original: string) => {
  if (image.getAttribute('src') !== original) image.src = original;
};
