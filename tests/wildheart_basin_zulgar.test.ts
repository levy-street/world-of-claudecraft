// Zulgar, Voice of the Basin, on the Jaguar Shrine Terrace (docs/design/
// dungeon-rework/wildheart_basin.md section 5.3, src/sim/encounters/
// wildheart_basin/zulgar.ts and control_gate.ts): the telegraphed Wildheart
// Pulse, Spirit of the Hunt at 70 and 40 (the avatar, the Prey, Mauled, the
// sun glyphs and Sunstruck, the control rules of the hunt), heroic Twin Prey
// and Ambush, the deed, and the reset. On a real claimed Basin with a real
// party (tests/helpers/wildheart_fight.ts).

import { describe, expect, it } from 'vitest';
import { SUN_GLYPHS } from '../src/sim/content/wildheart_basin_layout';
import {
  ZULGAR_TUNING as T,
  WILDHEART_AMBUSH_MARK,
  WILDHEART_SUN_GLYPH_DARK,
  WILDHEART_SUN_GLYPH_LIT,
  ZULGAR_AVATAR,
  ZULGAR_DEED,
  ZULGAR_ID,
  ZULGAR_MAULED,
  ZULGAR_PREY,
  ZULGAR_PULSE,
  ZULGAR_SPIRIT_HUNT,
  ZULGAR_SUNSTRUCK,
  ZULGAR_VANISHED,
} from '../src/sim/encounters/wildheart_basin';
import type { Aura, Entity, ZulgarFightState } from '../src/sim/types';
import {
  aura,
  boss,
  earned,
  engage,
  type Fight,
  fight,
  hitsOn,
  local,
  objects,
  put,
  run,
  tick,
} from './helpers/wildheart_fight';

function pull(f: Fight, pool = 1e6): Entity {
  const z = boss(f, ZULGAR_ID);
  put(f, z, 0, 218);
  put(f, f.tank, 0, 214);
  const spots: [number, number][] = [
    [-20, 204],
    [20, 204],
    [0, 234],
  ];
  f.others.forEach((p, i) => {
    put(f, p, spots[i][0], spots[i][1]);
  });
  engage(f, z, pool);
  return z;
}

function dev(f: Fight, what: string): void {
  f.sim.chat(`/dev wildheart trigger ${what}`, f.tank.id);
}

function st(z: Entity): ZulgarFightState {
  if (z.wildheartFight?.kind !== 'zulgar') throw new Error('no zulgar fight');
  return z.wildheartFight;
}

function control(kind: Aura['kind'], id: string, src: Entity): Aura {
  return {
    id,
    name: id,
    kind,
    remaining: 4,
    duration: 4,
    value: 0,
    sourceId: src.id,
    school: 'frost',
  };
}

function preyOf(f: Fight): Entity[] {
  return [f.tank, ...f.others].filter((p) => aura(p, ZULGAR_PREY));
}

describe('Wildheart Pulse', () => {
  it('a 1.5 s bar, then 170 to 243 within 14 yd', () => {
    const f = fight();
    const z = pull(f);
    tick(f);
    dev(f, 'pulse');
    expect(z.castingAbility).toBe(ZULGAR_PULSE);
    const from = f.hits.length;
    run(f, T.pulseCast + 0.1);
    const onTank = hitsOn(f, f.tank, 'Wildheart Pulse', from);
    expect(onTank).toHaveLength(1);
    expect(onTank[0].amount).toBeGreaterThanOrEqual(T.pulseMin);
    expect(onTank[0].amount).toBeLessThanOrEqual(T.pulseMax);
    for (const p of f.others) expect(hitsOn(f, p, 'Wildheart Pulse', from)).toHaveLength(0);
  });
});

