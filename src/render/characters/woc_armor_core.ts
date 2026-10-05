/** The WOC player character files, split the way the artist delivers them (the 2026-09-25
 *  character size gameplan, steps 2, 4, 5 and 6): the pure decisions, three-free so a Vitest
 *  reads them directly.
 *
 *   models/chars/players/woc/base_<fit>.glb     the rig and the body, no clips and no head
 *                                               (the modular head packs are the head)
 *   models/chars/players/woc/anims_<fit>.glb    the rig's nodes and every clip, no mesh
 *   models/chars/players/woc/armor/<fit>_<set>_low.glb
 *   models/chars/players/woc/armor/<fit>_<set>_medium.glb
 *                                               one armor set on a copy of the rig, a complete
 *                                               file each: low with its own small colour atlas,
 *                                               medium with every map at half resolution
 *   models/chars/players/woc/armor/<fit>_<set>_top.glb
 *                                               the top mip level of each of the medium file's
 *                                               maps and nothing else (2026-10-03: a texture's
 *                                               top level is three quarters of its bytes, and
 *                                               only a close-up needs it)
 *
 * A body loads its base and animation library once; an armor set loads the first time a
 * visible character wears it, at the texture tier that character draws (wocArmorTierFor),
 * and is freed once nobody has worn it for a few minutes. The high tier has no file of its
 * own: the store assembles it from the medium file and the top file (woc_armor_packs.ts),
 * and the top file's url names it. Until a set arrives the body draws its own black suit (or
 * a tier of the same set that is already resident), and nothing ever waits on a set to enter
 * the world.
 *
 * Built by scripts/assets/woc_character/build_woc_split.mjs; sizes ratcheted by
 * tests/woc_character_size_budget.test.ts.
 */

/** A body fit: which base, animation library and armor fit a character wears. */
export type WocFit = 'male' | 'female';

/** An armor texture tier: what one character draws a set at. Low and medium are each a file of
 *  their own; high is the medium file with the top mip level of every map laid over it. */
export type WocArmorTier = 'low' | 'medium' | 'high';

export const WOC_ARMOR_TIERS: readonly WocArmorTier[] = ['low', 'medium', 'high'];

/** How much armor texture detail one character is given: `full` for a character seen up close
 *  (the local player's own, and every body built directly: a preview, a portrait), `crowd` for
 *  every other character in the world. */
export type WocArmorDetail = 'full' | 'crowd';

/** The file whose url names each tier's pack: the high pack is named by the top file, the one
 *  fetch that completes it over the medium file. */
const PACK_FILE: Readonly<Record<WocArmorTier, string>> = {
  low: 'low',
  medium: 'medium',
  high: 'top',
};

/** Where the split files ship (under public/). */
export const WOC_SPLIT_DIR = 'models/chars/players/woc';

export function wocBaseUrl(fit: WocFit): string {
  return `${WOC_SPLIT_DIR}/base_${fit}.glb`;
}

export function wocAnimsUrl(fit: WocFit): string {
  return `${WOC_SPLIT_DIR}/anims_${fit}.glb`;
}

/**
 * The top of each fit's canonical anatomy: the height every WOC body is normalized by, in the
 * base file's own units at the pose assets.ts prepareVisual reads a WOC body in (its REST pose:
 * the rig is re-read after the idle sample is released).
 *
 * It is the crown of the head the bodies were first delivered with. That head never ships: the
 * modular head packs are the head, the base file ends at the neck, and the split build measures
 * the original then strips it. The normalization takes this as the body's top instead, so every
 * character keeps the exact size it had, and no hairstyle or helm can ever change it. Measured
 * on the shipped, quantized files; the build records its own measure of the same crown before
 * quantization (export_split.json `anatomyTop`), and tests/woc_export.test.ts holds the two
 * within a tenth of a percent of each other.
 */
export const WOC_ANATOMY_TOP: Readonly<Record<WocFit, number>> = {
  male: 1.1806127832469875,
  female: 1.1940103157300836,
};

/** One armor set's pack for a body fit at a texture tier: the url the store, a dressing, the
 *  merge and the far bake know it by. Low and medium name their own file; high names the top
 *  file, which the store lays over the medium file (woc_armor_packs.ts). `set` is the pack id
 *  the manifest's items name (a class set today: `warrior`, `mage`, ...). */
export function wocArmorPackUrl(fit: WocFit, set: string, tier: WocArmorTier): string {
  return `${WOC_SPLIT_DIR}/armor/${fit}_${set}_${PACK_FILE[tier]}.glb`;
}

/** An armor pack's parts (fit, set, tier: the top file is the high pack), or null for any
 *  other url. */
export function parseWocArmorPackUrl(
  url: string,
): { fit: WocFit; set: string; tier: WocArmorTier } | null {
  const m =
    /(?:^|\/)models\/chars\/players\/woc\/armor\/(male|female)_([a-z0-9_]+)_(low|medium|top)\.glb$/.exec(
      url,
    );
  if (!m) return null;
  const tier: WocArmorTier = m[3] === 'top' ? 'high' : (m[3] as WocArmorTier);
  return { fit: m[1] as WocFit, set: m[2], tier };
}

