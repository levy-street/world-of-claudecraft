export interface AccountCosmetics {
  completedQuestIds: string[];
  mechChromaIds: string[];
  // Marketplace creator-skin ids the account owns; the equip gate's allow-list.
  ownedCreatorSkinIds: string[];
}

// Normalize an untrusted/persisted cosmetics blob to the AccountCosmetics shape:
// every field a deduped array of non-empty strings. The single source of truth
// for this shape, shared by the server (server/db.ts) and the client
// (src/net/online.ts) so the two can never drift as fields are added.
export function normalizeAccountCosmetics(value: unknown): AccountCosmetics {
  const src = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    completedQuestIds: uniqueStrings(src.completedQuestIds),
    mechChromaIds: uniqueStrings(src.mechChromaIds),
    ownedCreatorSkinIds: uniqueStrings(src.ownedCreatorSkinIds),
  };
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0 || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

// A creator skin authored in the in-browser designer: a tiny, deterministic
// spec (two colours + a pattern + optional glow) that EVERY client rebuilds into
// the same body-atlas texture procedurally — so a "skin" needs no hosted image.
// The same builder drives the designer's live preview and the in-world renderer,
// guaranteeing they match. Host-agnostic (no DOM/Three) so the server can
// validate a submitted spec; the canvas builder lives in render/characters/skin_design.ts.
export type SkinPattern =
  | 'solid'
  | 'scales'
  | 'stripes'
  | 'diamond'
  | 'hex'
  | 'spots'
  | 'runes'
  | 'chevron'
  | 'weave';
export const SKIN_PATTERNS: readonly SkinPattern[] = [
  'solid',
  'scales',
  'stripes',
  'diamond',
  'hex',
  'spots',
  'runes',
  'chevron',
  'weave',
];

// Surface finish — baked into the atlas as a sheen/highlight (no material-pipeline
// change): matte (flat), satin (soft top light), metallic (hard diagonal glint).
export type SkinFinish = 'matte' | 'satin' | 'metallic';
export const SKIN_FINISHES: readonly SkinFinish[] = ['matte', 'satin', 'metallic'];

// Pattern density — how tightly the motif repeats across the body.
export type SkinDensity = 'low' | 'medium' | 'high';
export const SKIN_DENSITIES: readonly SkinDensity[] = ['low', 'medium', 'high'];

export interface SkinDesignSpec {
  primary: string; // '#rrggbb' — dominant body colour (upper body / base)
  secondary: string; // '#rrggbb' — pattern colour + darkened lower-body shade
  accent: string; // '#rrggbb' — trim bands + pattern edge highlight
  pattern: SkinPattern;
  finish: SkinFinish;
  density: SkinDensity;
  emissive: string | null; // '#rrggbb' glow colour, or null for no glow
}

const SKIN_HEX6 = /^#[0-9a-f]{6}$/i;

/** Normalize an untrusted design blob to a valid SkinDesignSpec, or null if it
 *  isn't a usable design (so the skin falls back to its assetUrl/numeric skin).
 *  Shared by the server (listing validation) and the client (designer). The
 *  richer fields (accent/finish/density) default sensibly, so a legacy spec that
 *  carries only primary/secondary/pattern/emissive still normalizes + renders. */
export function normalizeDesignSpec(value: unknown): SkinDesignSpec | null {
  if (!value || typeof value !== 'object') return null;
  const src = value as Record<string, unknown>;
  const pattern = SKIN_PATTERNS.includes(src.pattern as SkinPattern)
    ? (src.pattern as SkinPattern)
    : null;
  if (!pattern || typeof src.primary !== 'string' || !SKIN_HEX6.test(src.primary)) return null;
  const hex = (v: unknown, fb: string): string =>
    typeof v === 'string' && SKIN_HEX6.test(v) ? v.toLowerCase() : fb;
  const oneOf = <T extends string>(v: unknown, set: readonly T[], fb: T): T =>
    set.includes(v as T) ? (v as T) : fb;
  return {
    primary: hex(src.primary, '#888888'),
    secondary: hex(src.secondary, '#444444'),
    accent: hex(src.accent, hex(src.secondary, '#caa84b')),
    pattern,
    finish: oneOf(src.finish, SKIN_FINISHES, 'satin'),
    density: oneOf(src.density, SKIN_DENSITIES, 'medium'),
    emissive:
      typeof src.emissive === 'string' && SKIN_HEX6.test(src.emissive)
        ? src.emissive.toLowerCase()
        : null,
  };
}

/** The designer's starting point (an emerald dragon-scale look). */
export function defaultDesignSpec(): SkinDesignSpec {
  return {
    primary: '#2e8b57',
    secondary: '#0b3d2e',
    accent: '#caa84b',
    pattern: 'scales',
    finish: 'satin',
    density: 'medium',
    emissive: null,
  };
}

// Public cosmetic metadata for one marketplace creator skin (from GET
// /api/skins/registry). The renderer resolves an entity's opaque cosmeticSkinId
// to a texture through this — `design` (procedural) when present, else assetUrl.
// The marketplace UI uses name/price. Deliberately carries no ownership or
// creator wallet — it is world-public.
export interface CreatorSkinRegistryEntry {
  id: string;
  name: string;
  description: string;
  skinCatalog: 'class' | 'mech';
  fallbackSkin: number;
  targetClass: string | null;
  assetUrl: string;
  emissiveUrl: string | null;
  design: SkinDesignSpec | null; // procedural design; takes precedence over assetUrl
  creator: string; // creator display label (account username or short wallet) — public attribution
  priceUsdc: string; // USDC base units (6 decimals) as a string
}

export interface IWorldCosmetics {
  accountCosmetics: AccountCosmetics;
  changeSkin(skin: number, catalog?: 'class' | 'mech', cosmeticSkinId?: string | null): void;
  // Lock in a skin from the cosmetic skin-select event overlay. The server
  // re-validates the choice against the rank it rolled (skinEvent) and consumes
  // the event token; the offline Sim resolves it directly.
  claimEventSkin(skin: number): void;
  unequipMechChroma(chromaId: string): void;
}
