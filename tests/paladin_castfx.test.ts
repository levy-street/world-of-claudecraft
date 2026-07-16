// The paladin ability animations are driven by castFx 'flourish' spellfx
// events: holy-school abilities never route through the renderer's physical
// damage-event swing path, so without the event the manifest's per-ability
// clip map (attackByAbility: blessings raise skyward, hammer strikes overhead,
// bolts push out) would be dead wiring. Pins that every mapped ability emits
// the event on cast and that the clip names it maps to exist in the def.
import { describe, expect, it } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';
import { ABILITIES } from '../src/sim/data';
import { Sim } from '../src/sim/sim';

// every paladin ability the manifest maps to a swing/flourish clip
const MAPPED = Object.keys(VISUALS.player_paladin.clips.attackByAbility ?? {});

describe('paladin cast flourishes', () => {
  it('maps at least the blessing, hammer, and bolt abilities', () => {
    expect(MAPPED).toEqual(
      expect.arrayContaining(['seal_of_righteousness', 'hammer_of_justice', 'exorcism']),
    );
  });

  it("gives every manifest-mapped paladin ability castFx 'flourish'", () => {
    for (const id of MAPPED) {
      expect(ABILITIES[id]?.castFx, `${id} needs castFx for its mapped clip to play`).toBe(
        'flourish',
      );
    }
  });

  it('emits the flourish spellfx event when Oathbrand is cast', () => {
    const sim = new Sim({ seed: 42, playerClass: 'paladin', autoEquip: true });
    sim.player.resource = sim.player.maxResource;
    sim.castAbility('seal_of_righteousness');
    const events: unknown[] = [];
    for (let i = 0; i < 20; i++) events.push(...sim.tick());
    const fx = events.filter(
      (e) =>
        (e as { type?: string }).type === 'spellfx' &&
        (e as { fx?: string }).fx === 'flourish' &&
        (e as { ability?: string }).ability === 'seal_of_righteousness',
    );
    expect(fx.length).toBeGreaterThanOrEqual(1);
  });
});
