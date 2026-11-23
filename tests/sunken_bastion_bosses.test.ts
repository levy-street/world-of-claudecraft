// The Sunken Bastion bosses (src/sim/encounters/sunken_bastion): each core, its
// counterplay, its heroic twists, the reset on a wipe, and the deed each kill
// can earn. Driven through full Sim ticks inside a real claimed Bastion with a
// real party, the trash cleared so nothing else joins the fight.

import { describe, expect, it } from 'vitest';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  CROWN,
  FOG_SHADE_ID,
  inBeam,
  OLEN_ID,
  VAEL_DROWNING_HYMN,
  VAEL_EXPOSED,
  VAEL_FOG_VEIL,
  VAEL_ID,
  VAEL_MIST_SURGE,
  VAEL_STAGGER,
  VAEL_TUNING,
  VAEL_VEIL_RISE,
  veilBeamYaw,
} from '../src/sim/encounters/sunken_bastion';
import { claimedInstanceAt, enterDungeon } from '../src/sim/instances/dungeons';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import { DT, type Entity } from '../src/sim/types';

interface Fight {
  sim: Sim;
  inst: InstanceSlot;
  ox: number;
  oz: number;
  tank: Entity;
  others: Entity[];
}

const BOSSES = new Set([OLEN_ID, 'gaoler_ossick', VAEL_ID]);

function fight(difficulty: 'normal' | 'heroic' = 'normal', extra = 2): Fight {
  const sim = new Sim({ seed: 17, playerClass: 'warrior', autoEquip: false, devCommands: true });
  const tank = sim.player;
  sim.chat('/dev level 20', tank.id);
  const ids: number[] = [];
  for (let i = 0; i < extra; i++) {
    const pid = sim.addPlayer('mage', `Tidewalker${i}`);
    sim.partyInvite(pid, tank.id);
    sim.partyAccept(pid);
    ids.push(pid);
  }
  sim.chat(`/dev bastion enter ${difficulty}`, tank.id);
  for (const pid of ids) enterDungeon(sim.ctx, 'sunken_bastion', pid);
  const inst = claimedInstanceAt(sim.ctx, tank.pos);
  if (!inst) throw new Error('no bastion claim');
  // Clear every pack so the bosses fight alone.
  for (const id of inst.mobIds) {
    const e = sim.ctx.entities.get(id);
    if (e && !e.dead && !BOSSES.has(e.templateId)) sim.ctx.handleDeath(e, tank);
  }
  const others = ids.map((pid) => sim.ctx.entities.get(pid) as Entity);
  for (const p of [tank, ...others]) {
    p.maxHp = 1e7;
    p.hp = 1e7;
  }
  const o = instanceOrigin(DUNGEONS.sunken_bastion.index, inst.slot);
  sim.drainEvents();
  return { sim, inst, ox: o.x, oz: o.z, tank, others };
}

function boss(f: Fight, id: string): Entity {
  for (const mid of f.inst.mobIds) {
    const e = f.sim.ctx.entities.get(mid);
    if (e?.templateId === id) return e;
  }
  throw new Error(`no ${id}`);
}

function put(f: Fight, e: Entity, x: number, z: number): void {
  e.pos = f.sim.ctx.groundPos(f.ox + x, f.oz + z);
  e.prevPos = { ...e.pos };
}

function run(f: Fight, seconds: number, keep: () => void = () => {}): void {
  for (let t = 0; t < seconds - DT * 0.5; t += DT) {
    // Keep everyone standing (their pools recalc to their real size), but
    // only top up when low so a test can read one landing's damage.
    for (const p of [f.tank, ...f.others]) if (p.hp < 1e5) p.hp = 1e6;
    keep();
    f.sim.tick();
  }
  f.sim.drainEvents();
}

function engage(f: Fight, b: Entity): void {
  b.maxHp = Math.max(b.maxHp, 1e6);
  b.hp = b.maxHp;
  f.sim.ctx.aggroMob(b, f.tank, false);
}

function _objectAt(f: Fight, x: number, z: number): Entity | undefined {
  for (const id of f.inst.objectIds) {
    const e = f.sim.ctx.entities.get(id);
    if (e && Math.abs(e.pos.x - f.ox - x) < 0.75 && Math.abs(e.pos.z - f.oz - z) < 0.75) return e;
  }
  return undefined;
}

function earned(f: Fight, e: Entity, deed: string): boolean {
  return f.sim.players.get(e.id)?.deedsEarned.has(deed) ?? false;
}

// ---------------------------------------------------------------------------
// Knight-Commander Olen, the fallen paladin: tests/sunken_bastion_olen.test.ts.

