// Decal tool support: the "next stamp" settings, the browsable library (the
// shipped CC0 set plus this browser's imported images), and image import.
//
// Imported decals are content-addressed by sha256 and stored in the SAME
// IndexedDB store as imported ground textures, one place for "images a map
// references", which also means map bundles already know how to pack them
// (see bundleDependencyRefs). The list of which shas are decals (and their
// display names) is a per-browser preference, since the map document only ever
// stores the hash it stamps.

import {
  groundImageFor,
  groundTextureUrl,
  storeGroundTexture,
} from '../render/assets/ground_textures';
import { DECAL_LIBRARY, type DecalDef } from '../render/decal_library.generated';
import { builtinDecalId, builtinDecalKey, decalPreviewUrl } from '../render/decals';
import { DEFAULT_DECAL_SIZE } from '../sim/map_doc';

const BRUSH_PREF_KEY = 'woc_editor_decal_brush';
const IMPORT_PREF_KEY = 'woc_editor_decal_imports';
const MAX_IMPORTED_DECALS = 48;
const MAX_DECAL_IMPORT_BYTES = 8 * 1024 * 1024;

/** What the next click stamps. */
export interface DecalBrush {
  /** `builtin:<key>` or an imported sha256. */
  tex: string;
  size: number;
  /** Yaw in radians applied to a new stamp (ignored when `randomRotate`). */
  rot: number;
  aspect: number;
  opacity: number;
  glow: number;
  /** 0xRRGGBB tint, 0xffffff = the art's own colour. */
  color: number;
  /** Give every stamp a random yaw, the difference between a scattering of
   *  blood spatter and an obviously repeated stamp. */
  randomRotate: boolean;
}

export const DEFAULT_DECAL_BRUSH: DecalBrush = {
  tex: builtinDecalId(DECAL_LIBRARY[0]?.key ?? 'pentagram'),
  size: DEFAULT_DECAL_SIZE,
  rot: 0,
  aspect: 1,
  opacity: 1,
  glow: 0,
  color: 0xffffff,
  randomRotate: true,
};

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

export function loadDecalBrush(): DecalBrush {
  try {
    const raw = localStorage.getItem(BRUSH_PREF_KEY);
    if (!raw) return { ...DEFAULT_DECAL_BRUSH };
    const p = JSON.parse(raw) as Partial<DecalBrush>;
    return {
      tex: typeof p.tex === 'string' && p.tex.length > 0 ? p.tex : DEFAULT_DECAL_BRUSH.tex,
      size: num(p.size, DEFAULT_DECAL_BRUSH.size),
      rot: num(p.rot, 0),
      aspect: num(p.aspect, 1),
      opacity: num(p.opacity, 1),
      glow: num(p.glow, 0),
      color: num(p.color, 0xffffff),
      randomRotate: p.randomRotate !== false,
    };
  } catch {
    // Blocked/corrupt storage: the session starts on the defaults.
    return { ...DEFAULT_DECAL_BRUSH };
  }
}

export function saveDecalBrush(brush: DecalBrush): void {
  try {
    localStorage.setItem(BRUSH_PREF_KEY, JSON.stringify(brush));
  } catch {
    // Blocked storage: the setting stays session-only.
  }
}

/** One entry of the tool's library panel: a built-in or an imported image. */
export interface DecalLibraryEntry {
  /** The art id a stamp stores (`builtin:<key>` or a sha256). */
  tex: string;
  name: string;
  category: DecalDef['category'] | 'imported';
  /** Default footprint in yards. */
  size: number;
  glow: number;
  tint: number;
  imported?: true;
}

interface StoredImport {
  sha: string;
  name: string;
}

let imports: StoredImport[] | null = null;

