// Guard: the level-20 armor set is gated by the SIM, not by the HUD.
//
// The client hides the toggle below the unlock level, but a crafted
// `{cmd:'change_skin', catalog:'armored'}` bypasses the HUD entirely, so the Sim is
// where the rule has to live. Both hosts run this Sim, so one gate covers the
// offline world and the authoritative server.
//
// The Fiesta case is the subtle one: a bout standardizes every fighter to level 20
// and stashes the real level in `PlayerMeta.fiestaRestore`. Reading `Entity.level`
// alone would let a level-3 player queue a 2v2 and walk out permanently armored,
// because the catalog is not part of the pre-bout snapshot `serializeCharacter`
// persists. `src/sim/deeds.ts` refuses level deeds mid-bout for the same reason.
import { describe, expect, it } from 'vitest';
import {
  ARMOR_SET_UNLOCK_LEVEL,
  canWearArmorSet,
  effectiveCosmeticLevel,
} from '../src/sim/content/skins';
import { Sim } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';

const makeSim = (cls: PlayerClass = 'warrior') =>
  new Sim({ seed: 42, playerClass: cls, autoEquip: true });

/** fiestaStandardize is Sim-private; a bout reaches it through the SimContext seam,
 *  so a test drives it the same way rather than widening the class surface. */
const standardizeForBout = (sim: Sim, meta: unknown, e: unknown): void => {
  (sim as unknown as { fiestaStandardize(m: unknown, en: unknown): void }).fiestaStandardize(
    meta,
    e,
  );
};

describe('armor-set unlock rules', () => {
  it('unlocks at exactly level 20', () => {
    expect(ARMOR_SET_UNLOCK_LEVEL).toBe(20);
    expect(canWearArmorSet(19)).toBe(false);
    expect(canWearArmorSet(20)).toBe(true);
    expect(canWearArmorSet(60)).toBe(true);
    // Junk in, refusal out: never treat a missing level as unlocked.
    expect(canWearArmorSet(Number.NaN)).toBe(false);
    expect(canWearArmorSet(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('reads through a Fiesta standardization to the real level', () => {
    // No bout: the entity level is the real one.
    expect(effectiveCosmeticLevel(7, undefined)).toBe(7);
    // Mid-bout: the entity says 20, the stash says 3, and 3 is the truth.
    expect(effectiveCosmeticLevel(20, 3)).toBe(3);
    // A genuinely level-20 fighter in a bout is still level 20.
    expect(effectiveCosmeticLevel(20, 20)).toBe(20);
  });
});

describe('Sim.setPlayerSkin armor gate', () => {
  it('refuses the armored catalog below the unlock level', () => {
    const sim = makeSim();
    sim.setPlayerLevel(19);

    expect(sim.setPlayerSkin(sim.playerId, 0, 'armored')).toBe(false);
    expect(sim.players.get(sim.playerId)?.skinCatalog).toBe('class');
    expect(sim.entities.get(sim.playerId)?.skinCatalog).toBe('class');
  });

  it('allows it at the unlock level', () => {
    const sim = makeSim();
    sim.setPlayerLevel(20);

    expect(sim.setPlayerSkin(sim.playerId, 0, 'armored')).toBe(true);
    expect(sim.players.get(sim.playerId)?.skinCatalog).toBe('armored');
    expect(sim.entities.get(sim.playerId)?.skinCatalog).toBe('armored');
  });

  it('refuses a low-level player standardized to 20 by a Fiesta bout', () => {
    const sim = makeSim();
    sim.setPlayerLevel(3);
    const meta = sim.players.get(sim.playerId);
    const e = sim.entities.get(sim.playerId);
    if (!meta || !e) throw new Error('player missing');

    standardizeForBout(sim, meta, e);
    // The bout really did move the entity level, which is what makes this a hole.
    expect(e.level).toBe(20);
    expect(meta.fiestaRestore?.level).toBe(3);

    expect(sim.setPlayerSkin(sim.playerId, 0, 'armored')).toBe(false);
    expect(meta.skinCatalog).toBe('class');
  });

  it('still allows a genuinely level-20 player inside a bout', () => {
    const sim = makeSim();
    sim.setPlayerLevel(20);
    const meta = sim.players.get(sim.playerId);
    const e = sim.entities.get(sim.playerId);
    if (!meta || !e) throw new Error('player missing');

    standardizeForBout(sim, meta, e);

    expect(sim.setPlayerSkin(sim.playerId, 0, 'armored')).toBe(true);
    expect(meta.skinCatalog).toBe('armored');
  });

  it('carries the class chroma through the armored catalog, losslessly', () => {
    const sim = makeSim();
    sim.setPlayerLevel(20);
    sim.setPlayerSkin(sim.playerId, 2, 'class');

    // Equipping the set must remember the chroma, or toggling it off would dump the
    // player back on the default look.
    expect(sim.setPlayerSkin(sim.playerId, 2, 'armored')).toBe(true);
    expect(sim.players.get(sim.playerId)?.skin).toBe(2);

    expect(sim.setPlayerSkin(sim.playerId, 2, 'class')).toBe(true);
    expect(sim.players.get(sim.playerId)?.skin).toBe(2);
  });

  it('never gates the class or mech catalogs on level', () => {
    const sim = makeSim();
    sim.setPlayerLevel(1);

    expect(sim.setPlayerSkin(sim.playerId, 1, 'class')).toBe(true);
    expect(sim.setPlayerSkin(sim.playerId, 0, 'mech')).toBe(true);
  });
});
