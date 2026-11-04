// Game renderers produce formatting markup. Only copy the presentation vocabulary we
// support. In particular, article content cannot supply event handlers or external URLs.
const tags = new Set(['DIV', 'SPAN', 'B', 'STRONG', 'I', 'EM', 'SMALL', 'BR', 'IMG']);
const extraClasses = new Set(['coin', 'g', 's', 'c', 'visually-hidden', 'active']);
const safeColor = /^(?:#[0-9a-f]{3,8}|var\(--[a-z][\w-]*\)|rgba?\([\d.,%\s]+\))$/i;
const artPath = /^\/?(?:ui|textures)\/[a-z\d_/-]+\.(?:webp|png)$/i;

function copyNode(source, assetUrl) {
  if (source.nodeType === Node.TEXT_NODE) return document.createTextNode(source.textContent);
  if (source.nodeType !== Node.ELEMENT_NODE || !tags.has(source.tagName)) return null;
  const node = document.createElement(source.tagName.toLowerCase());
  for (const name of source.classList)
    if (extraClasses.has(name) || /^(?:tt-|q-|quality-|coin-|money-)[\w-]+$/.test(name))
      node.classList.add(name);
  if (source.getAttribute('aria-hidden') === 'true') node.setAttribute('aria-hidden', 'true');
  const color = source.style.getPropertyValue('color');
  if (safeColor.test(color)) node.style.color = color;
  if (source.tagName === 'IMG') {
    const path = source.getAttribute('src') ?? '';
    if (!artPath.test(path)) return document.createTextNode(source.getAttribute('alt') ?? '');
    const url = assetUrl('/' + path.replace(/^\//, ''));
    if (!url) return document.createTextNode(source.getAttribute('alt') ?? '');
    node.src = url;
    node.alt = source.getAttribute('alt') ?? '';
    return node;
  }
  for (const child of source.childNodes) {
    const safe = copyNode(child, assetUrl);
    if (safe) node.append(safe);
  }
  return node;
}

export function tooltipLookup(cards, assetUrl) {
  return (title) => {
    if (!Object.hasOwn(cards, title) || typeof cards[title] !== 'string') return null;
    const template = document.createElement('template');
    template.innerHTML = cards[title];
    const body = document.createDocumentFragment();
    for (const node of template.content.childNodes) {
      const safe = copyNode(node, assetUrl);
      if (safe) body.append(safe);
    }
    return body.childNodes.length ? body : null;
  };
}
