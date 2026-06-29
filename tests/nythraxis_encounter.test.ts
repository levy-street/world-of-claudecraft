// Direct unit tests for the extracted Nythraxis encounter module (N1). These import
// the module functions and drive them against a real Sim's SimContext, asserting the
// behaviors the parity full-pull golden covers end to end: the CC-immunity predicates,
// the 70% phase transition (room stun + Aldric + lit wardstones), the Soul Rend rng.int
// marks pick, the Deathless Rage wardstone-channel interrupt, the same-item-id ward
// fall-through, and the raid lockout grant.

import { describe, expect, it } from 'vitest';
import * as nythraxis from '../src/sim/encounters/nythraxis';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { dist2d, type Entity, NYTHRAXIS_ADD_ID, NYTHRAXIS_BOSS_ID } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

const ctxOf = (sim: Sim): SimContext => (sim as unknown as { ctx: SimContext }).ctx;

function teleport(sim: AnySim, e: AnyEntity, x: number, z: number, y?: number): void {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = y ?? groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  sim.rebucket(e);
}

// Enter the Nythraxis arena with a full attuned raid, then pull the tank + four mages
// into the throne room so playersInNythraxisRoom sees them (enterDungeon only places
// the entering tank, at the door).
function setup() {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true }) as AnySim;
  const tankPid = sim.addPlayer('warrior', 'Tank') as number;
  sim.players.get(tankPid)!.questsDone.add('q_nythraxis_bound_guardian');
  const dpsPids: number[] = [];
  for (let i = 0; i < 4; i++) {
    const pid = sim.addPlayer('mage', `Dps${i}`) as number;
    sim.partyInvite(pid, tankPid);
    sim.partyAccept(pid);
    dpsPids.push(pid);
  }
  sim.convertPartyToRaid(tankPid);
  sim.enterDungeon('nythraxis_boss_arena', tankPid);
  const tank = sim.entities.get(tankPid) as AnyEntity;
  const boss = [...sim.entities.values()].find(
    (e: AnyEntity) => e.kind === 'mob' && e.templateId === NYTHRAXIS_BOSS_ID && !e.dead,
  ) as AnyEntity;
  teleport(sim, tank, boss.pos.x, boss.pos.z - 6, boss.pos.y);
  const dps = dpsPids.map((pid) => sim.entities.get(pid) as AnyEntity);
  dps.forEach((e, i) => {
    teleport(sim, e, boss.spawnPos.x + (i - 1.5), boss.spawnPos.z - 20, boss.pos.y);
  });
  // engage so the encounter keeps the boss locked on the tank.
  boss.inCombat = true;
  boss.aiState = 'attack';
  boss.aggroTargetId = tank.id;
  boss.threat.set(tank.id, 1000);
  return { sim, ctx: ctxOf(sim), tank, dps, boss };
}

