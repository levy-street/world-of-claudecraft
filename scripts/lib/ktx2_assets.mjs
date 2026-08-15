// Driver-side (Node) half of the tool-page KTX2 support: builds the script tag
// a page.setContent driver prepends before its bundled entry so attachKtx2
// (scripts/lib/ktx2_entry.js) can pre-seed THREE.Cache with the transcoder on
// pages that have no origin to fetch /basis/ from.
import { readFileSync } from 'node:fs';
import path from 'node:path';

export function ktx2TranscoderScriptTag(repoRoot) {
  const dir = path.join(repoRoot, 'public', 'basis');
  const jsText = readFileSync(path.join(dir, 'basis_transcoder.js'), 'utf8');
  const wasmB64 = readFileSync(path.join(dir, 'basis_transcoder.wasm')).toString('base64');
  // A literal "</script" inside the payload would terminate the inline tag.
  const json = JSON.stringify({ jsText, wasmB64 }).replace(/<\/script/gi, '<\\/script');
  return `<script>window.__KTX2_TRANSCODER__ = ${json};</script>`;
}
