// ---------------------------------------------------------------------------
// Unit-frame portrait core (pure: no DOM, no three.js)
//
// Geometry + crest-id resolution for the portrait plate shared by the player
// frame and the target frame. Kept DOM-free so it is unit-tested directly; the
// canvas painting that consumes it lives in unit_portrait_painter.ts.
//
// Two long-standing rough edges are addressed by this math:
//   * Crisp on HiDPI: the canvas backing store is scaled by devicePixelRatio
//     ({@link portraitBackingPx}) instead of being a fixed 54px bitmap the
//     browser then upscales.
//   * The art fills the plate: square crests carry a baked bevel + vignette, so
//     they are drawn slightly overscanned ({@link overscanRect}) to keep their
//     emblem visually dominant at unit-frame size.
// ---------------------------------------------------------------------------

/** Logical (CSS) px size of a unit-frame portrait canvas: the `.portrait`
 *  content box in index.html (64px box minus the 3px border on each side). */
export const PORTRAIT_CSS_SIZE = 58;

/** Crest overscan: how much larger than the canvas a crest is drawn so its
 *  baked square bevel/vignette lands outside the visible plate. ~9% past each
 *  side keeps the emblem large without visibly cropping it.
 *  Headshots already frame head+shoulders with intentional headroom, so they
 *  draw 1:1; overscanning them would crop the face. */
export const CREST_OVERSCAN = 1.18;

/** Upper bound on the device-pixel scale we honour. Beyond ~3x the extra
 *  resolution is imperceptible and just costs canvas memory. */
export const MAX_PORTRAIT_DPR = 3;

/** Backing-store px for a portrait canvas at a given CSS size and device pixel
 *  ratio, clamped to [1, {@link MAX_PORTRAIT_DPR}]x and rounded to whole px. */
export function portraitBackingPx(cssSize: number, dpr: number): number {
  const scale = Math.min(MAX_PORTRAIT_DPR, Math.max(1, Number.isFinite(dpr) && dpr > 0 ? dpr : 1));
  return Math.max(1, Math.round(cssSize * scale));
}

