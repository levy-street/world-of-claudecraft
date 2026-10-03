// The Sunken Bastion trash (src/sim/content/sunken_bastion.ts) on the trash
// kit's support and lane casts (src/sim/mob/trash_kit/support.ts): Brine Mend,
// Fog Ward, the Piercing Bolt lane, the Warhound's Lunge stun, and the
// Turretback Hermit's Shell Slam, Barnacle Brood and Withdraw. Driven through
// tickTrashKits inside a real claimed Bastion (the crypt kit test's shape).

import { describe, expect, it } from 'vitest';
import { SUNKEN_BASTION_SPAWNS } from '../src/sim/content/sunken_bastion';
import { DUNGEONS, instanceOrigin, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { applyDungeonMobTuning } from '../src/sim/instances/difficulty';
import { claimedInstanceAt } from '../src/sim/instances/dungeons';
import { SCRIPTED_INTERRUPTIBLE_CHANNELS } from '../src/sim/mob/healer_channel';
import { tickTrashKits } from '../src/sim/mob/trash_kit';
import {
  BASTION_BRINE_MEND,
  BASTION_CLAW_SWEEP,
  BASTION_FOG_WARD,
  BASTION_HALBERD_SWEEP,
  BASTION_PIERCING_BOLT,
  BASTION_SHELL_SLAM,
} from '../src/sim/mob/trash_kit/bastion_cast_ids';
import { inLane, laneSide } from '../src/sim/mob/trash_kit/lane';
import {
  TRASH_WARD_AURA,
  TRASH_WITHDRAW_AURA,
  TRASH_WITHDRAW_WARD,
} from '../src/sim/mob/trash_kit/support';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import { DT, type Entity } from '../src/sim/types';

interface Room {
  sim: Sim;
  inst: InstanceSlot;
  me: Entity;
}

function room(difficulty: 'normal' | 'heroic' = 'normal'): Room {
  const sim = new Sim({ seed: 91, playerClass: 'warrior', autoEquip: false, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  sim.chat(`/dev bastion enter ${difficulty}`, sim.player.id);
  const inst = claimedInstanceAt(sim.ctx, sim.player.pos);
  if (!inst) throw new Error('no bastion claim');
  const me = sim.player;
  me.maxHp = 1e6;
  me.hp = 1e6;
  const o = instanceOrigin(DUNGEONS.sunken_bastion.index, inst.slot);
  // The middle of the tidal flats, clear of every pack: a quiet test bench.
  me.pos = sim.ctx.groundPos(o.x - 10, o.z - 200);
  me.prevPos = { ...me.pos };
  sim.drainEvents();
  return { sim, inst, me };
}

/** A kit mob at an offset from the player, engaged on it. */
function engage(r: Room, templateId: string, dx = 8, dz = 0): Entity {
  const mob = createMob(r.sim.ctx.nextId++, MOBS[templateId], MOBS[templateId].minLevel, {
    ...r.sim.ctx.groundPos(r.me.pos.x + dx, r.me.pos.z + dz),
  });
  applyDungeonMobTuning(mob, 'sunken_bastion', r.inst.difficulty);
  r.sim.ctx.addEntity(mob);
  r.inst.mobIds.push(mob.id);
  mob.inCombat = true;
  mob.aiState = 'attack';
  mob.aggroTargetId = r.me.id;
  mob.facing = Math.atan2(r.me.pos.x - mob.pos.x, r.me.pos.z - mob.pos.z);
  return mob;
}

/** Run only the kit for `seconds`, holding every listed mob engaged. */
function run(r: Room, seconds: number, mobs: Entity[]): void {
  for (let t = 0; t < seconds - DT * 0.5; t += DT) {
    for (const m of mobs) {
      if (m.dead || !r.sim.ctx.entities.has(m.id)) continue;
      m.inCombat = true;
      m.aiState = 'attack';
      m.aggroTargetId ??= r.me.id;
    }
    tickTrashKits(r.sim.ctx);
    r.sim.drainEvents();
  }
}

function addPlayer(r: Room, cls: 'mage' | 'priest' | 'warrior', dx: number, dz: number): Entity {
  const pid = r.sim.addPlayer(cls, `T${cls}${dx}${dz}`);
  const e = r.sim.ctx.entities.get(pid) as Entity;
  e.pos = r.sim.ctx.groundPos(r.me.pos.x + dx, r.me.pos.z + dz);
  e.prevPos = { ...e.pos };
  e.maxHp = 1e6;
  e.hp = 1e6;
  return e;
}

describe('Bastion trash: the cast table', () => {
  it('kicks the heal and the shield, never the sweeps, the slam or the lane', () => {
    expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[BASTION_BRINE_MEND]?.school).toBe('nature');
    expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[BASTION_FOG_WARD]?.school).toBe('frost');
    for (const id of [
      BASTION_HALBERD_SWEEP,
      BASTION_PIERCING_BOLT,
      BASTION_CLAW_SWEEP,
      BASTION_SHELL_SLAM,
    ])
      expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[id], id).toBeUndefined();
  });

  it('gives every new trash type exactly one readable job', () => {
    expect(MOBS.tidebound_acolyte.trashKit?.mend?.castId).toBe(BASTION_BRINE_MEND);
    expect(MOBS.tidebound_acolyte.desperateHeal).toBeUndefined();
    expect(MOBS.drowned_watchman.breathCone?.castId).toBe(BASTION_HALBERD_SWEEP);
    expect(MOBS.fogbound_arbalest.trashKit?.line?.castId).toBe(BASTION_PIERCING_BOLT);
    expect(MOBS.barnacle_crawler.deathThroes?.name).toBe('Brine Burst');
    expect(MOBS.bastion_warhound.trashKit?.leap?.stun).toBe(1);
    expect(MOBS.mistweaver.trashKit?.ward?.castId).toBe(BASTION_FOG_WARD);
    expect(MOBS.drowned_sergeant.warcry?.name).toBe('Rally the Watch');
    expect(MOBS.drowned_sergeant.enrage?.belowHpPct).toBe(0.3);
    expect(MOBS.gaol_turnkey.summonAdds).toEqual({
      mobId: 'shackled_prisoner',
      count: 2,
      atHpPct: [0.5],
    });
    const hermit = MOBS.turretback_hermit;
    expect(hermit.breathCone?.castId).toBe(BASTION_CLAW_SWEEP);
    expect(hermit.trashKit?.wingGust?.castId).toBe(BASTION_SHELL_SLAM);
    expect(hermit.trashKit?.withdraw?.belowHpPct).toBe(0.25);
    expect(hermit.summonAdds?.atHpPct).toEqual([0.6, 0.3]);
    expect(hermit.ccImmune).toBe(true);
  });

  it('places every group of the design roster', () => {
    const packOf = (id: string) =>
      SUNKEN_BASTION_SPAWNS.filter((s) => s.packId === id)
        .map((s) => s.mobId)
        .sort();
    expect(packOf('turnkey')).toEqual(['gaol_turnkey']);
    expect(packOf('gd')).toEqual(['bastion_warhound', 'bastion_warhound', 'drowned_watchman']);
    expect(packOf('g1')).toEqual([
      'shackled_prisoner',
      'shackled_prisoner',
      'shackled_prisoner',
      'shackled_prisoner',
    ]);
    expect(packOf('hermit')).toEqual(['turretback_hermit']);
    expect(packOf('k3')).toEqual([
      'drowned_sergeant',
      'drowned_watchman',
      'drowned_watchman',
      'mistweaver',
      'tidebound_acolyte',
    ]);
  });
});