// ---------------------------------------------------------------------------
// Gaoler Ossick's Drowned Anchor and Shackle Pair, the Gaol Turnkey's Iron
// Cage and Vael's Shadowstep: tests/sunken_bastion_pass5.test.ts.

// ---------------------------------------------------------------------------
describe('Vael the Fogbinder: find the real Vael among the fog shades', () => {
  function roof(difficulty: 'normal' | 'heroic' = 'normal'): { f: Fight; vael: Entity } {
    const f = fight(difficulty);
    const vael = boss(f, VAEL_ID);
    put(f, vael, -4, 226);
    put(f, f.tank, -4, 223);
    put(f, f.others[0], 8, 218);
    put(f, f.others[1], -16, 196);
    engage(f, vael);
    return { f, vael };
  }

  /** Past the fog's gathering and his sink: the four figures begin to rise. */
  function veilFalls(f: Fight): void {
    run(f, VAEL_TUNING.veilGatherSeconds + VAEL_TUNING.vanishSeconds + DT * 2);
  }

  function shades(f: Fight): Entity[] {
    return [...f.sim.ctx.entities.values()].filter((e) => e.templateId === FOG_SHADE_ID && !e.dead);
  }

  it('beam geometry: a figure in the beam is lit, one across the roof is not', () => {
    const yaw = 0;
    expect(inBeam(yaw, CROWN.x, CROWN.z + 20)).toBe(true);
    expect(inBeam(yaw, CROWN.x + 20, CROWN.z)).toBe(false);
    expect(veilBeamYaw(0, VAEL_TUNING.beamPeriod / 4)).toBeCloseTo(Math.PI / 2, 6);
  });

  it('Mist Surge: a 1.5 s bar, then frost to everyone within 12 yd only', () => {
    const { f, vael } = roof();
    run(f, VAEL_TUNING.surgeFirst + DT * 2);
    expect(vael.castingAbility).toBe(VAEL_MIST_SURGE);
    const near = f.tank.hp;
    const far = f.others[1].hp;
    run(f, VAEL_TUNING.surgeCast + 0.1);
    expect(f.tank.hp).toBeLessThan(near);
    expect(f.others[1].hp).toBe(far);
  });

  it('the Fog Veil: three shades wearing his name and health, all four rising, then singing', () => {
    const { f, vael } = roof();
    run(f, 0.5);
    vael.hp = Math.round(vael.maxHp * 0.69);
    veilFalls(f);
    const list = shades(f);
    expect(list).toHaveLength(3);
    // All four rise out of the roof together (none simply appears) ...
    for (const e of [vael, ...list]) {
      expect(e.castingAbility).toBe(VAEL_VEIL_RISE);
      expect(e.castTotal).toBe(VAEL_TUNING.veilRiseSeconds);
    }
    run(f, VAEL_TUNING.veilRiseSeconds);
    for (const s of list) {
      expect(s.name).toBe(vael.name);
      expect(s.hp).toBe(vael.hp);
      expect(s.maxHp).toBe(vael.maxHp);
      expect(s.castingAbility).toBe(VAEL_DROWNING_HYMN);
    }
    // ... then all four sing, the hymn's bar on the veil's own clock.
    expect(vael.castingAbility).toBe(VAEL_DROWNING_HYMN);
    expect(vael.castRemaining).toBeLessThan(
      VAEL_TUNING.hymnSeconds - VAEL_TUNING.veilRiseSeconds + 0.01,
    );
    expect(vael.auras.some((a) => a.id === VAEL_FOG_VEIL)).toBe(true);
    // Every figure stands on the rim.
    for (const e of [vael, ...list]) {
      const r = Math.hypot(e.pos.x - f.ox - CROWN.x, e.pos.z - f.oz - CROWN.z);
      expect(r).toBeCloseTo(CROWN.r - 5, 0);
    }
    // The hymn swells: every second, more frost.
    const a = f.others[1].hp;
    run(f, 1);
    const first = a - f.others[1].hp;
    run(f, 6);
    const b = f.others[1].hp;
    run(f, 1);
    expect(b - f.others[1].hp).toBeGreaterThan(first);
  });

  it('the real Vael stands as still as his shades through the veil (no drift-and-snap tell)', () => {
    // His tank stays where he was, off his rim spot: his chase used to walk
    // him a step toward the tank each tick and the veil snapped him back past
    // half a yard, a stutter only the real one showed.
    const { f, vael } = roof();
    run(f, 0.5);
    vael.hp = Math.round(vael.maxHp * 0.69);
    veilFalls(f);
    const shade = shades(f)[0];
    const moves = { vael: 0, shade: 0 };
    const drawn: number[] = [];
    let last = { vael: { ...vael.pos }, shade: { ...shade.pos } };
    const step = (a: { x: number; z: number }, b: { x: number; z: number }) =>
      Math.hypot(a.x - b.x, a.z - b.z);
    run(f, VAEL_TUNING.hymnSeconds - 2, () => {
      if (step(vael.pos, last.vael) > 1e-6) moves.vael++;
      if (step(shade.pos, last.shade) > 1e-6) moves.shade++;
      // The renderer draws him between prevPos and pos: a still body has both
      // on its spot.
      drawn.push(step(vael.prevPos, vael.pos));
      last = { vael: { ...vael.pos }, shade: { ...shade.pos } };
    });
    expect(moves.shade).toBe(0);
    expect(moves.vael).toBe(0);
    expect(Math.max(...drawn)).toBeLessThan(1e-6);
    const r = Math.hypot(vael.pos.x - f.ox - CROWN.x, vael.pos.z - f.oz - CROWN.z);
    expect(r).toBeCloseTo(CROWN.r - 5, 3);
  });

  it('striking a shade bursts it (Fogburst), and costs the deed', () => {
    const { f, vael } = roof();
    run(f, 0.5);
    vael.hp = Math.round(vael.maxHp * 0.69);
    veilFalls(f);
    const shade = shades(f)[0];
    put(f, f.others[0], shade.pos.x - f.ox + 2, shade.pos.z - f.oz);
    const before = f.others[0].hp;
    f.sim.dealDamage(f.others[0], shade, 50, false, 'fire', 'Fireball', 'hit', true);
    run(f, DT * 2, () => put(f, f.others[0], shade.pos.x - f.ox + 2, shade.pos.z - f.oz));
    expect(shades(f)).toHaveLength(2);
    expect(f.others[0].hp).toBeLessThan(before);
    const st = vael.bastionFight;
    expect(st?.kind === 'vael' && st.burst).toBe(true);
  });

  it('striking the real Vael for 5 percent breaks the veil: he staggers and is exposed', () => {
    const { f, vael } = roof();
    run(f, 0.5);
    vael.hp = Math.round(vael.maxHp * 0.69);
    veilFalls(f);
    f.sim.dealDamage(
      f.tank,
      vael,
      Math.ceil(vael.maxHp * 0.051),
      false,
      'physical',
      'Strike',
      'hit',
      true,
    );
    run(f, DT * 2);
    expect(shades(f)).toHaveLength(0);
    expect(vael.castingAbility).not.toBe(VAEL_DROWNING_HYMN);
    expect(vael.castingAbility).not.toBe(VAEL_VEIL_RISE);
    expect(vael.auras.some((a) => a.id === VAEL_STAGGER && a.kind === 'stun')).toBe(true);
    expect(vael.auras.find((a) => a.id === VAEL_EXPOSED)?.value).toBe(VAEL_TUNING.exposed);
  });

  it('left alone, the hymn runs its 18 s and the fog lifts', () => {
    const { f, vael } = roof();
    run(f, 0.5);
    vael.hp = Math.round(vael.maxHp * 0.69);
    run(
      f,
      VAEL_TUNING.veilGatherSeconds + VAEL_TUNING.vanishSeconds + VAEL_TUNING.hymnSeconds + 0.3,
    );
    expect(shades(f)).toHaveLength(0);
    expect(vael.auras.some((a) => a.id === VAEL_FOG_VEIL)).toBe(false);
  });

  it('heroic: the figures drift round the rim, and a burst shade leaves a thrall', () => {
    const { f, vael } = roof('heroic');
    run(f, 0.5);
    vael.hp = Math.round(vael.maxHp * 0.69);
    veilFalls(f);
    const at = { x: vael.pos.x, z: vael.pos.z };
    run(f, VAEL_TUNING.driftEvery + 0.2);
    expect(Math.hypot(vael.pos.x - at.x, vael.pos.z - at.z)).toBeGreaterThan(5);
    const shade = shades(f)[0];
    f.sim.dealDamage(f.tank, shade, 50, false, 'physical', 'Strike', 'hit', true);
    run(f, DT * 2);
    const thralls = [...f.sim.ctx.entities.values()].filter(
      (e) => e.templateId === 'drowned_thrall' && !e.dead,
    );
    expect(thralls.length).toBeGreaterThanOrEqual(1);
  });

  it('killing him with every shade untouched earns the beacon deed', () => {
    const { f, vael } = roof();
    run(f, 1);
    f.sim.ctx.handleDeath(vael, f.tank);
    run(f, DT * 2);
    expect(earned(f, f.tank, 'dgn_vael_beacon')).toBe(true);
  });
});