/** The pack an assembled pack is drawn over: a high pack's medium file. Null for a pack that is
 *  a file of its own (and for any other url). */
export function wocArmorPackBaseUrl(url: string): string | null {
  const parsed = parseWocArmorPackUrl(url);
  return parsed?.tier === 'high' ? wocArmorPackUrl(parsed.fit, parsed.set, 'medium') : null;
}

/** The slice of the graphics profile the tier reads (GfxSettings). */
export interface WocTierProfile {
  readonly tier: string;
  /** The phone-class memory profile (every iOS WebKit host plus the touch/coarse-pointer
   *  detector): phones load the low tier whatever preset they run. */
  readonly constrainedMemory: boolean;
}

/**
 * The armor texture tier one character draws. The graphics profile decides first: the low
 * preset and every phone draw the low file for everyone, and the medium preset draws the
 * medium file for everyone (the owner's call, 2026-10-03: the top levels are a High
 * download). On high and above the character's DETAIL decides: full detail (the local
 * player's own character and every body built directly: the character creator, inspect, the
 * armory, the character sheet, a portrait's live build) draws high, and every other character
 * in the world draws medium.
 *
 * Texture resolution is cosmetic sharpness only, never information a player acts on
 * (docs/design/graphics-settings-fairness.md): every tier draws the same pieces, shapes and
 * colours, and only the texels a close-up resolves differ. That holds for the detail rule
 * too: a character drawn at medium is the same character at a lower sampling rate, and which
 * one draws at full detail is decided by whose character it is (your own), never by anything
 * a player could react to.
 */
export function wocArmorTierFor(
  profile: WocTierProfile,
  detail: WocArmorDetail = 'full',
): WocArmorTier {
  if (profile.constrainedMemory || profile.tier === 'low') return 'low';
  if (profile.tier === 'medium') return 'medium';
  return detail === 'full' ? 'high' : 'medium';
}

/**
 * The tier drawn for a set while its wanted tier streams: the wanted tier itself when it is
 * resident, else the nearest resident tier (the higher one first at an equal distance: never
 * draw less than the setting asked for when more is already in memory), else null (the body
 * suit until the set arrives). A high pack is resident only over a resident medium file, so
 * the medium file is what stands in while a set's top levels stream: the normal path of the
 * local player's own character, seamless because the medium file keeps drawing until the high
 * pack's reveal settles (woc_armor_dressing.ts).
 */
export function wocStandInTier(
  wanted: WocArmorTier,
  resident: (tier: WocArmorTier) => boolean,
): WocArmorTier | null {
  if (resident(wanted)) return wanted;
  const at = WOC_ARMOR_TIERS.indexOf(wanted);
  for (let d = 1; d < WOC_ARMOR_TIERS.length; d++) {
    const up = WOC_ARMOR_TIERS[at + d];
    if (up && resident(up)) return up;
    const down = WOC_ARMOR_TIERS[at - d];
    if (down && resident(down)) return down;
  }
  return null;
}

/** How long a set nobody wears stays in memory before it is freed. */
export const WOC_ARMOR_IDLE_EVICT_MS = 3 * 60 * 1000;

/**
 * Live users per armor pack, and the packs nobody has used for WOC_ARMOR_IDLE_EVICT_MS. A
 * user is anything drawing the pack's geometry or materials: a character that has its pieces
 * attached, a far-LOD bake taken off them. Driven by the caller's clock (no timers): a pack
 * whose last user leaves starts its idle window, and the next acquire, release or sweep past
 * the window hands it back to be freed.
 */
export class WocArmorResidency {
  private readonly counts = new Map<string, number>();
  private readonly idleSince = new Map<string, number>();

  constructor(private readonly idleMs = WOC_ARMOR_IDLE_EVICT_MS) {}

  acquire(url: string): void {
    this.counts.set(url, (this.counts.get(url) ?? 0) + 1);
    this.idleSince.delete(url);
  }

  release(url: string, now: number): void {
    const n = (this.counts.get(url) ?? 0) - 1;
    if (n > 0) {
      this.counts.set(url, n);
      return;
    }
    this.counts.delete(url);
    this.idleSince.set(url, now);
  }

  /** A pack that arrived with nobody wearing it yet (a prefetch) starts idle at `now`. */
  noteResident(url: string, now: number): void {
    if (!this.counts.has(url) && !this.idleSince.has(url)) this.idleSince.set(url, now);
  }

  refs(url: string): number {
    return this.counts.get(url) ?? 0;
  }

  /** The packs idle past the window at `now`, dropped from the ledger (the caller frees them). */
  takeExpired(now: number): string[] {
    const out: string[] = [];
    for (const [url, since] of this.idleSince) {
      if (now - since < this.idleMs) continue;
      out.push(url);
    }
    for (const url of out) this.idleSince.delete(url);
    return out;
  }

  /** Forget a pack entirely (its file was freed or failed). */
  forget(url: string): void {
    this.counts.delete(url);
    this.idleSince.delete(url);
  }
}
