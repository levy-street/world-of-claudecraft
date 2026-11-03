// Right-click cancel for the Gourdlight Eve cosmetics (src/sim/seasonal/seasonal_cancel.ts
// via combat/aura_cancel_command.ts): a costume draught's body and the worn pumpkin head
// come off through the same authoritative Sim.cancelAura the buff bar calls, offline, on
// the server and in the env. The head's ledger flag clears so it stays off, and the
// cosmetics stay undispellable for every counter that is not their wearer.
import { afterEach, describe, expect, it } from 'vitest';
import { isCancelableAura } from '../src/sim/combat/aura_cancel';
import {
  CARVED_PUMPKIN_HEAD_ID,
  GOURDLIGHT_COSTUMES,
  PUMPKIN_HEAD_AURA_ID,
} from '../src/sim/content/gourdlight_eve';
import { syncSeasonalDecorColliders } from '../src/sim/seasonal_decor_colliders';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';
import { WORLD_SEED } from '../src/sim/world_seed';

afterEach(() => syncSeasonalDecorColliders(WORLD_SEED, null));

function openWorld(): Sim {
  const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', devCommands: true });
  sim.resetDay = '2026-10-20';
  sim.chat('/dev season on');
  sim.tick();
  return sim;
}

const has = (sim: Sim, id: string) => sim.player.auras.some((a) => a.id === id);

describe('right-click cancel of the Gourdlight Eve cosmetics', () => {
  it('a costume draught body comes off and announces the fade', () => {
    const sim = openWorld();
    const c = GOURDLIGHT_COSTUMES[0];
    sim.addItem(c.itemId, 1);
    sim.useItem(c.itemId);
    const aura = sim.player.auras.find((a) => a.id === c.auraId);
    expect(aura).toBeDefined();
    expect(isCancelableAura(aura!)).toBe(true);
    sim.tick();
    sim.cancelAura(c.auraId);
    const events = sim.tick();
    expect(has(sim, c.auraId)).toBe(false);
    expect(
      events.some((e: SimEvent) => e.type === 'aura' && !e.gained && e.name === aura!.name),
    ).toBe(true);
    // the draught was spent on use; cancelling never refunds it
    expect(sim.countItem(c.itemId)).toBe(0);
  });

  it('the worn pumpkin head comes off and stays off (the ledger flag clears)', () => {
    const sim = openWorld();
    sim.addItem(CARVED_PUMPKIN_HEAD_ID, 1);
    sim.useItem(CARVED_PUMPKIN_HEAD_ID);
    sim.tick();
    expect(has(sim, PUMPKIN_HEAD_AURA_ID)).toBe(true);
    sim.cancelAura(PUMPKIN_HEAD_AURA_ID);
    const events = sim.tick();
    expect(has(sim, PUMPKIN_HEAD_AURA_ID)).toBe(false);
    expect(events.some((e: SimEvent) => e.type === 'seasonal' && e.what === 'pumpkinOff')).toBe(
      true,
    );
    // the season tick would re-apply a still-worn head; several ticks later it is off
    for (let i = 0; i < 40; i++) sim.tick();
    expect(has(sim, PUMPKIN_HEAD_AURA_ID)).toBe(false);
    expect((sim as any).players.get(sim.playerId).pumpkinHeadWorn).toBe(false);
    // the item stays in the bag, so the head can be put back on
    expect(sim.countItem(CARVED_PUMPKIN_HEAD_ID)).toBe(1);
    sim.useItem(CARVED_PUMPKIN_HEAD_ID);
    sim.tick();
    expect(has(sim, PUMPKIN_HEAD_AURA_ID)).toBe(true);
  });

  it('cancelling a cosmetic not worn is a harmless no-op', () => {
    const sim = openWorld();
    const before = sim.player.auras.map((a) => a.id);
    sim.cancelAura(GOURDLIGHT_COSTUMES[1].auraId);
    sim.cancelAura(PUMPKIN_HEAD_AURA_ID);
    expect(sim.player.auras.map((a) => a.id)).toEqual(before);
  });

  it('only the seasonal cosmetic kind opts past undispellable; other undispellable buffs stay', () => {
    const base = {
      id: 'x',
      kind: 'buff_ap' as const,
      value: 10,
      undispellable: true as const,
    };
    expect(isCancelableAura(base)).toBe(false);
    expect(isCancelableAura({ ...base, kind: 'seasonal_cosmetic' as const, value: 0 })).toBe(true);
    // an encounter-owned look is the encounter's to lift, never its wearer's
    expect(
      isCancelableAura({
        ...base,
        kind: 'seasonal_cosmetic' as const,
        value: 0,
        encounterOwned: true as const,
      }),
    ).toBe(false);
  });
});
