const EXTERNAL_URL_RE = /^[a-z][a-z\d+\-.]*:/i;

function logicalPublicPath(url: string): string {
  return url.replace(/^(?:\/+|\.\/)+/, '');
}

function normalizedBase(base: string): string {
  if (!base || base === '/') return '/';
  if (base === '.' || base === './') return './';
  return base.endsWith('/') ? base : `${base}/`;
}

export function publicAssetUrl(url: string, base = import.meta.env.BASE_URL): string {
  if (EXTERNAL_URL_RE.test(url) || url.startsWith('//')) return url;
  const logical = logicalPublicPath(url);
  return `${normalizedBase(base)}${logical}`;
}