function loadImports(): StoredImport[] {
  if (imports) return imports;
  imports = [];
  try {
    const raw = localStorage.getItem(IMPORT_PREF_KEY);
    if (raw) {
      for (const e of JSON.parse(raw) as StoredImport[]) {
        if (!e || typeof e.sha !== 'string' || !/^[a-f0-9]{64}$/.test(e.sha)) continue;
        imports.push({ sha: e.sha, name: typeof e.name === 'string' ? e.name : e.sha.slice(0, 8) });
      }
    }
  } catch {
    // Blocked/corrupt storage: built-ins only this session.
  }
  return imports;
}

function saveImports(): void {
  if (!imports) return;
  try {
    localStorage.setItem(IMPORT_PREF_KEY, JSON.stringify(imports));
  } catch {
    // Blocked storage: imports stay session-only.
  }
}

/** The full library: shipped decals first, then this browser's imports. */
export function listDecals(): DecalLibraryEntry[] {
  const out: DecalLibraryEntry[] = DECAL_LIBRARY.map((d) => ({
    tex: builtinDecalId(d.key),
    name: d.name,
    category: d.category,
    size: d.size,
    glow: d.glow ?? 0,
    tint: d.tint ?? 0xffffff,
  }));
  for (const e of loadImports()) {
    out.push({
      tex: e.sha,
      name: e.name,
      category: 'imported',
      size: DEFAULT_DECAL_SIZE,
      glow: 0,
      tint: 0xffffff,
      imported: true,
    });
  }
  return out;
}

export function decalEntry(tex: string): DecalLibraryEntry | null {
  return listDecals().find((d) => d.tex === tex) ?? null;
}

/** Display name for an art id, falling back to the raw id for art this browser
 *  does not have (a bundle imported on another machine). */
export function decalName(tex: string): string {
  const entry = decalEntry(tex);
  if (entry) return entry.name;
  const key = builtinDecalKey(tex);
  return key ?? `${tex.slice(0, 8)}…`;
}

/** Thumbnail URL for the picker. Imported art resolves only after its bytes are
 *  read out of IndexedDB once (see warmDecalThumbs). */
export function decalThumbUrl(tex: string): string | null {
  return decalPreviewUrl(tex) ?? groundTextureUrl(tex);
}

/** Pull every imported decal's bytes into the shared image cache so the picker
 *  can show thumbnails. Resolves when all have been attempted. */
export async function warmDecalThumbs(): Promise<void> {
  await Promise.all(loadImports().map((e) => groundImageFor(e.sha)));
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Import an image file as a stampable decal. Rejects (throws) on an unreadable
 * or oversized image; otherwise stores the bytes content-addressed and returns
 * the new entry. Re-importing the same image is a no-op that returns the
 * existing entry, since the sha is the identity.
 */
export async function importDecalImage(file: File): Promise<DecalLibraryEntry> {
  if (file.size > MAX_DECAL_IMPORT_BYTES) throw new Error('too large');
  const bytes = await file.arrayBuffer();
  // Decode first: a file that is not an image must fail BEFORE it is stored,
  // or the library grows an entry that can never render.
  const bitmap = await createImageBitmap(new Blob([bytes], { type: file.type || 'image/png' }));
  bitmap.close();
  const sha = await sha256Hex(bytes);
  await storeGroundTexture({
    sha256: sha,
    name: file.name,
    mime: file.type || 'image/png',
    bytes,
  });
  const list = loadImports();
  const name = file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 24) || 'Imported';
  const existing = list.find((e) => e.sha === sha);
  if (existing) existing.name = name;
  else {
    list.push({ sha, name });
    while (list.length > MAX_IMPORTED_DECALS) list.shift();
  }
  saveImports();
  return {
    tex: sha,
    name,
    category: 'imported',
    size: DEFAULT_DECAL_SIZE,
    glow: 0,
    tint: 0xffffff,
    imported: true,
  };
}

/** Forget an imported decal (the stored bytes stay: a map may still stamp it). */
export function removeImportedDecal(sha: string): void {
  const list = loadImports();
  const i = list.findIndex((e) => e.sha === sha);
  if (i >= 0) {
    list.splice(i, 1);
    saveImports();
  }
}
