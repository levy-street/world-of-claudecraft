// Clicking a wiki picture (an attack snapshot, an info-box image, page art) opens it
// larger in a modal dialog. Escape, the close button or a click anywhere closes it.

const ZOOMABLE = 'img.attack-shot, .wiki-box-art img, .wiki-prose img.woc-page-art';

/** The caption for a picture: the attack it shows, or the article it heads. */
export function imageCaption(img, pageTitle) {
  const card = img.closest('.mechanic-card');
  const name = card?.querySelector('.mechanic-name')?.textContent;
  if (name) return name;
  const line = img.closest('li')?.textContent.trim().split('. ')[0];
  return line || pageTitle || '';
}

export function mountImageViewer(view, titleOf = () => document.title) {
  let dialog = null;
  function open(img) {
    const src = img.currentSrc || img.src || img.dataset.gameArt;
    if (!src) return;
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.className = 'image-viewer';
      dialog.setAttribute('aria-label', 'Image viewer');
      dialog.innerHTML =
        '<button type="button" class="image-viewer-close" aria-label="Close">&#215;</button>' +
        '<figure><img alt=""><figcaption></figcaption></figure>';
      dialog.addEventListener('click', () => dialog.close());
      document.body.append(dialog);
    }
    const big = dialog.querySelector('figure img');
    const caption = imageCaption(img, titleOf());
    big.src = src;
    big.alt = caption;
    dialog.querySelector('figcaption').textContent = caption;
    dialog.showModal();
  }
  view.addEventListener('click', (event) => {
    const img = event.target.closest?.(ZOOMABLE);
    if (!img || !view.contains(img)) return;
    event.preventDefault();
    open(img);
  });
  // Keyboard readers reach the pictures too.
  view.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const img = event.target.closest?.(ZOOMABLE);
    if (!img) return;
    event.preventDefault();
    open(img);
  });
  return { open };
}

/** Make every zoomable picture in a freshly rendered article reachable by keyboard. */
export function markZoomable(view) {
  for (const img of view.querySelectorAll(ZOOMABLE)) {
    img.tabIndex = 0;
    img.setAttribute('role', 'button');
    if (!img.getAttribute('aria-label')) img.setAttribute('aria-label', 'Open larger image');
  }
}
