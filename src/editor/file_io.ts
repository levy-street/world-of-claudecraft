// DOM file I/O for CustomMap documents: download to a .json file and pick one back
// in. Kept apart from persist.ts so the (de)serializer stays DOM-free and testable.

import { type BundleFile, restoreBundleDeps, zipReadAny } from './bundle';
import type { CustomMap } from './custom_map';
import { missingBundleEntries, prepareMapForEngine } from './export_contract';
import { parseMap } from './persist';

export function downloadMap(map: CustomMap): void {
  const prepared = prepareMapForEngine(map);
  const blob = new Blob([prepared.json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safe = map.meta.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase() || 'map';
  a.download = `woc-map-${safe}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Safety net for Collision Master's Lock In: when the dev-server save endpoint
 *  is unreachable, download the authored override so the maker never loses the
 *  work. The file is one `{ assetId: override }` entry, ready to merge into
 *  data/asset_collision_overrides.json by hand (then run gen_collision_overrides). */
export function downloadCollisionOverride(assetId: string, override: unknown): void {
  const blob = new Blob([`${JSON.stringify({ [assetId]: override }, null, 2)}\n`], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safe = assetId.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase() || 'asset';
  a.download = `collision-${safe}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Hand a generated region module to the maker when the dev server that would
 *  normally write it is unreachable, so an export is never lost. */
export function downloadRegionModule(regionId: string, source: string): void {
  const blob = new Blob([source], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safe = regionId.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase() || 'region';
  a.download = `${safe}.authored.generated.ts`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Fallback for "Publish to Game" with no dev server answering (a fully offline
 * editor): hand over the two artifacts the endpoint would have written, so the
 * publish is a manual copy into data/maps/ and src/sim/maps/ rather than lost
 * work. Same spirit as downloadRegionModule above.
 */
export function downloadPublishedMap(slug: string, mapJson: string, moduleSource: string): void {
  const save = (name: string, text: string, type: string): void => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };
  save(`${slug}.map.json`, mapJson, 'application/json');
  save(`${slug}.generated.ts`, moduleSource, 'text/plain');
}

// Open a file picker and resolve with the parsed map, or null if cancelled/invalid.
export function pickMapFile(): Promise<CustomMap | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      file
        .text()
        .then((text) => resolve(parseMap(text)))
        .catch(() => resolve(null));
    };
    input.click();
  });
}

/**
 * The result of the import picker: a parsed map, a file that was chosen but
 * could not be read as a map, or a dismissed dialog. The caller distinguishes
 * them so a cancel stays silent while a genuine bad file surfaces an error
 * (rather than the old behaviour, where BOTH looked like "nothing happened").
 */
export type MapPickOutcome =
  | { status: 'ok'; map: CustomMap }
  | { status: 'invalid' }
  | { status: 'cancelled' };

/**
 * Find the bundle inside arbitrary zip contents. Handles what makers actually
 * hand us: (1) a real .wocmap.zip (map.json at the root); (2) a zip OF a
 * folder (map.json nested under a directory, every entry's shared prefix is
 * stripped so models/<sha> still resolve); (3) a zip that merely CONTAINS a
 * .wocmap.zip (Finder-zipped export folders), unwrapped recursively, a
 * couple of levels deep.
 */
async function bundleFilesFrom(files: BundleFile[], depth = 0): Promise<BundleFile[] | null> {
  // (1) map.json at the root: already a bundle.
  if (files.some((f) => f.path === 'map.json')) return files;
  // (2) map.json under a folder prefix: strip that prefix from everything.
  const nested = files.find((f) => f.path.endsWith('/map.json'));
  if (nested) {
    const prefix = nested.path.slice(0, -'map.json'.length);
    const stripped = files
      .filter((f) => f.path.startsWith(prefix))
      .map((f) => ({ path: f.path.slice(prefix.length), bytes: f.bytes }));
    return stripped;
  }
  // (3) a wrapped .wocmap.zip inside: unwrap it (nearest to the root first).
  if (depth >= 2) return null;
  const inner = files
    .filter((f) => /\.wocmap\.zip$/i.test(f.path))
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length)[0];
  if (!inner) return null;
  const innerFiles = await zipReadAny(inner.bytes);
  return innerFiles ? bundleFilesFrom(innerFiles, depth + 1) : null;
}

