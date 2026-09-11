// Pure data contract for authored asset fire. Rendering lives in
// render/placed_assets.ts; keeping presets and validation here lets the editor,
// sanitizer, playtest projection, and tests share one authoritative shape.

import type { AssetFireAnchor, AssetFireBlend, AssetFireEmitter, AssetFireStyle } from './types';

export const MAX_ASSET_FIRE_EMITTERS = 16;

const STYLE_SET = new Set<AssetFireStyle>(['torch', 'bonfire', 'wildfire', 'soulfire', 'embers']);
const ANCHOR_SET = new Set<AssetFireAnchor>(['base', 'center', 'top']);
const BLEND_SET = new Set<AssetFireBlend>(['additive', 'alpha']);

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const finite = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

const PRESETS: Readonly<Record<AssetFireStyle, Omit<AssetFireEmitter, 'id'>>> = {
  torch: {
    enabled: true,
    anchor: 'top',
    style: 'torch',
    blend: 'additive',
    x: 0,
    y: 0,
    z: 0,
    scale: 1,
    width: 0.82,
    height: 1.18,
    flames: 2,
    intensity: 1.5,
    opacity: 0.92,
    glow: 2.6,
    glowRange: 7,
    smoke: 0.22,
    smokeScale: 0.9,
    smokeRise: 1.2,
    hue: 28,
    saturation: 1,
    speed: 1.05,
    turbulence: 0.55,
    flicker: 0.65,
    embers: 0.22,
  },
  bonfire: {
    enabled: true,
    anchor: 'base',
    style: 'bonfire',
    blend: 'additive',
    x: 0,
    y: 0.12,
    z: 0,
    scale: 1.75,
    width: 1.45,
    height: 1.15,
    flames: 5,
    intensity: 2.4,
    opacity: 0.96,
    glow: 4.2,
    glowRange: 12,
    smoke: 0.58,
    smokeScale: 1.35,
    smokeRise: 2.1,
    hue: 24,
    saturation: 1,
    speed: 1.2,
    turbulence: 0.85,
    flicker: 0.82,
    embers: 0.66,
  },
  wildfire: {
    enabled: true,
    anchor: 'base',
    style: 'wildfire',
    blend: 'additive',
    x: 0,
    y: 0,
    z: 0,
    scale: 2.4,
    width: 2.1,
    height: 0.9,
    flames: 8,
    intensity: 3.2,
    opacity: 0.9,
    glow: 5.2,
    glowRange: 16,
    smoke: 0.82,
    smokeScale: 1.8,
    smokeRise: 2.7,
    hue: 18,
    saturation: 0.95,
    speed: 1.45,
    turbulence: 1.25,
    flicker: 0.9,
    embers: 0.88,
  },
  soulfire: {
    enabled: true,
    anchor: 'top',
    style: 'soulfire',
    blend: 'additive',
    x: 0,
    y: 0,
    z: 0,
    scale: 1.15,
    width: 0.9,
    height: 1.35,
    flames: 3,
    intensity: 2,
    opacity: 0.94,
    glow: 4.5,
    glowRange: 10,
    smoke: 0.35,
    smokeScale: 1,
    smokeRise: 1.5,
    hue: 190,
    saturation: 0.9,
    speed: 0.82,
    turbulence: 0.72,
    flicker: 0.48,
    embers: 0.35,
  },
  embers: {
    enabled: true,
    anchor: 'base',
    style: 'embers',
    blend: 'additive',
    x: 0,
    y: 0.08,
    z: 0,
    scale: 0.9,
    width: 1.2,
    height: 0.45,
    flames: 1,
    intensity: 0.55,
    opacity: 0.7,
    glow: 1.8,
    glowRange: 5,
    smoke: 0.14,
    smokeScale: 0.7,
    smokeRise: 0.65,
    hue: 12,
    saturation: 0.86,
    speed: 0.42,
    turbulence: 0.28,
    flicker: 0.3,
    embers: 1,
  },
};