export interface DrawRect {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/** Centred draw rectangle for blitting a `size`x`size` image at `overscan`
 *  scale into a `size`x`size` canvas (negative offsets when overscan > 1). */
export function overscanRect(size: number, overscan: number): DrawRect {
  const dw = size * overscan;
  const off = (size - dw) / 2;
  return { dx: off, dy: off, dw, dh: dw };
}

/** Crest icon id for a non-player target: NPCs get the status emblem, mobs get
 *  their creature-family crest (humanoid when the family is unknown). */
export function crestIdForEntity(kind: string, family: string | undefined): string {
  if (kind === 'npc') return 'status_npc';
  return `family_${family ?? 'humanoid'}`;
}

export interface UnitPortraitSubject {
  kind: string;
  templateId: string;
  skin?: number;
  skinCatalog?: string;
  dead: boolean;
  ghost?: boolean;
  auras: readonly { id: string; kind: string }[];
}

export type UnitPortraitContext =
  | 'normal'
  | 'dead'
  | 'ghost'
  | 'form'
  | 'polymorph'
  | 'mech'
  | 'transformed';

export interface UnitPortraitPlan {
  visualKey: string;
  skin: number;
  context: UnitPortraitContext;
  identityKey: string;
}

const PORTRAIT_AURA_POLYMORPH = 1 << 0;
const PORTRAIT_AURA_BEAR = 1 << 1;
const PORTRAIT_AURA_CAT = 1 << 2;
const PORTRAIT_AURA_TRAVEL = 1 << 3;
const PORTRAIT_AURA_TRANSFORMED = 1 << 4;

function portraitAuraMask(auras: UnitPortraitSubject['auras']): number {
  let mask = 0;
  for (const aura of auras) {
    if (aura.kind === 'polymorph') mask |= PORTRAIT_AURA_POLYMORPH;
    else if (aura.kind === 'form_bear') mask |= PORTRAIT_AURA_BEAR;
    else if (aura.kind === 'form_cat' || aura.id === 'ghost_wolf') mask |= PORTRAIT_AURA_CAT;
    else if (aura.kind === 'form_travel') mask |= PORTRAIT_AURA_TRAVEL;
    else if (
      aura.kind === 'form_shadow' ||
      aura.kind === 'form_moonkin' ||
      aura.kind === 'form_metamorph'
    ) {
      mask |= PORTRAIT_AURA_TRANSFORMED;
    }
  }
  return mask;
}

function portraitPlanFromMask(subject: UnitPortraitSubject, auraMask: number): UnitPortraitPlan {
  const polymorph = (auraMask & PORTRAIT_AURA_POLYMORPH) !== 0;
  const bear = (auraMask & PORTRAIT_AURA_BEAR) !== 0;
  const cat = (auraMask & PORTRAIT_AURA_CAT) !== 0;
  const travel = (auraMask & PORTRAIT_AURA_TRAVEL) !== 0;
  const transformed = (auraMask & PORTRAIT_AURA_TRANSFORMED) !== 0;

  const visualKey = polymorph
    ? 'form_sheep'
    : bear
      ? 'form_bear'
      : cat
        ? 'form_cat'
        : travel
          ? 'form_travel'
          : subject.skinCatalog === 'mech'
            ? 'player_mech'
            : `player_${subject.templateId}`;
  const skin = subject.skin ?? 0;
  const context: UnitPortraitContext = subject.ghost
    ? 'ghost'
    : subject.dead
      ? 'dead'
      : polymorph
        ? 'polymorph'
        : bear || cat || travel
          ? 'form'
          : subject.skinCatalog === 'mech'
            ? 'mech'
            : transformed
              ? 'transformed'
              : 'normal';
  return {
    visualKey,
    skin,
    context,
    identityKey: `${visualKey}:${skin}:${context}`,
  };
}

/**
 * Resolve the same form precedence as the world renderer for player portraits.
 * Shader-only transformations retain the base model but receive their own rim
 * treatment and identity key so the frame updates as the aura changes.
 */
export function unitPortraitPlan(subject: UnitPortraitSubject): UnitPortraitPlan | null {
  if (subject.kind !== 'player') return null;
  return portraitPlanFromMask(subject, portraitAuraMask(subject.auras));
}

interface UnitPortraitPlanCacheEntry {
  templateId: string;
  skin: number;
  skinCatalog: string | undefined;
  dead: boolean;
  ghost: boolean;
  auraMask: number;
  plan: UnitPortraitPlan;
}

/**
 * Per-subject portrait-plan cache for the HUD hot path. The relevant aura bitmask
 * is allocation-free, and unchanged frames reuse both the plan and identity string.
 */
export class UnitPortraitPlanCache {
  private readonly entries = new WeakMap<UnitPortraitSubject, UnitPortraitPlanCacheEntry>();

  plan(subject: UnitPortraitSubject): UnitPortraitPlan | null {
    if (subject.kind !== 'player') return null;
    const skin = subject.skin ?? 0;
    const ghost = !!subject.ghost;
    const auraMask = portraitAuraMask(subject.auras);
    const cached = this.entries.get(subject);
    if (
      cached &&
      cached.templateId === subject.templateId &&
      cached.skin === skin &&
      cached.skinCatalog === subject.skinCatalog &&
      cached.dead === subject.dead &&
      cached.ghost === ghost &&
      cached.auraMask === auraMask
    ) {
      return cached.plan;
    }

    const plan = portraitPlanFromMask(subject, auraMask);
    this.entries.set(subject, {
      templateId: subject.templateId,
      skin,
      skinCatalog: subject.skinCatalog,
      dead: subject.dead,
      ghost,
      auraMask,
      plan,
    });
    return plan;
  }
}
