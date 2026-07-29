import { describe, expect, it } from 'vitest';
import { DUNGEON_X_THRESHOLD } from '../src/sim/data';
import { announceAttunement } from '../src/sim/professions/attunement_events';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { SimEvent } from '../src/sim/types';

const PAIR = 'weaponcrafting+armorcrafting';
const SMITH_MASTER = 'forgemistress_darva';
const WEAPON_ARMOR = 'weaponcrafting+armorcrafting';

function makeSim(seed = 6161): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true });
}

/** A minimal ctx exposing only what announceAttunement + emitToZonePlayers read:
 *  the live players/entities maps, an emit recorder, and the real
 *  bumpDeedStat, delegated to the live sim ctx so the attunementsCompleted
 *  counter behind prog_guildsworn lands on the real meta. */
function announceCtx(sim: Sim) {
  const emitted: SimEvent[] = [];
  const ctx = {
    players: sim.players,
    entities: sim.entities,
    emit: (e: SimEvent) => emitted.push(e),
    bumpDeedStat: sim.ctx.bumpDeedStat,
  } as unknown as SimContext;
  return { ctx, emitted };
}

function moveToNpc(sim: Sim, templateId: string, pid = sim.playerId): void {
  const npc = [...sim.entities.values()].find((e) => e.templateId === templateId);
  if (!npc) throw new Error(`${templateId} missing`);
  const player = sim.entities.get(pid);
  if (!player) throw new Error('player missing');
  player.pos.x = npc.pos.x + 1;
  player.pos.z = npc.pos.z;
}

describe('attunement celebration events (Professions 2.0)', () => {
  it('emits the personal event plus a zone broadcast for an overworld celebrant', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = sim.players.get(pid)!;
    const { ctx, emitted } = announceCtx(sim);

    announceAttunement(ctx, pid, PAIR);

    const personal = emitted.find((e) => e.type === 'attuned');
    expect(personal).toEqual({ type: 'attuned', pid, pairId: PAIR });
    // The announce site is the one bump site for the Craftsworn
    // counter, and it bumps for an overworld celebrant.
    expect(meta.deedStats.counters.attunementsCompleted).toBe(1);
    const zone = emitted.filter((e) => e.type === 'attunedZone');
    // One zone copy per overworld player in the celebrant's zone (the celebrant).
    expect(zone).toHaveLength(1);
    expect(zone[0]).toMatchObject({
      type: 'attunedZone',
      pid, // the recipient (the fanout idiom)
      celebrantPid: pid,
      celebrantName: meta.name,
      pairId: PAIR,
    });
    expect((zone[0] as { zoneId: string }).zoneId).toBeTruthy();
  });

  it('skips the zone broadcast for a celebrant in instance space (personal event only)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const player = sim.entities.get(pid)!;
    player.pos.x = DUNGEON_X_THRESHOLD + 100; // inside an instance x-band
    const { ctx, emitted } = announceCtx(sim);

    announceAttunement(ctx, pid, PAIR);

    expect(emitted.filter((e) => e.type === 'attuned')).toHaveLength(1);
    expect(emitted.filter((e) => e.type === 'attunedZone')).toHaveLength(0);
    // The bump sits BEFORE the instance-space early return, so an
    // instanced celebrant still counts toward prog_guildsworn.
    expect(sim.players.get(pid)!.deedStats.counters.attunementsCompleted).toBe(1);
  });

  it('the live quest attune path emits both events (new mode)', () => {
    const sim = makeSim();
    moveToNpc(sim, SMITH_MASTER);
    sim.acceptQuest('q_prof_attune_smith', WEAPON_ARMOR);
    const qp = sim.questLog.get('q_prof_attune_smith');
    if (!qp) throw new Error('attune quest not accepted');
    qp.counts = [...(qp.resolvedCounts ?? [])];
    qp.state = 'ready';
    moveToNpc(sim, SMITH_MASTER);
    sim.turnInQuest('q_prof_attune_smith');

    const events = sim.drainEvents();
    expect(events.some((e) => e.type === 'attuned' && e.pairId === WEAPON_ARMOR)).toBe(true);
    expect(events.some((e) => e.type === 'attunedZone' && e.pairId === WEAPON_ARMOR)).toBe(true);
  });
});