describe('Bastion trash: Tidebound Acolyte, Brine Mend', () => {
  const def = MOBS.tidebound_acolyte.trashKit?.mend;
  if (!def) throw new Error('mend');

  it('waits while nobody is hurt, then heals the most injured ally when the bar ends', () => {
    const r = room();
    const acolyte = engage(r, 'tidebound_acolyte');
    const hurt = engage(r, 'bastion_revenant', 6, 4);
    const scratched = engage(r, 'bastion_revenant', 6, -4);
    run(r, def.first + 1, [acolyte, hurt, scratched]);
    expect(acolyte.castingAbility).toBeNull();
    hurt.hp = Math.round(hurt.maxHp * 0.4);
    scratched.hp = Math.round(scratched.maxHp * 0.7);
    run(r, DT * 2, [acolyte, hurt, scratched]);
    expect(acolyte.castingAbility).toBe(BASTION_BRINE_MEND);
    expect(acolyte.castTargetId).toBe(hurt.id);
    const before = hurt.hp;
    run(r, def.castTime - 0.2, [acolyte, hurt, scratched]);
    expect(hurt.hp).toBe(before);
    run(r, 0.3, [acolyte, hurt, scratched]);
    expect(hurt.hp).toBe(before + Math.round(hurt.maxHp * def.healPct));
    expect(scratched.hp).toBe(Math.round(scratched.maxHp * 0.7));
  });

  it('a kick wastes the mend and the nature lockout holds the next one', () => {
    const r = room();
    const acolyte = engage(r, 'tidebound_acolyte');
    const hurt = engage(r, 'bastion_revenant', 6, 4);
    hurt.hp = Math.round(hurt.maxHp * 0.3);
    run(r, def.first + DT, [acolyte, hurt]);
    expect(acolyte.castingAbility).toBe(BASTION_BRINE_MEND);
    const before = hurt.hp;
    r.sim.ctx.cancelCast(acolyte);
    r.sim.ctx.applyAura(acolyte, {
      id: 'pummel_lockout',
      name: 'Pummel',
      kind: 'lockout',
      remaining: 4,
      duration: 4,
      value: 0,
      sourceId: r.me.id,
      school: 'nature',
    });
    run(r, def.castTime + 0.5, [acolyte, hurt]);
    expect(hurt.hp).toBe(before);
    expect(acolyte.castingAbility).toBeNull();
  });
});

