// Shared presentation seam for painted class/family/status crests in ordinary
// <img> consumers. A worker-warmed procedural crest paints underneath when
// available, and becomes src if the committed WebP fails, so blocked/missing
// assets never regress to an empty portrait or status chip.

import { cachedProceduralIconDataUrl, iconDataUrl, proceduralIconDataUrl } from './icons';

const FALLBACK_ID_ATTR = 'data-crest-fallback-id';
const FALLBACK_SIZE_ATTR = 'data-crest-fallback-size';
const FALLBACK_DECORATIVE_ATTR = 'data-crest-fallback-decorative';
const FALLBACK_SELECTOR = `img[${FALLBACK_ID_ATTR}][${FALLBACK_SIZE_ATTR}]`;
const FALLBACK_CLASS = 'crest-image-fallback';
const armedImages = new WeakSet<HTMLImageElement>();

function assertCrestId(id: string): void {
  if (!/^[a-z0-9_]+$/.test(id)) throw new Error(`unsafe crest fallback id: ${id}`);
}

export interface CrestImageFallbackOptions {
  /** Clear the subject alt if an error replaces it with an adjacent-label decorative crest. */
  decorative?: boolean;
}

/** HTML attributes for a trusted, closed crest id. Hydrate after mounting. */
export function crestImageFallbackAttributes(
  id: string,
  size: number,
  opts: CrestImageFallbackOptions = {},
): string {
  assertCrestId(id);
  if (!Number.isInteger(size) || size <= 0) throw new Error(`invalid crest fallback size: ${size}`);
  const decorative = opts.decorative ? ` ${FALLBACK_DECORATIVE_ATTR}="true"` : '';
  return `${FALLBACK_ID_ATTR}="${id}" ${FALLBACK_SIZE_ATTR}="${size}"${decorative}`;
}

function armCrestImage(img: HTMLImageElement): void {
  const id = img.getAttribute(FALLBACK_ID_ATTR);
  const rawSize = img.getAttribute(FALLBACK_SIZE_ATTR);
  if (!id || !rawSize) return;
  const size = Number(rawSize);
  assertCrestId(id);
  if (!Number.isInteger(size) || size <= 0) return;

  const warmedFallback = cachedProceduralIconDataUrl('crest', id, size);
  if (warmedFallback) {
    img.classList.add(FALLBACK_CLASS);
    img.style.backgroundImage = `url("${warmedFallback}")`;
  } else {
    img.classList.remove(FALLBACK_CLASS);
    img.style.removeProperty('background-image');
  }

  const useFallback = (): void => {
    const currentId = img.getAttribute(FALLBACK_ID_ATTR);
    const currentSize = Number(img.getAttribute(FALLBACK_SIZE_ATTR));
    if (!currentId || !Number.isInteger(currentSize) || currentSize <= 0) return;
    const currentFallback = proceduralIconDataUrl('crest', currentId, currentSize);
    if (img.getAttribute(FALLBACK_DECORATIVE_ATTR) === 'true') img.alt = '';
    if (img.src !== currentFallback) img.src = currentFallback;
  };

  if (!armedImages.has(img)) {
    armedImages.add(img);
    img.addEventListener('error', useFallback);
  }

  if (img.complete && img.naturalWidth === 0) useFallback();
}

/** Arm every marked crest image under a newly mounted HTML subtree. */
export function hydrateCrestImageFallbacks(root: ParentNode): void {
  root.querySelectorAll<HTMLImageElement>(FALLBACK_SELECTOR).forEach(armCrestImage);
}

/** Remove a crest layer before an image upgrades to non-crest portrait art. */
export function clearCrestImageFallback(img: HTMLImageElement): void {
  img.removeAttribute(FALLBACK_ID_ATTR);
  img.removeAttribute(FALLBACK_SIZE_ATTR);
  img.removeAttribute(FALLBACK_DECORATIVE_ATTR);
  img.classList.remove(FALLBACK_CLASS);
  img.style.removeProperty('background-image');
}

/** Assign a painted crest plus its procedural loading/error layer to a live image. */
export function setCrestImageWithFallback(img: HTMLImageElement, id: string, size: number): void {
  img.setAttribute(FALLBACK_ID_ATTR, id);
  img.setAttribute(FALLBACK_SIZE_ATTR, String(size));
  img.removeAttribute(FALLBACK_DECORATIVE_ATTR);
  img.src = iconDataUrl('crest', id, size);
  armCrestImage(img);
}
