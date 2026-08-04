import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const EASTBROOK_MAILBOX_REPO_ROOT = path.resolve(HERE, '..', '..', '..');

export const EASTBROOK_MAILBOX_SOURCE_FILES = Object.freeze([
  'docs/screenshots/eastbrook-vale-rebuild/polish/turnarounds/ravenpost-mailbox.png',
  'public/textures/eastbrook_surface_atlas.webp',
  'scripts/assets/eastbrook_mailbox/model.js',
  'scripts/assets/eastbrook_mailbox/export_entry.js',
  'scripts/assets/eastbrook_mailbox/export_eastbrook_mailbox.mjs',
  'scripts/assets/eastbrook_mailbox/source_fingerprint.mjs',
  'scripts/assets/specs/eastbrook_mailbox.json',
  'scripts/assets/build_assets.mjs',
  'pnpm-lock.yaml',
]);

function lengthDelimiter(byteLength) {
  const delimiter = Buffer.alloc(8);
  delimiter.writeBigUInt64BE(BigInt(byteLength));
  return delimiter;
}

export function eastbrookMailboxSourceFingerprint(repoRoot = EASTBROOK_MAILBOX_REPO_ROOT) {
  const hash = createHash('sha256');
  for (const relativePath of EASTBROOK_MAILBOX_SOURCE_FILES) {
    const pathBytes = Buffer.from(relativePath, 'utf8');
    const fileBytes = readFileSync(path.join(repoRoot, relativePath));
    hash.update(lengthDelimiter(pathBytes.byteLength));
    hash.update(pathBytes);
    hash.update(lengthDelimiter(fileBytes.byteLength));
    hash.update(fileBytes);
  }
  return hash.digest('hex');
}