describe('Bastion trash: Mistweaver, Fog Ward', () => {
  const def = MOBS.mistweaver.trashKit?.ward;
  if (!def) throw new Error('ward');

  it('shields the most injured unshielded ally for a quarter of its health', () => {
    const r = room();
    const weaver = engage(r, 'mistweaver');
    const a = engage(r, 'bastion_revenant', 6, 4);
    const b = engage(r, 'bastion_revenant', 6, -4);
    a.hp = Math.round(a.maxHp * 0.6);
    run(r, def.first + DT, [weaver, a, b]);
    expect(weaver.castingAbility).toBe(BASTION_FOG_WARD);
    expect(weaver.castTargetId).toBe(a.id);
    run(r, def.castTime + DT, [weaver, a, b]);
    const ward = a.auras.find((x) => x.id === TRASH_WARD_AURA);
    expect(ward?.kind).toBe('absorb');
    expect(ward?.value).toBe(Math.round(a.maxHp * def.shieldPct));
    // The next ward goes to someone not already wrapped.
    run(r, def.every, [weaver, a, b]);
    expect(weaver.castTargetId === b.id || weaver.castTargetId === weaver.id).toBe(true);
  });
});

describe('Bastion trash: Fogbound Arbalest, Piercing Bolt', () => {
  const def = MOBS.fogbound_arbalest.trashKit?.line;
  if (!def) throw new Error('line');

  it('locks its lane on the victim, and a sidestep during the bar dodges it', () => {
    const r = room();
    const bolt = engage(r, 'fogbound_arbalest', 0, -14);
    run(r, def.first + DT, [bolt]);
    expect(bolt.castingAbility).toBe(BASTION_PIERCING_BOLT);
    const yaw = bolt.facing;
    // Someone further down the same lane is hit too.
    const behind = addPlayer(r, 'mage', 0, 6);
    expect(
      inLane(bolt.pos.x, bolt.pos.z, yaw, def.length, def.halfWidth, behind.pos.x, behind.pos.z),
    ).toBe(true);
    const meBefore = r.me.hp;
    const behindBefore = behind.hp;
    // The victim walks three yards out of the lane: the aim holds, the bolt misses.
    r.me.pos = r.sim.ctx.groundPos(r.me.pos.x + 3, r.me.pos.z);
    run(r, def.castTime, [bolt]);
    expect(bolt.castingAbility).toBeNull();
    expect(bolt.facing).toBeCloseTo(yaw, 6);
    expect(r.me.hp).toBe(meBefore);
    const dealt = behindBefore - behind.hp;
    expect(dealt).toBeGreaterThanOrEqual(def.min);
    expect(dealt).toBeLessThanOrEqual(def.max);
  });

  it('the lane test is a strip: along, within the half width, never behind', () => {
    expect(inLane(0, 0, 0, 25, 1, 0, 10)).toBe(true);
    expect(inLane(0, 0, 0, 25, 1, 1.2, 10)).toBe(false);
    expect(inLane(0, 0, 0, 25, 1, 0, -2)).toBe(false);
    expect(inLane(0, 0, 0, 25, 1, 0, 26)).toBe(false);
    expect(inLane(0, 0, Math.PI / 2, 25, 1, 10, 0.5)).toBe(true);
    expect(Math.sign(laneSide(0, 0, 0, 3, 5))).toBe(1);
    expect(Math.sign(laneSide(0, 0, 0, -3, 5))).toBe(-1);
  });
});

