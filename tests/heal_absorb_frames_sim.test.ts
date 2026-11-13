// The heal absorb a unit frame draws is readable from the sim on every frame
// source: the live entity (player and target frames, both hosts: the aura's
// `value` rides the entity wire) and the party projection both hosts share
// (partyFrameAbsorbs: offline collectPartyInfo and the server party wire). Pinned
// over the two real encounter heal absorbs, the Quench Guardian's Living Rime and
// Final Hammer's Stone Shell, and over a real Sim party.

import { describe, expect, it } from 'vitest';
import { applyHeal } from '../src/sim/combat/heal';
import { FINAL_AURAS } from '../src/sim/encounters/smith_heart/final_ids';
import { QUENCH_AURAS, QUENCH_TUNING as T } from '../src/sim/encounters/smith_heart/quench_ids';
import {
  collectPartyInfo,
  partyFrameAbsorbs,
  partyFrameHealAbsorb,
} from '../src/sim/party_frame_info';
import { Sim } from '../src/sim/sim';
import { DT, type Entity } from '../src/sim/types';
import { type UnitFrameDescriptor, unitFrameView } from '../src/ui/unit_frame';
import { finalFight } from './helpers/final_fight';
import { quenchFight } from './helpers/quench_fight';

const ticks = (s: number) => Math.round(s / DT);

/** The player/target frame read: the live entity as the shield input. */
function frameOf(e: Entity) {
  const d: UnitFrameDescriptor = {
    present: true,
    hpFrac: e.hp / e.maxHp,
    hpText: '',
    resourceKind: 'none',
    resFrac: 0,
    resText: '',
    levelText: null,
    name: e.name,
    portraitKey: 'e',
    absorb: e,
    dead: e.dead,
    outOfRange: false,
  };
  return unitFrameView(d).healAbsorb;
}

/** The party-row read: the wire total fed back through the row's descriptor. */
function partyRowOf(e: Entity) {
  const wire = partyFrameAbsorbs(e.auras);
  const d: UnitFrameDescriptor = {
    present: true,
    hpFrac: e.hp / e.maxHp,
    hpText: '',
    resourceKind: 'none',
    resFrac: 0,
    resText: '',
    levelText: null,
    name: e.name,
    portraitKey: 'e',
    absorb: null,
    healAbsorb: { hp: e.hp, maxHp: e.maxHp, healTotal: wire.healAbsorb ?? 0 },
    dead: e.dead,
    outOfRange: false,
  };
  return { wire, view: unitFrameView(d).healAbsorb };
}

describe('Living Rime reaches every frame source', () => {
  it('shows the crust left, shrinks as healing lands, and clears when it breaks', () => {
    const f = quenchFight(6);
    expect(f.dev('/dev heart quench pull')).toBe(true);
    f.tick(ticks(T.rimRise) + 2);
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.breathTimer = 999;
    st.slashTimer = 999;
    let carrier: Entity | undefined;
    for (let i = 0; i < ticks(20) && !carrier; i++) {
      f.tick(1);
      carrier = f.players.find((p) => p.auras.some((a) => a.id === QUENCH_AURAS.rime));
    }
    if (!carrier) throw new Error('no rime');
    const crust = carrier.auras.find((a) => a.id === QUENCH_AURAS.rime);
    const whole = crust?.value ?? 0;
    expect(whole).toBeGreaterThan(0);

    expect(partyFrameHealAbsorb(carrier.auras)).toBe(whole);
    expect(frameOf(carrier)).toMatchObject({ on: true, text: String(whole) });
    const row = partyRowOf(carrier);
    expect(row.wire.healAbsorb).toBe(whole);
    expect(row.view).toMatchObject({ on: true, text: String(whole) });

    // A third of it healed: every source reads the rest.
    const healer = f.players.find((p) => p.id !== carrier?.id) as Entity;
    const bite = Math.floor(whole / 3);
    applyHeal(f.sim.ctx, healer, carrier, bite, 'Test Mend', null, false);
    const left = whole - bite;
    expect(frameOf(carrier).text).toBe(String(left));
    expect(partyRowOf(carrier).wire.healAbsorb).toBe(left);

    // Healed through: gone everywhere, and the wire drops the field.
    applyHeal(f.sim.ctx, healer, carrier, left, 'Test Mend', null, false);
    expect(frameOf(carrier).on).toBe(false);
    expect(partyRowOf(carrier).wire).not.toHaveProperty('healAbsorb');
  });
});

describe('Stone Shell reaches every frame source', () => {
  it('the shelled players read their shell on the frame and the party wire', () => {
    const f = finalFight(5);
    f.dev('/dev heart final heroic');
    f.pullIn('hammer');
    f.dev('/dev heart final shell');
    const shelled = f.players.filter((p) => p.auras.some((a) => a.id === FINAL_AURAS.shell));
    expect(shelled.length).toBeGreaterThan(0);
    for (const p of shelled) {
      const shell = p.auras.find((a) => a.id === FINAL_AURAS.shell);
      const amount = shell?.value ?? 0;
      expect(amount).toBeGreaterThan(0);
      expect(frameOf(p)).toMatchObject({ on: true, text: String(amount) });
      expect(partyRowOf(p).wire.healAbsorb).toBe(amount);
    }
    // The unshelled read nothing (and carry no wire field).
    const clear = f.players.find((p) => !shelled.includes(p));
    if (clear) {
      expect(frameOf(clear).on).toBe(false);
      expect(partyRowOf(clear).wire).not.toHaveProperty('healAbsorb');
    }
  });
});

describe('collectPartyInfo: the offline party row carries the heal absorb', () => {
  it('a partied ally under a heal absorb reports it beside the shield total', () => {
    const sim = new Sim({ seed: 7, playerClass: 'priest' });
    const allyId = sim.addPlayer('warrior', 'Ally');
    sim.partyInvite(allyId, sim.playerId);
    sim.partyAccept(allyId);
    const ally = sim.entities.get(allyId) as Entity;
    sim.ctx.applyAura(ally, {
      id: QUENCH_AURAS.rime,
      name: 'Living Rime',
      kind: 'heal_absorb',
      remaining: 10,
      duration: 10,
      value: 420,
      sourceId: 0,
      school: 'frost',
    });
    const info = collectPartyInfo(sim.ctx);
    const row = info?.members.find((m) => m.pid === allyId);
    expect(row?.healAbsorb).toBe(420);
    expect(row?.absorb).toBe(0);
    const self = info?.members.find((m) => m.pid === sim.playerId);
    expect(self).not.toHaveProperty('healAbsorb');
  });
});