/** Read a chosen file into a CustomMap: zips (by extension OR magic bytes)
 *  resolve to a bundle, including Finder-zipped export folders, verifying
 *  and restoring every dependency before accepting map.json; anything else is
 *  parsed as plain map JSON. Returns null when the bytes are not a whole map. */
async function readMapFile(file: File): Promise<CustomMap | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Sniff the zip magic too: a bundle renamed to .json (or anything else)
  // should still import as a bundle instead of failing a text parse.
  const looksZip =
    bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] <= 8 && bytes[3] <= 8;
  if (/\.zip$/i.test(file.name) || looksZip) {
    const raw = await zipReadAny(bytes);
    const files = raw ? await bundleFilesFrom(raw) : null;
    const mapEntry = files?.find((f) => f.path === 'map.json');
    if (!files || !mapEntry) return null;
    const map = parseMap(new TextDecoder().decode(mapEntry.bytes));
    if (!map || missingBundleEntries(map, files) > 0) return null;
    try {
      await restoreBundleDeps(files);
    } catch {
      return null;
    }
    return map;
  }
  return parseMap(new TextDecoder().decode(bytes));
}

/**
 * Import a map bundle (.wocmap.zip) or bare map JSON from raw bytes, the same
 * pipeline as the file-picker's readMapFile, but from bytes rather than a File
 * (e.g. the shipped default-world bundle fetched at boot). Restores any bundled
 * dependencies into this browser. Returns null when the bytes are not a whole map.
 */
export async function importMapBundleBytes(
  bytes: Uint8Array,
  requireDeps = true,
): Promise<CustomMap | null> {
  const looksZip =
    bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] <= 8 && bytes[3] <= 8;
  if (looksZip) {
    const raw = await zipReadAny(bytes);
    const files = raw ? await bundleFilesFrom(raw) : null;
    const mapEntry = files?.find((f) => f.path === 'map.json');
    if (!files || !mapEntry) return null;
    const map = parseMap(new TextDecoder().decode(mapEntry.bytes));
    // `requireDeps` enforces bundle completeness for UNTRUSTED imports (the file
    // picker). A TRUSTED bundle (the shipped default world) may legitimately omit
    // its `builtin:` texture entries, those resolve from the code bundle, not
    // IndexedDB, so the seed passes requireDeps=false to accept a map-only bundle.
    if (!map || (requireDeps && missingBundleEntries(map, files) > 0)) return null;
    try {
      await restoreBundleDeps(files);
    } catch {
      return null;
    }
    return map;
  }
  return parseMap(new TextDecoder().decode(bytes));
}

/**
 * Import picker accepting a plain map .json OR a .wocmap.zip bundle. The <input>
 * is mounted in the document before .click(): a DETACHED file input does not
 * reliably fire 'change' on Firefox/Safari, which is what made Import silently
 * do nothing there. A dismissed dialog resolves via the 'cancel' event so the
 * promise can never hang forever.
 */
export function pickMapOrBundle(): Promise<MapPickOutcome> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json,application/zip,.zip';
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.setAttribute('aria-hidden', 'true');
    let settled = false;
    const settle = (outcome: MapPickOutcome): void => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(outcome);
    };
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        settle({ status: 'cancelled' });
        return;
      }
      readMapFile(file)
        .then((map) => settle(map ? { status: 'ok', map } : { status: 'invalid' }))
        .catch(() => settle({ status: 'invalid' }));
    });
    // Fired when the picker is dismissed with no selection (modern browsers);
    // without it a cancel would leave the promise pending and Import unusable
    // until reload.
    input.addEventListener('cancel', () => settle({ status: 'cancelled' }));
    document.body.appendChild(input);
    input.click();
  });
}
