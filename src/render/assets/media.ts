import { MEDIA_ASSETS } from './manifest.generated';

function logicalPath(url: string): string {
  return url.replace(/^\/+/, '');
}

export function assetUrl(url: string): string {
  const logical = logicalPath(url);
  if (import.meta.env.DEV) return `/${logical}`;
  return MEDIA_ASSETS[logical] ?? `/${logical}`;
}

/** Whether the media manifest lists a file at this path: how a caller asks
 *  for an optional sibling of a model (a texture-tier file) without a request
 *  that would 404 where the model ships none. */
export function mediaAssetExists(url: string): boolean {
  return MEDIA_ASSETS[logicalPath(url)] !== undefined;
}
