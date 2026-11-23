/** Cosmetic finishes on the placement-local +Z and -Z wall faces. */
export interface WallFinish {
  /** Built-in terrain texture key, or an imported image's content hash. */
  texture?: string;
  /** World yards per repeat, independent of placement scale. */
  tileSize?: number;
  color?: number;
}

export interface WallFinishes {
  front?: WallFinish;
  back?: WallFinish;
}

const BUILTIN_TEXTURE = /^[A-Za-z0-9]{1,32}$/;
const CUSTOM_TEXTURE = /^custom:([a-f0-9]{64})$/;

export function sanitizeWallFinish(value: unknown): WallFinish | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const finish: WallFinish = {};
  if (
    typeof raw.texture === 'string' &&
    (BUILTIN_TEXTURE.test(raw.texture) || CUSTOM_TEXTURE.test(raw.texture))
  ) {
    finish.texture = raw.texture;
  }
  if (typeof raw.color === 'number' && Number.isFinite(raw.color)) {
    finish.color = Math.round(Math.max(0, Math.min(0xffffff, raw.color)));
  }
  if (finish.texture === undefined && finish.color === undefined) return undefined;
  if (typeof raw.tileSize === 'number' && Number.isFinite(raw.tileSize)) {
    finish.tileSize = Math.max(0.5, Math.min(64, raw.tileSize));
  }
  return finish;
}

export function sanitizeWallFinishes(value: unknown): WallFinishes | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const front = sanitizeWallFinish(raw.front);
  const back = sanitizeWallFinish(raw.back);
  if (!front && !back) return undefined;
  return { ...(front ? { front } : {}), ...(back ? { back } : {}) };
}

/** Each undo/document copy owns both nested finish records. */
export function cloneWallFinishes(value: WallFinishes | undefined): WallFinishes | undefined {
  return sanitizeWallFinishes(value);
}

/** Imported image dependencies for portable map bundles, with duplicates removed. */
export function wallFinishTextureRefs(value: WallFinishes | undefined): string[] {
  const refs: string[] = [];
  for (const finish of [value?.front, value?.back]) {
    const sha = finish?.texture?.match(CUSTOM_TEXTURE)?.[1];
    if (sha && !refs.includes(sha)) refs.push(sha);
  }
  return refs;
}