describe('Spirit of the Hunt', () => {
  it('at 70 percent: a 1.5 s bar, then the avatar marks one non-tank Prey and chases it', () => {
    const f = fight();
    const z = pull(f);
    tick(f);
    z.hp = Math.floor(z.maxHp * 0.69);
    tick(f);
    expect(z.castingAbility).toBe(ZULGAR_SPIRIT_HUNT);
    run(f, T.huntCast + 0.1);
    expect(aura(z, ZULGAR_AVATAR)?.value).toBe(T.huntSpeedMult);
    const prey = preyOf(f);
    expect(prey).toHaveLength(1);
    expect(prey[0].id).not.toBe(f.tank.id);
    expect(z.aggroTargetId).toBe(prey[0].id);
    // A taunt never pulls the avatar off its Prey.
    f.sim.ctx.applyTaunt(f.tank, z);
    tick(f);
    expect(z.aggroTargetId).toBe(prey[0].id);
  });

  it('a caught Prey is Mauled (500 and a 2 s knockdown) and he marks another', () => {
    const f = fight();
    const z = pull(f);
    tick(f);
    dev(f, 'prey');
    const [first] = preyOf(f);
    const at = local(f, z);
    put(f, first, at.x + 1, at.z);
    const from = f.hits.length;
    tick(f);
    const maul = hitsOn(f, first, 'Mauled', from);
    expect(maul).toHaveLength(1);
    expect(maul[0].amount).toBe(T.maulDamage);
    expect(aura(first, ZULGAR_MAULED)?.kind).toBe('stun');
    expect(aura(first, ZULGAR_PREY)).toBeUndefined();
    run(f, T.maulPause + 0.1);
    const [next] = preyOf(f);
    expect(next).toBeDefined();
    expect(next.id).not.toBe(first.id);
    expect(st(z).mauled).toBe(true);
  });

  it('a lit sun glyph makes the avatar Sunstruck and goes dark for 15 s', () => {
    const f = fight();
    const z = pull(f);
    tick(f);
    dev(f, 'prey');
    expect(objects(f, WILDHEART_SUN_GLYPH_LIT)).toHaveLength(SUN_GLYPHS.length);
    put(f, z, SUN_GLYPHS[0].x, SUN_GLYPHS[0].z);
    tick(f);
    const struck = aura(z, ZULGAR_SUNSTRUCK);
    expect(struck?.kind).toBe('slow');
    expect(struck?.value).toBeCloseTo(1 - T.sunstruckSlow, 6);
    expect(objects(f, WILDHEART_SUN_GLYPH_DARK)).toHaveLength(1);
    expect(st(z).glyphDark[0]).toBeGreaterThan(T.glyphDarkSeconds - 0.2);
    // Outside the hunt a glyph never strikes.
    dev(f, 'endhunt');
    put(f, z, SUN_GLYPHS[1].x, SUN_GLYPHS[1].z);
    tick(f);
    expect(objects(f, WILDHEART_SUN_GLYPH_DARK)).toHaveLength(1);
    run(f, T.glyphDarkSeconds);
    expect(objects(f, WILDHEART_SUN_GLYPH_DARK)).toHaveLength(0);
  });

  it('roots land on the avatar and stuns last half as long; outside the hunt neither', () => {
    const f = fight();
    const z = pull(f);
    tick(f);
    const mage = f.others[0];
    f.sim.ctx.applyAura(z, control('root', 'test_root_a', mage));
    f.sim.ctx.applyAura(z, control('stun', 'test_stun_a', mage));
    expect(aura(z, 'test_root_a')).toBeUndefined();
    expect(aura(z, 'test_stun_a')).toBeUndefined();
    dev(f, 'prey');
    f.sim.ctx.applyAura(z, control('root', 'test_root_b', mage));
    expect(aura(z, 'test_root_b')).toBeDefined();
    f.sim.ctx.applyAura(z, control('stun', 'test_stun_b', mage));
    expect(aura(z, 'test_stun_b')?.remaining).toBe(4 * T.huntStunScale);
    f.sim.ctx.applyAura(z, control('polymorph', 'test_sheep', mage));
    expect(aura(z, 'test_sheep')).toBeUndefined();
  });

  it('the hunt ends: the marks and the avatar go, the tank has him again', () => {
    const f = fight();
    const z = pull(f);
    tick(f);
    dev(f, 'prey');
    st(z).huntLeft = 0.05;
    run(f, 0.2);
    expect(preyOf(f)).toHaveLength(0);
    expect(aura(z, ZULGAR_AVATAR)).toBeUndefined();
    expect(z.aggroTargetId).toBe(f.tank.id);
    expect(z.ccImmune).toBe(true);
    expect(st(z).phase).toBe('fight');
  });
});

