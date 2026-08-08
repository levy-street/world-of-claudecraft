import { describe, expect, it } from 'vitest';
import { LEVEL_CAP, RIDING_MIN_LEVEL, RIFT_MIN_LEVEL, ZONE_TEASERS } from '../src/guide/data';
import { ZONES } from '../src/sim/data';
import { MOUNT_TRAIN_MIN_LEVEL } from '../src/sim/mounts_training';
import { RIFT_MIN_LEVEL as SIM_RIFT_MIN_LEVEL } from '../src/sim/rift/portals';
import { MAX_LEVEL } from '../src/sim/types';

// The level literals in src/guide/data.ts are hand-duplicated, not derived from the sim
// (the guide never imports the live world): LEVEL_CAP mirrors MAX_LEVEL, RIFT_MIN_LEVEL
// mirrors the rift portal gate, and RIDING_MIN_LEVEL mirrors the mount trainer's gate.
// Guide surfaces render the hand copy directly (home, progression, faq, combat, rifts,
// mounts, and the SEO JSON-LD in head.ts), so a sim level change would silently strand
// the guide showing a stale number until a human noticed, the same way CLASS_CHIPS
// drifted before class_colors.test.ts pinned it. This suite is that guard: any drift
// between the two copies fails CI.

// ZONE_TEASERS used to be a hand-written subset that listed eight of the fourteen
// zones and had to be pinned to the sim through a hand-maintained slug -> ZoneDef.id
// map. It is now DERIVED from the generated zone list, so the guard changes shape: the
// invariant worth pinning is no longer "each curated row resolves" but "the derivation
// covers the whole world, with the real bands, under distinct slugs". Bands are
// compared as a multiset against ZONES rather than re-resolved through the same slug
// map data.ts uses, so this stays a comparison against the sim and not against itself.
describe('guide level cap and zone band freshness', () => {
  it('LEVEL_CAP matches the sim MAX_LEVEL', () => {
    expect(LEVEL_CAP).toBe(MAX_LEVEL);
  });

  it('RIFT_MIN_LEVEL matches the sim rift portal gate, and the cap the rifts page claims', () => {
    expect(RIFT_MIN_LEVEL).toBe(SIM_RIFT_MIN_LEVEL);
    // guide.riftsPage.levelNote reads "You have to be at the level cap, level {n}". That
    // sentence is only true while the two constants agree, so the copy's own premise is
    // pinned here: raise MAX_LEVEL without moving the rift gate and this reds, which is
    // the signal to reword the note rather than ship a page that lies.
    expect(RIFT_MIN_LEVEL).toBe(MAX_LEVEL);
  });

  it('RIDING_MIN_LEVEL matches the sim mount training gate', () => {
    expect(RIDING_MIN_LEVEL).toBe(MOUNT_TRAIN_MIN_LEVEL);
  });

  it('gives every sim zone exactly one teaser, under a distinct slug', () => {
    expect(ZONE_TEASERS.length, 'one teaser per sim zone').toBe(ZONES.length);
    const ids = ZONE_TEASERS.map((z) => z.id);
    // The Farshore shares the Vale's biome. A slug collision would make two zones share
    // one name/blurb key pair, which is exactly the bug the world page shipped.
    expect(new Set(ids).size, `ZONE_TEASERS slugs must be unique: ${ids.join(', ')}`).toBe(
      ids.length,
    );
    expect(ids).toContain('vale');
    expect(ids).toContain('farshore');
  });

  it('ZONE_TEASERS level bands match the sim ZoneDef.levelRange set', () => {
    const band = (min: number, max: number) => `${min}-${max}`;
    const fromGuide = ZONE_TEASERS.map((t) => band(t.min, t.max)).sort();
    const fromSim = ZONES.map((z) => band(z.levelRange[0], z.levelRange[1])).sort();
    expect(fromGuide, 'guide teaser bands vs sim zone bands').toEqual(fromSim);
  });

  it('names every teaser through its own slug-derived key pair', () => {
    for (const t of ZONE_TEASERS) {
      expect(t.nameKey, `name key for "${t.id}"`).toBe(`guide.home.world.${t.id}Name`);
      expect(t.blurbKey, `blurb key for "${t.id}"`).toBe(`guide.home.world.${t.id}Blurb`);
    }
  });
});
