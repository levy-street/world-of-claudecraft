// The Proving Shore ferry premise, pinned BEHAVIORALLY (11m QA): the R22
// reachability predicate in tests/harvest_geography.test.ts admits the island
// as an ordinary open-world zone because interactions/ferry_bell.ts routes
// EITHER bell to the other shore with combat as the only refusal. Until this
// file, that premise lived in comments plus a content pin on the bell
// placements (tests/proving_shore_content.test.ts): a graduation gate added
// to tryRingFerryBell tomorrow would have redded nothing, and the island's
// camps would have kept counting toward harvest floors a gated player cannot
// reach. Rides go through the REAL click path (sim.pickUpObject), the same
// route interaction.ts takes, not a direct call with a faked context.

import { describe, expect, it } from 'vitest';
import { isOnProvingShore } from '../src/sim/content/proving_shore';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

function makeSim(seed = 4121): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true });
}

function bells(sim: Sim): { island: Entity; town: Entity } {
  const all = [...sim.entities.values()].filter(
    (e) => e.kind === 'object' && e.objectItemId === 'ps_ferry_bell',
  );
  expect(all).toHaveLength(2);
  const island = all.find((b) => isOnProvingShore(b.pos.x, b.pos.z));
  const town = all.find((b) => !isOnProvingShore(b.pos.x, b.pos.z));
  if (!island || !town) throw new Error('expected one ferry bell per shore');
  return { island, town };
}

function standAt(sim: Sim, bell: Entity): Entity {
  const p = sim.entities.get(sim.playerId);
  if (!p) throw new Error('no player');
  p.pos.x = bell.pos.x + 1;
  p.pos.z = bell.pos.z;
  p.prevPos = { ...p.pos };
  return p;
}

describe('the ferry bells are an ungated two-way crossing', () => {
  it('either bell sails a character with ZERO rail progress, both directions', () => {
    const sim = makeSim();
    const meta = sim.players.get(sim.playerId);
    if (!meta) throw new Error('no player meta');
    // The premise character: no Proving Shore quest accepted or done, so a
    // graduation gate of any shape would refuse this ride.
    expect(meta.questsDone.size).toBe(0);
    const { island, town } = bells(sim);
    const p = standAt(sim, island);
    sim.pickUpObject(island.id);
    expect(isOnProvingShore(p.pos.x, p.pos.z), 'island bell lands in town').toBe(false);
    standAt(sim, town);
    sim.pickUpObject(town.id);
    expect(isOnProvingShore(p.pos.x, p.pos.z), 'town bell lands on the island').toBe(true);
    // Round trip again from the island: the crossing is repeatable, not a
    // one-shot escort.
    standAt(sim, island);
    sim.pickUpObject(island.id);
    expect(isOnProvingShore(p.pos.x, p.pos.z)).toBe(false);
  });

  it('combat is the ONLY refusal: an in-combat ring holds position, out of combat it sails', () => {
    const sim = makeSim();
    const { island } = bells(sim);
    const p = standAt(sim, island);
    p.inCombat = true;
    sim.pickUpObject(island.id);
    expect(isOnProvingShore(p.pos.x, p.pos.z), 'in combat the crossing refuses').toBe(true);
    p.inCombat = false;
    sim.pickUpObject(island.id);
    expect(isOnProvingShore(p.pos.x, p.pos.z), 'the same click sails once combat ends').toBe(false);
  });
});