describe('Nythraxis encounter module (N1)', () => {
  it('CC-immunity predicates classify raid enemies, control auras, and the scripted stun', () => {
    const { ctx, boss } = setup();
    expect(nythraxis.isNythraxisRaidEnemy(boss)).toBe(true);
    expect(nythraxis.isNythraxisRaidEnemy({ kind: 'player' } as Entity)).toBe(false);
    // isNythraxisControlAura adds 'slow' on top of the general control kinds via ctx.
    expect(nythraxis.isNythraxisControlAura(ctx, 'slow')).toBe(true);
    expect(nythraxis.isNythraxisControlAura(ctx, 'stun')).toBe(true);
    expect(nythraxis.isNythraxisControlAura(ctx, 'dot')).toBe(false);
    // The transition stun is the one scripted control that lands on adds / pets.
    const add = { kind: 'mob', templateId: NYTHRAXIS_ADD_ID, ownerId: null } as Entity;
    expect(
      nythraxis.isNythraxisScriptedControl(add, { id: 'nythraxis_transition_stun' } as never),
    ).toBe(true);
    expect(nythraxis.isNythraxisScriptedControl(add, { id: 'frost_nova' } as never)).toBe(false);
  });

  it('transitions to phase two at 70%: room War Stomp stun + Aldric + lit wardstones', () => {
    const { ctx, boss, tank } = setup();
    boss.hp = Math.floor(boss.maxHp * 0.69);
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(boss.nythraxis?.phase).toBe('transition');
    expect(tank.auras.some((a) => a.id === 'nythraxis_transition_stun')).toBe(true);
    const aldric = [...ctx.entities.values()].find(
      (e) => e.templateId === 'brother_aldric_raid' && !e.dead,
    );
    expect(aldric?.kind).toBe('npc');
    const wards = [...ctx.entities.values()].filter(
      (e) =>
        e.kind === 'object' &&
        e.objectItemId === 'bastion_ward_stone' &&
        dist2d(e.pos, boss.spawnPos) < 100,
    );
    expect(wards.length).toBe(3);
    expect(wards.every((w) => w.auras.some((a) => a.id === 'nythraxis_wardstone_lit'))).toBe(true);
  });

  it('Soul Rend marks up to three distinct non-tank players (the rng.int pick)', () => {
    const { ctx, boss, tank, dps } = setup();
    const st = nythraxis.initNythraxisEncounter(boss);
    st.phase = 2;
    nythraxis.castNythraxisSoulRend(ctx, boss, st);
    expect(st.soulRendMarks.length).toBe(3);
    const markedIds = st.soulRendMarks.map((m) => m.playerId);
    expect(new Set(markedIds).size).toBe(3); // distinct
    expect(markedIds).not.toContain(tank.id); // never the aggro target
    for (const id of markedIds) expect(dps.some((d) => d.id === id)).toBe(true);
    // The marked players carry the Soul Rend vulnerability aura.
    for (const id of markedIds) {
      const p = ctx.entities.get(id) as AnyEntity;
      expect(p.auras.some((a) => a.id === 'nythraxis_soul_rend')).toBe(true);
    }
  });

  it('a three-player wardstone channel interrupts Deathless Rage and self-stuns the boss', () => {
    const { sim, ctx, boss, dps } = setup();
    const st = nythraxis.initNythraxisEncounter(boss);
    st.phase = 2;
    nythraxis.startNythraxisDeathlessRage(ctx, boss, st);
    expect(st.deathlessCastRemaining).toBeGreaterThan(0);
    expect(st.wardChannels.length).toBe(3);
    const wards = [...ctx.entities.values()]
      .filter(
        (e) =>
          e.kind === 'object' &&
          e.objectItemId === 'bastion_ward_stone' &&
          dist2d(e.pos, boss.spawnPos) < 100,
      )
      .sort((a, b) => a.id - b.id) as AnyEntity[];
    // Three distinct players each claim a distinct wardstone via the object-click entry.
    wards.forEach((ward, i) => {
      const channeler = dps[i];
      teleport(sim, channeler, ward.pos.x, ward.pos.z, ward.pos.y);
      const handled = nythraxis.tryStartNythraxisWardChannel(ctx, ward, channeler);
      expect(handled).toBe(true);
    });
    // Mark every channel complete (the per-tick channel progress is covered by the
    // parity golden) and run one Deathless Rage tick: the interrupt should fire.
    for (const c of st.wardChannels) c.complete = true;
    nythraxis.updateNythraxisDeathlessRage(ctx, boss, st);
    expect(st.deathlessStunRemaining).toBeGreaterThan(0);
    expect(st.deathlessCastRemaining).toBe(0);
    expect(boss.auras.some((a) => a.id === 'nythraxis_deathless_stun')).toBe(true);
  });

  it('a wardstone with no boss in range falls through (overworld Sunken Bastion stone)', () => {
    const { ctx, dps } = setup();
    // A lone ward stone far from any Nythraxis boss: tryStart must return false so the
    // normal quest pickup runs (same objectItemId, not a raid wardstone).
    const lone = {
      kind: 'object',
      objectItemId: 'bastion_ward_stone',
      pos: { x: -5000, y: 0, z: -5000 },
    } as Entity;
    expect(nythraxis.tryStartNythraxisWardChannel(ctx, lone, dps[0])).toBe(false);
    // A non-wardstone object also falls through.
    const other = { kind: 'object', objectItemId: 'iron_ore', pos: { x: 0, y: 0, z: 0 } } as Entity;
    expect(nythraxis.tryStartNythraxisWardChannel(ctx, other, dps[0])).toBe(false);
  });

  it('grants the 24h raid lockout to every player in the room on kill', () => {
    const { sim, ctx, boss, tank, dps } = setup();
    nythraxis.grantNythraxisLockout(ctx, boss);
    for (const e of [tank, ...dps]) {
      const meta = sim.players.get(e.id);
      expect(meta?.raidLockouts.has('nythraxis_boss_arena')).toBe(true);
      expect(meta?.raidLockouts.get('nythraxis_boss_arena')).toBeGreaterThan(ctx.lockoutNowMs());
    }
  });
});
