import fs from 'node:fs';
import path from 'node:path';

const OVERLAY_FILE = /^\/audio\/sfx\/(runtime-pack\.json|blobs\/[a-f0-9]{64}\.mp3)$/;

export function resolveSfxOverlayFile(rootPath: string | null, urlPath: string): string | null {
  const relative = urlPath.match(OVERLAY_FILE)?.[1];
  if (!rootPath || !relative) return null;
  try {
    const root = fs.realpathSync(rootPath);
    const candidate = path.resolve(root, relative);
    if (!candidate.startsWith(`${root}${path.sep}`)) return null;
    const target = fs.realpathSync(candidate);
    if (!target.startsWith(`${root}${path.sep}`)) return null;
    return fs.statSync(target).isFile() ? target : null;
  } catch {
    return null;
  }
}
