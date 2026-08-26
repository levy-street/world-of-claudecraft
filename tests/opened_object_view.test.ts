// The per-viewer opened-object hide (src/sim/quests/opened_object_view.ts):
// a castaway crate this player already took interact credit from reads as
// gone FOR THEM (renderer mesh, coach beam and bubble, interact-key target
// scan) while staying live for everyone else. Driven through a real Sim so
// the ledger entries are the ones the actual credit path writes.

import { describe, expect, it } from 'vitest';
import { PROVING_SHORE_OBJECTS } from '../src/sim/content/proving_shore';
import {
  isObjectOpenedByViewer,
  OPENED_OBJECT_HIDE_ITEM_IDS,
} from '../src/sim/quests/opened_object_view';
import { Sim } from '../src/sim/sim';
import type { Entity, QuestProgress } from '../src/sim/types';
import { nearestCrate } from '../src/ui/coach_prompt_view';

const CRATE_ITEM = 'ps_castaway_crate';
const WRECK_QUEST = 'q_ps_the_wreck_line';

function makeSim(): Sim {
  return new Sim({ seed: 4120, playerClass: 'warrior', autoEquip: true });
}

function crates(sim: Sim): Entity[] {
  return [...sim.entities.values()].filter(
    (e) => e.kind === 'object' && e.objectItemId === CRATE_ITEM,
  );
}

/** Put the wreck-line quest straight into the log (the hide only reads the
 *  ledger, so the chain prerequisites are irrelevant here). */
function startWreckLine(sim: Sim): void {
  const meta = sim.players.get(sim.playerId)!;
  const quest = { questId: WRECK_QUEST, counts: [0], state: 'active' as const };
  meta.questLog.set(WRECK_QUEST, quest);
}