describe('Bastion trash: Bastion Warhound, Lunge', () => {
  it('leaps onto the farthest caster and knocks them flat for a second', () => {
    const r = room();
    const hound = engage(r, 'bastion_warhound', 3, 0);
    const mage = addPlayer(r, 'mage', 18, 6);
    const def = MOBS.bastion_warhound.trashKit?.leap;
    if (!def) throw new Error('leap');
    run(r, def.first + def.seconds + 0.2, [hound]);
    expect(Math.hypot(hound.pos.x - mage.pos.x, hound.pos.z - mage.pos.z)).toBeLessThan(2.5);
    const stun = mage.auras.find((a) => a.kind === 'stun');
    expect(stun?.name).toBe('Lunge');
    expect(stun?.duration).toBe(1);
    // No bleed: the hound's job is the stun.
    expect(mage.auras.some((a) => a.kind === 'dot')).toBe(false);
  });
});

describe('Bastion trash: the Turretback Hermit', () => {
  it('Shell Slam hits and throws back everyone close, and only them', () => {
    const r = room();
    const hermit = engage(r, 'turretback_hermit', 4, 0);
    const far = addPlayer(r, 'priest', 24, 0);
    const def = MOBS.turretback_hermit.trashKit?.wingGust;
    if (!def) throw new Error('slam');
    const start = { ...r.me.pos };
    const meBefore = r.me.hp;
    run(r, def.first + def.castTime + DT * 2, [hermit]);
    expect(r.me.hp).toBeLessThan(meBefore);
    expect(Math.hypot(r.me.pos.x - start.x, r.me.pos.z - start.z)).toBeGreaterThan(1);
    expect(far.hp).toBe(far.maxHp);
  });

  it('withdraws into its tower once, under a quarter: no casts, far less damage', () => {
    const r = room();
    const hermit = engage(r, 'turretback_hermit', 4, 0);
    run(r, 1, [hermit]);
    hermit.hp = Math.round(hermit.maxHp * 0.24);
    run(r, DT, [hermit]);
    const shelter = hermit.auras.find((a) => a.id === TRASH_WITHDRAW_AURA);
    const ward = hermit.auras.find((a) => a.id === TRASH_WITHDRAW_WARD);
    expect(shelter?.kind).toBe('stun');
    expect(ward?.kind).toBe('shield_wall');
    expect(ward?.value).toBe(0.6);
    expect(hermit.castingAbility).toBeNull();
    // Damage through the ward is cut.
    const hp = hermit.hp;
    r.sim.dealDamage(r.me, hermit, 100, false, 'physical', 'Strike', 'hit', true);
    expect(hp - hermit.hp).toBe(40);
    // It never withdraws twice in one pull.
    for (const a of hermit.auras) if (a.id === TRASH_WITHDRAW_AURA) a.remaining = 0;
    hermit.auras = hermit.auras.filter((a) => a.id !== TRASH_WITHDRAW_AURA);
    hermit.hp = Math.round(hermit.maxHp * 0.1);
    run(r, DT * 2, [hermit]);
    expect(hermit.auras.some((a) => a.id === TRASH_WITHDRAW_AURA)).toBe(false);
  });

  it('drops a Barnacle Brood at 60 and 30 percent', () => {
    const r = room();
    const hermit = engage(r, 'turretback_hermit', 4, 0);
    const crawlers = () =>
      [...r.sim.ctx.entities.values()].filter(
        (e) => e.templateId === 'barnacle_crawler' && !e.dead && e.summonedAdd,
      ).length;
    hermit.hp = Math.round(hermit.maxHp * 0.59);
    r.sim.ctx.updateBossMechanics(hermit);
    expect(crawlers()).toBe(2);
    hermit.hp = Math.round(hermit.maxHp * 0.29);
    r.sim.ctx.updateBossMechanics(hermit);
    expect(crawlers()).toBe(4);
  });
});

describe('Bastion trash: heroic', () => {
  it('heroic scales a landing lane through the mechanic multiplier', () => {
    const normal = room('normal');
    const heroic = room('heroic');
    const hit = (r: Room): number => {
      const bolt = engage(r, 'fogbound_arbalest', 0, -14);
      const def = MOBS.fogbound_arbalest.trashKit?.line;
      if (!def) throw new Error('line');
      const before = r.me.hp;
      run(r, def.first + def.castTime + DT * 2, [bolt]);
      return before - r.me.hp;
    };
    expect(hit(heroic)).toBeGreaterThan(hit(normal) * 2);
  });
});
