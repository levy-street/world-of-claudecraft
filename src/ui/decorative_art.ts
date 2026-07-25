// Shared builder for the decorative painted-art <img> the chrome surfaces
// inject beside localized copy (the celebration banner, chat log lines, and
// the quest attunement preview). Decorative is a contract, not a style:
// empty alt plus aria-hidden keep the art invisible to assistive tech so the
// surface's announced text stays exactly the localized line, and dragging is
// disabled so the art never ghosts out of the chrome. Callers own placement
// and sizing (via the class they pass); this module owns only the a11y shape,
// so the three surfaces cannot drift apart on it.

/** One decorative art img: `alt=""`, `aria-hidden`, drag-disabled. */
export function decorativeArtImg(doc: Document, className: string, src: string): HTMLImageElement {
  const img = doc.createElement('img');
  img.className = className;
  img.src = src;
  img.alt = '';
  img.setAttribute('aria-hidden', 'true');
  img.draggable = false;
  return img;
}