describe('isObjectOpenedByViewer', () => {
  it('hides exactly the crate this player credited, and only while the quest lives', () => {
    const sim = makeSim();
    startWreckLine(sim);
    const line = crates(sim);
    expect(line.length).toBeGreaterThanOrEqual(6);
    const [first, second] = line;

    // Nothing opened yet: nothing hidden.
    const meta = sim.players.get(sim.playerId)!;
    expect(isObjectOpenedByViewer(first, meta.questLog)).toBe(false);

    // Open the first crate through the real interact path.
    sim.player.pos.x = first.pos.x;
    sim.player.pos.z = first.pos.z;
    sim.pickUpObject(first.id);
    expect(meta.questLog.get(WRECK_QUEST)?.counts[0]).toBe(1);

    // The opened crate reads gone for this viewer; its neighbors do not.
    expect(isObjectOpenedByViewer(first, meta.questLog)).toBe(true);
    expect(isObjectOpenedByViewer(second, meta.questLog)).toBe(false);
    // An unrelated object id at the same spot is untouched.
    expect(
      isObjectOpenedByViewer({ objectItemId: 'ps_ferry_bell', pos: first.pos }, meta.questLog),
    ).toBe(false);

    // Quest gone from the log (abandon or turn-in): the crate reappears,
    // because a repeat of the quest needs it.
    meta.questLog.delete(WRECK_QUEST);
    expect(isObjectOpenedByViewer(first, meta.questLog)).toBe(false);
  });

  it('keeps hiding through the ready state, where the ledger still lives', () => {
    const sim = makeSim();
    startWreckLine(sim);
    const meta = sim.players.get(sim.playerId)!;
    const first = crates(sim)[0];
    sim.player.pos.x = first.pos.x;
    sim.player.pos.z = first.pos.z;
    sim.pickUpObject(first.id);
    meta.questLog.get(WRECK_QUEST)!.state = 'ready';
    expect(isObjectOpenedByViewer(first, meta.questLog)).toBe(true);
  });

  it('steers the coach bubble to the nearest UNOPENED crate', () => {
    const sim = makeSim();
    startWreckLine(sim);
    const meta = sim.players.get(sim.playerId)!;
    const line = crates(sim);
    const [first, second] = line;
    sim.player.pos.x = first.pos.x;
    sim.player.pos.z = first.pos.z;
    sim.pickUpObject(first.id);

    // Standing on the opened crate, the bubble points at the next one.
    const next = nearestCrate(sim.entities.values(), first.pos, meta.questLog);
    expect(next).not.toBeNull();
    expect(next!.pos).not.toEqual(first.pos);
    expect(next!.pos).toEqual(second.pos);
    // Without the ledger the scan would have picked the opened crate itself.
    expect(nearestCrate(sim.entities.values(), first.pos)!.pos).toEqual(first.pos);
  });

  it('survives the wire: a ClientWorld mirror hides the same crate', () => {
    // The online arm end to end. The server ships creditedObjects on qlog
    // (no strip), ClientWorld mirrors the row into its questLog, and the
    // same predicate reads it, so an online player sees the hide too.
    const sim = makeSim();
    startWreckLine(sim);
    const meta = sim.players.get(sim.playerId)!;
    const first = crates(sim)[0];
    sim.player.pos.x = first.pos.x;
    sim.player.pos.z = first.pos.z;
    sim.pickUpObject(first.id);

    // The wire projection the server performs, verbatim (server/game.ts
    // maybe('qlog', [...meta.questLog.values()])), through JSON.
    const wire = JSON.parse(JSON.stringify([...meta.questLog.values()])) as QuestProgress[];
    const mirrored = new Map(wire.map((q) => [q.questId, q]));
    expect(mirrored.get(WRECK_QUEST)?.creditedObjects?.length).toBeGreaterThan(0);
    expect(isObjectOpenedByViewer(first, mirrored)).toBe(true);
    expect(isObjectOpenedByViewer(crates(sim)[1], mirrored)).toBe(false);
  });

  it('hides only for the viewer who opened it, never for a second player', () => {
    // The headline multi-viewer claim: the crate stays live for everybody
    // else, which is why the sim keeps the object rather than consuming it.
    const sim = makeSim();
    startWreckLine(sim);
    const opener = sim.players.get(sim.playerId)!;
    const first = crates(sim)[0];
    sim.player.pos.x = first.pos.x;
    sim.player.pos.z = first.pos.z;
    sim.pickUpObject(first.id);

    const otherPid = sim.addPlayer('mage', 'Bystander');
    const other = sim.players.get(otherPid)!;
    other.questLog.set(WRECK_QUEST, { questId: WRECK_QUEST, counts: [0], state: 'active' });
    expect(isObjectOpenedByViewer(first, opener.questLog)).toBe(true);
    expect(isObjectOpenedByViewer(first, other.questLog)).toBe(false);
    // ...and the object is genuinely still there to open.
    expect(crates(sim).some((c) => c.id === first.id && !c.dead)).toBe(true);
  });

  it("hides ONLY the crate class, never another quest's interact object", () => {
    // The scope decision: the predicate keys on an opt-in content list, so
    // ringing one watchbell of three does not make it vanish (its quest
    // wants you to see all three), while an opened crate does disappear.
    expect(OPENED_OBJECT_HIDE_ITEM_IDS).toEqual(new Set([CRATE_ITEM]));
    const qp = new Map([
      ['q_fs_the_three_bells', { state: 'active', creditedObjects: ['0@256.0,0.0'] } as const],
    ]);
    expect(
      isObjectOpenedByViewer({ objectItemId: 'gullhaven_watchbell', pos: { x: 256, z: 0 } }, qp),
    ).toBe(false);
  });

  it('the authored crate line and the live roster agree on positions', () => {
    // The ledger keys on authored spawn positions; a drifted spawn would
    // silently stop matching, so pin the entity roster to the content.
    const authored = PROVING_SHORE_OBJECTS.find((o) => o.itemId === CRATE_ITEM)!.positions;
    const live = crates(makeSim()).map((e) => ({ x: e.pos.x, z: e.pos.z }));
    for (const pos of authored) {
      expect(live).toContainEqual(pos);
    }
  });
});