describe('heroic Twin Prey and Ambush', () => {
  it('Twin Prey: two marks, and he switches between them every 6 s', () => {
    const f = fight('heroic');
    const z = pull(f);
    tick(f);
    dev(f, 'prey');
    const prey = preyOf(f);
    expect(prey).toHaveLength(2);
    const chased = () => prey.find((p) => aura(p, ZULGAR_PREY)?.value2 === 1);
    const first = chased();
    expect(first).toBeDefined();
    expect(z.aggroTargetId).toBe(first?.id);
    // Keep both out of reach while he switches.
    run(f, T.twinSwitch + 0.1, () => {
      for (const p of prey) {
        const d = Math.hypot(p.pos.x - z.pos.x, p.pos.z - z.pos.z);
        if (d < 8) put(f, p, local(f, p).x > 0 ? -22 : 22, 230);
      }
    });
    const second = chased();
    expect(second?.id).not.toBe(first?.id);
  });

  it('Ambush: he vanishes, paints a 6 yd circle on the farthest player, and lands there', () => {
    const f = fight('heroic');
    const z = pull(f);
    tick(f);
    dev(f, 'ambush');
    expect(aura(z, ZULGAR_VANISHED)).toBeDefined();
    expect(z.damageImmune).toBe(true);
    run(f, T.ambushSeconds - T.ambushWarning + 0.05);
    const [mark] = objects(f, WILDHEART_AMBUSH_MARK);
    expect(mark).toBeDefined();
    expect(mark.scale).toBe(T.ambushRadius);
    // The circle sits on the farthest player from him.
    const dist = (p: Entity) => Math.hypot(p.pos.x - z.pos.x, p.pos.z - z.pos.z);
    const far = [f.tank, ...f.others].reduce((a, b) => (dist(b) > dist(a) ? b : a));
    const at = local(f, mark);
    expect(Math.hypot(at.x - local(f, far).x, at.z - local(f, far).z)).toBeLessThan(0.5);
    const from = f.hits.length;
    run(f, T.ambushWarning);
    expect(z.damageImmune).toBe(false);
    expect(Math.hypot(z.pos.x - mark.pos.x, z.pos.z - mark.pos.z)).toBeLessThan(0.5);
    const hit = hitsOn(f, far, 'Ambush', from);
    expect(hit).toHaveLength(1);
    expect(objects(f, WILDHEART_AMBUSH_MARK)).toHaveLength(0);
  });
});

describe('Never Caught and the reset', () => {
  it('nobody mauled: the kill earns the deed; a maul loses it', () => {
    const f = fight();
    const z = pull(f, 5000);
    run(f, 1);
    f.sim.ctx.dealDamage(f.tank, z, 1e6, false, 'physical', 'Test', 'hit', false);
    run(f, 0.1);
    expect(z.dead).toBe(true);
    expect(earned(f, f.tank, ZULGAR_DEED)).toBe(true);

    const g = fight();
    const z2 = pull(g, 5000);
    tick(g);
    dev(g, 'prey');
    const [prey] = preyOf(g);
    put(g, prey, local(g, z2).x + 1, local(g, z2).z);
    tick(g);
    g.sim.ctx.dealDamage(g.tank, z2, 1e6, false, 'physical', 'Test', 'hit', false);
    run(g, 0.1);
    expect(earned(g, g.tank, ZULGAR_DEED)).toBe(false);
  });

  it('a wipe drops the marks, the glyphs and the avatar', () => {
    const f = fight();
    const z = pull(f);
    tick(f);
    dev(f, 'prey');
    z.inCombat = false;
    z.aggroTargetId = null;
    z.aiState = 'evade';
    tick(f);
    expect(preyOf(f)).toHaveLength(0);
    expect(objects(f, WILDHEART_SUN_GLYPH_LIT)).toHaveLength(0);
    expect(aura(z, ZULGAR_AVATAR)).toBeUndefined();
    expect(z.wildheartFight).toBeUndefined();
    expect(z.ccImmune).toBe(true);
  });
});