/** A complete preset. Callers provide a stable document-local id. */
export function assetFirePreset(style: AssetFireStyle, id: string): AssetFireEmitter {
  return { id, ...PRESETS[style] };
}

/** First unused compact id; deterministic and friendly in exported JSON. */
export function nextAssetFireId(emitters: readonly Pick<AssetFireEmitter, 'id'>[]): string {
  const used = new Set(emitters.map((v) => v.id));
  for (let n = 1; n <= MAX_ASSET_FIRE_EMITTERS + 1; n++) {
    const id = `fire-${n}`;
    if (!used.has(id)) return id;
  }
  return `fire-${emitters.length + 1}`;
}

/** Sanitize one untrusted emitter into a complete bounded record. */
export function sanitizeAssetFireEmitter(
  value: unknown,
  fallbackId: string,
): AssetFireEmitter | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const style = STYLE_SET.has(raw.style as AssetFireStyle)
    ? (raw.style as AssetFireStyle)
    : 'torch';
  const base = PRESETS[style];
  const cleanId =
    typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,48}$/.test(raw.id) ? raw.id : fallbackId;
  return {
    id: cleanId,
    enabled: raw.enabled !== false,
    anchor: ANCHOR_SET.has(raw.anchor as AssetFireAnchor)
      ? (raw.anchor as AssetFireAnchor)
      : base.anchor,
    style,
    blend: BLEND_SET.has(raw.blend as AssetFireBlend) ? (raw.blend as AssetFireBlend) : base.blend,
    x: clamp(finite(raw.x, base.x), -50, 50),
    y: clamp(finite(raw.y, base.y), -50, 50),
    z: clamp(finite(raw.z, base.z), -50, 50),
    scale: clamp(finite(raw.scale, base.scale), 0.05, 10),
    width: clamp(finite(raw.width, base.width), 0.1, 4),
    height: clamp(finite(raw.height, base.height), 0.1, 5),
    flames: Math.round(clamp(finite(raw.flames, base.flames), 1, 8)),
    intensity: clamp(finite(raw.intensity, base.intensity), 0, 8),
    opacity: clamp(finite(raw.opacity, base.opacity), 0.05, 1),
    glow: clamp(finite(raw.glow, base.glow), 0, 8),
    glowRange: clamp(finite(raw.glowRange, base.glowRange), 0.5, 50),
    smoke: clamp(finite(raw.smoke, base.smoke), 0, 1),
    smokeScale: clamp(finite(raw.smokeScale, base.smokeScale), 0.1, 5),
    smokeRise: clamp(finite(raw.smokeRise, base.smokeRise), 0, 5),
    hue: clamp(finite(raw.hue, base.hue), 0, 360),
    saturation: clamp(finite(raw.saturation, base.saturation), 0, 1),
    speed: clamp(finite(raw.speed, base.speed), 0, 4),
    turbulence: clamp(finite(raw.turbulence, base.turbulence), 0, 2),
    flicker: clamp(finite(raw.flicker, base.flicker), 0, 1),
    embers: clamp(finite(raw.embers, base.embers), 0, 1),
  };
}

/** Invalid rows are dropped, duplicates receive deterministic replacement ids. */
export function sanitizeAssetFireEmitters(value: unknown): AssetFireEmitter[] {
  if (!Array.isArray(value)) return [];
  const out: AssetFireEmitter[] = [];
  const ids = new Set<string>();
  for (const raw of value.slice(0, MAX_ASSET_FIRE_EMITTERS)) {
    const fx = sanitizeAssetFireEmitter(raw, nextAssetFireId(out));
    if (!fx) continue;
    if (ids.has(fx.id)) fx.id = nextAssetFireId(out);
    ids.add(fx.id);
    out.push(fx);
  }
  return out;
}

/** Runtime compatibility for old maps carrying only `fire: true`. */
export function legacyAssetFireEmitter(): AssetFireEmitter {
  return assetFirePreset('torch', 'legacy-fire');
}
