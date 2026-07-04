import { publicAssetUrl } from '../../runtime_assets';
import { MEDIA_ASSETS } from './manifest.generated';

function logicalPath(url: string): string {
  return url.replace(/^\/+/, '');
}

export function assetUrl(url: string): string {
  const logical = logicalPath(url);
  if (import.meta.env.DEV) return publicAssetUrl(logical);
  return publicAssetUrl(MEDIA_ASSETS[logical] ?? logical);
}