// Playtest: "it keeps stunning me, I can't do anything". A Mauled player gets
// a respite (the knockdown, then a head start): never the Prey again until it
// runs out, so knockdowns never chain. Meanwhile he hunts another Prey, or,
// with nobody else, roars over the kill and waits it out. The tank is never
// the Prey while anyone else stands, even mid-hunt.
describe('the Prey respite: no chained knockdowns', () => {
  /** Every Mauled stun window as [start, end] in seconds, per player id. */
  function maulWindows(f: Fight, seconds: number, keep: () => void): Map<number, number[][]> {
    const out = new Map<number, number[][]>();
    let t = 0;
    run(f, seconds, () => {
      keep();
      t += 1 / 20;
      for (const p of [f.tank, ...f.others]) {
        const m = aura(p, ZULGAR_MAULED);
        if (!m) continue;
        const list = out.get(p.id) ?? [];
        const last = list[list.length - 1];
        if (last && t - last[1] < 0.06) last[1] = t;
        else list.push([t, t]);
        out.set(p.id, list);
      }
    });
    return out;
  }

  it('solo: a Mauled player standing still is never caught again during the respite', () => {
    const f = fight('normal', 0);
    const z = pull(f);
    tick(f);
    dev(f, 'prey');
    expect(aura(f.tank, ZULGAR_PREY)).toBeDefined();
    const avatarRoars = () => f.fx.filter((x) => x === ZULGAR_AVATAR).length;
    const roarsBefore = avatarRoars();
    // The worst case: the player never moves away from him.
    const stay = () => {
      const at = local(f, z);
      if (Math.hypot(f.tank.pos.x - z.pos.x, f.tank.pos.z - z.pos.z) > 1.2)
        put(f, f.tank, at.x + 1, at.z);
    };
    const windows = maulWindows(f, 14, stay).get(f.tank.id) ?? [];
    expect(windows.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < windows.length; i++) {
      // A full head start between one knockdown's end and the next maul.
      expect(windows[i][0] - windows[i - 1][1]).toBeGreaterThanOrEqual(
        T.preyRespite - T.maulStun - 0.1,
      );
    }
    // With nobody else to hunt he roared over the kill before hunting again.
    expect(avatarRoars()).toBeGreaterThan(roarsBefore);
  }, 60_000);

  it('solo: after the respite he marks the player again and hunts on', () => {
    const f = fight('normal', 0);
    const z = pull(f);
    tick(f);
    dev(f, 'prey');
    const at = local(f, z);
    put(f, f.tank, at.x + 1, at.z);
    tick(f);
    expect(aura(f.tank, ZULGAR_MAULED)).toBeDefined();
    // Run away to the far side of the terrace.
    put(f, f.tank, 0, 236);
    run(f, T.preyRespite - 0.3);
    expect(aura(f.tank, ZULGAR_PREY)).toBeUndefined();
    expect(st(z).phase).toBe('hunt');
    run(f, 0.6);
    expect(aura(f.tank, ZULGAR_PREY)).toBeDefined();
    expect(z.aggroTargetId).toBe(f.tank.id);
  });

  it('in a group the Mauled player is never the next Prey, and the tank is never Prey', () => {
    const f = fight();
    const z = pull(f);
    tick(f);
    dev(f, 'prey');
    // Every chased Prey walks into him: mauls come as fast as the rules allow.
    const feed = () => {
      expect(aura(f.tank, ZULGAR_PREY)).toBeUndefined();
      for (const p of f.others) {
        if (aura(p, ZULGAR_PREY)?.value2 !== 1) continue;
        const at = local(f, z);
        put(f, p, at.x + 1, at.z);
      }
    };
    const windows = maulWindows(f, T.huntSeconds - 1, feed);
    expect(windows.has(f.tank.id)).toBe(false);
    let mauls = 0;
    for (const list of windows.values()) {
      mauls += list.length;
      for (let i = 1; i < list.length; i++) {
        expect(list[i][0] - list[i - 1][1]).toBeGreaterThanOrEqual(
          T.preyRespite - T.maulStun - 0.1,
        );
      }
    }
    expect(mauls).toBeGreaterThanOrEqual(3);
  }, 60_000);

  it('heroic Twin Prey: a slot freed by a maul fills again once the respite ends', () => {
    const f = fight('heroic', 2);
    const z = pull(f);
    tick(f);
    dev(f, 'prey');
    expect(preyOf(f)).toHaveLength(2);
    const chased = preyOf(f).find((p) => aura(p, ZULGAR_PREY)?.value2 === 1) as Entity;
    const at = local(f, z);
    put(f, chased, at.x + 1, at.z);
    tick(f);
    expect(aura(chased, ZULGAR_MAULED)).toBeDefined();
    // Everyone stays well out of his reach through the respite (he is held
    // at the altar so nobody else is caught meanwhile).
    put(f, f.others[0], -22, 230);
    put(f, f.others[1], 22, 230);
    run(f, T.preyRespite + 0.5, () => {
      expect(aura(f.tank, ZULGAR_PREY)).toBeUndefined();
      put(f, z, 0, 214);
    });
    expect(st(z).phase).toBe('hunt');
    expect(preyOf(f)).toHaveLength(2);
  }, 60_000);

  it('a group cannot skip the hunt by leaving the tank alone on the terrace', () => {
    const f = fight();
    const z = pull(f);
    tick(f);
    for (const p of f.others) put(f, p, 0, -217);
    dev(f, 'prey');
    expect(aura(f.tank, ZULGAR_PREY)).toBeDefined();
    run(f, 1);
    expect(st(z).phase).toBe('hunt');
  });
});
