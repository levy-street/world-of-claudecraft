const ABSOLUTE_URL_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

export function resolvePublicAssetUrl(url: string, baseUrl: string): string {
  if (!url || url.startsWith('#') || ABSOLUTE_URL_RE.test(url)) return url;
  if (url.startsWith('./') || url.startsWith('../')) return url;

  const cleanUrl = url.replace(/^\/+/, '');
  const base = baseUrl || '/';
  if (base === '/') return `/${cleanUrl}`;

  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return `${normalizedBase}${cleanUrl}`;
}

export function publicAssetUrl(url: string): string {
  return resolvePublicAssetUrl(url, import.meta.env.BASE_URL || '/');
}
