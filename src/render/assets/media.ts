import { MEDIA_ASSETS } from './manifest.generated';
import { publicAssetUrl } from '../../asset_url';

function logicalPath(url: string): string {
  return url.replace(/^\/+/, '');
}

export function assetUrl(url: string, opts: { base?: string; dev?: boolean } = {}): string {
  const logical = logicalPath(url);
  const resolved = (opts.dev ?? import.meta.env.DEV) ? logical : (MEDIA_ASSETS[logical] ?? logical);
  return publicAssetUrl(resolved, opts.base ?? import.meta.env.BASE_URL);
}
