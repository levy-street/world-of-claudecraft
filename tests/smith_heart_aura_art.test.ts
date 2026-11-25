// The Smith's Heart's painted aura art (src/ui/smith_heart_aura_art.ts): every id it
// covers is a live aura the raid applies, the HUD's aura resolver answers each with its
// painting (its own, or the one it shares), every painting ships as a small opaque
// 128px WebP, and the census leaves no raid aura on a generic glyph except the two
// documented ones.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { SMITH_HEART_VEINS } from '../src/sim/content/smith_heart_layout';
import { BREATH_AURAS } from '../src/sim/encounters/smith_heart/breath_ids';
import { ISLE_AURAS } from '../src/sim/encounters/smith_heart/breath_isle_ids';
import { COUNCIL_AURAS } from '../src/sim/encounters/smith_heart/council_ids';
import { FINAL_AURAS, overloadAuraId } from '../src/sim/encounters/smith_heart/final_ids';
import { FINAL_PHASE_AURAS, pouredAuraId } from '../src/sim/encounters/smith_heart/final_phase_ids';
import { HEAT_AURAS } from '../src/sim/encounters/smith_heart/heat_ids';
import { QUENCH_AURAS } from '../src/sim/encounters/smith_heart/quench_ids';
import { DORMANT_AURA_ID } from '../src/sim/mob/dormant_state';
import { WIND_BLAST_AURA, WIND_DRIFT_AURA, WIND_PULL_AURA } from '../src/sim/wind_drift';
import { resolveHudAuraIconId } from '../src/ui/aura_icon_runtime';
import { AURA_FILE_IMAGE_IDS, auraImageUrl } from '../src/ui/icons';
import {
  SMITH_HEART_AURA_ICON_SOURCES,
  SMITH_HEART_AURA_IMAGE_IDS,
} from '../src/ui/smith_heart_aura_art';

/** Every aura id the raid's sim applies: the five fights' maps, the final boss's
 *  per-vein bars, the Breath's wind kernel and the warders' dormant ward. */
const LIVE_RAID_AURA_IDS = new Set<string>([
  ...Object.values(COUNCIL_AURAS),
  ...Object.values(BREATH_AURAS),
  ...Object.values(ISLE_AURAS),
  ...Object.values(QUENCH_AURAS),
  ...Object.values(HEAT_AURAS),
  ...Object.values(FINAL_AURAS),
  ...Object.values(FINAL_PHASE_AURAS),
  ...SMITH_HEART_VEINS.map(overloadAuraId),
  ...SMITH_HEART_VEINS.map(pouredAuraId),
  WIND_DRIFT_AURA,
  WIND_PULL_AURA,
  WIND_BLAST_AURA,
  DORMANT_AURA_ID,
]);

/** The raid auras deliberately left without a raid painting, and why. */
const UNPAINTED: Readonly<Record<string, string>> = {
  heart_endless_song: 'rides a pillar object; no unit frame ever shows it',
  stackpoison_heart_heat_guardian: 'already wears the mob_stack_poison painting',
};

/** The owner's size budget for these icons (the existing aura art averages under 5 KB). */
const MAX_ICON_BYTES = 6 * 1024;

const painted = new Set(SMITH_HEART_AURA_IMAGE_IDS);
const aliases = new Map(SMITH_HEART_AURA_ICON_SOURCES);

describe("Smith's Heart aura art", () => {
  it('keeps 67 paintings and 24 shared aliases, sorted and disjoint', () => {
    expect(SMITH_HEART_AURA_IMAGE_IDS).toHaveLength(67);
    expect(painted.size).toBe(67);
    expect([...SMITH_HEART_AURA_IMAGE_IDS]).toEqual([...SMITH_HEART_AURA_IMAGE_IDS].sort());
    expect(SMITH_HEART_AURA_ICON_SOURCES).toHaveLength(24);
    expect(aliases.size).toBe(24);
    for (const [alias, source] of aliases) {
      expect(painted.has(alias), `${alias} is an alias, not a painting`).toBe(false);
      expect(painted.has(source), `${alias} shares a real painting (${source})`).toBe(true);
    }
  });

  it('covers only live raid aura ids, and every one of them but the documented two', () => {
    const covered = [...painted, ...aliases.keys()];
    for (const id of covered) {
      expect(LIVE_RAID_AURA_IDS.has(id), `${id} is a live raid aura id`).toBe(true);
    }
    const uncovered = [...LIVE_RAID_AURA_IDS].filter((id) => !painted.has(id) && !aliases.has(id));
    // A new raid aura fails here until it gets a painting (SMITH_HEART_AURA_IMAGE_IDS),
    // shares one (SMITH_HEART_AURA_ICON_SOURCES), or is listed in UNPAINTED with a reason.
    expect(uncovered.sort()).toEqual(Object.keys(UNPAINTED).sort());
  });

  it('resolves every painted id to its own painting through the HUD aura resolver', () => {
    for (const id of painted) {
      expect(AURA_FILE_IMAGE_IDS.has(id), id).toBe(true);
      expect(resolveHudAuraIconId({ id, kind: 'debuff' }), id).toBe(id);
      expect(auraImageUrl(id), id).toBe(`/ui/auras/${id}.webp`);
    }
  });

  it('resolves every alias to the painting it shares, whatever its kind', () => {
    for (const [alias, source] of aliases) {
      for (const kind of ['debuff', 'buff', 'shield_wall', 'internal_cd']) {
        expect(resolveHudAuraIconId({ id: alias, kind }), `${alias} (${kind})`).toBe(source);
      }
      expect(auraImageUrl(source), alias).toBe(`/ui/auras/${source}.webp`);
    }
  });

  it('ships every painting as a small opaque 128px WebP', async () => {
    let total = 0;
    for (const id of painted) {
      const file = path.join(process.cwd(), 'public/ui/auras', `${id}.webp`);
      expect(existsSync(file), id).toBe(true);
      const bytes = readFileSync(file);
      expect(bytes.length, `${id} stays under the size budget`).toBeLessThanOrEqual(MAX_ICON_BYTES);
      const meta = await sharp(bytes).metadata();
      expect(meta, id).toMatchObject({ format: 'webp', width: 128, height: 128, hasAlpha: false });
      total += bytes.length;
    }
    // All 67 together stay under 400 KB.
    expect(total).toBeLessThan(400 * 1024);
  });
});
