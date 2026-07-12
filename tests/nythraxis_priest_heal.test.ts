import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';

const SEED = 51234;

// Malric, the Deathless Hierophant: the heroic Nythraxis priest add. He is
// CC-able (unlike the boss and warrior add) and channels an ESCALATING heal on
// the boss that a stun/silence must break, or it ramps every tick.
const inner = (sim: Sim) =>
  sim as unknown as {
    addEntity(e: Entity): void;
    updateBossMechanics(m: Entity): void;
    applyAura(target: Entity, aura: Aura): void;
  };

function spawn(sim: Sim, id: number, tmplId: string, hp?: number): Entity {
  const tmpl = MOBS[tmplId];
  const mob = createMob(id, tmpl, tmpl.maxLevel, { x: 0, y: 0, z: 0 });
  if (hp !== undefined) mob.hp = hp;
  mob.inCombat = true;
  inner(sim).addEntity(mob);
  return mob;
}

const stun = (sourceId: number): Aura => ({
  id: 'test_stun',
  name: 'Test Stun',
  kind: 'stun',
  remaining: 10,
  duration: 10,
  value: 0,
  sourceId,
  school: 'physical',
});

// Advance until the channel's next heal lands (every=4s = 80 ticks, plus float
// drift) and return the heal the boss received, or 0 if none fired (interrupted).
function tickOneChannel(sim: Sim, malric: Entity, boss: Entity, maxTicks = 90): number {
  const before = boss.hp;
  for (let i = 0; i < maxTicks; i++) {
    inner(sim).updateBossMechanics(malric);
    if (boss.hp > before) return boss.hp - before;
  }
  return boss.hp - before;
}

describe('heroic Nythraxis priest: escalating channeled heal', () => {
  it('is authored CC-able with a channelHeal and no ward', () => {
    const t = MOBS.nythraxis_heroic_priest_add;
    expect(t.ccImmune).toBe(false);
    expect(t.wardAllies).toBeUndefined();
    expect(t.channelHeal).toEqual({
      radius: 45,
      every: 4,
      baseHeal: 320,
      rampAdd: 240,
      maxHeal: 1440,
      name: "Malric's Mending",
      school: 'shadow',
    });
  });

  it('heals the boss for more each uninterrupted tick (the ramp)', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const boss = spawn(sim, 8001, 'nythraxis_scourge_of_thornpeak', 1000); // wounded, huge pool
    const malric = spawn(sim, 8002, 'nythraxis_heroic_priest_add');
    boss.pos = { x: 4, y: 0, z: 0 };

    // Standalone spawn has no mechanicHealMult (the heroic 1.6x only applies in a
    // claimed heroic instance), so these are the raw base/ramp values.
    const first = tickOneChannel(sim, malric, boss);
    const second = tickOneChannel(sim, malric, boss);
    const third = tickOneChannel(sim, malric, boss);
    expect(first).toBe(320); // baseHeal
    expect(second).toBe(560); // +rampAdd
    expect(third).toBe(800); // +rampAdd again
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
  });

  it('a stun breaks the channel and resets the ramp to base', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const boss = spawn(sim, 8011, 'nythraxis_scourge_of_thornpeak', 1000);
    const malric = spawn(sim, 8012, 'nythraxis_heroic_priest_add');
    boss.pos = { x: 4, y: 0, z: 0 };

    tickOneChannel(sim, malric, boss); // 320
    const ramped = tickOneChannel(sim, malric, boss); // 560 (ramp built)
    expect(ramped).toBe(560);

    // Stun Malric: the next interval heals for nothing and the ramp resets.
    malric.auras.push(stun(0));
    const duringStun = tickOneChannel(sim, malric, boss);
    expect(duringStun).toBe(0);
    expect(malric.channelRamp).toBe(0);

    // After the stun clears the channel restarts from base, not where it left off.
    malric.auras = [];
    const afterStun = tickOneChannel(sim, malric, boss);
    expect(afterStun).toBe(320);
  });

  it('the priest (and stalker) accept player CC; the warrior add does not', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const malric = spawn(sim, 8021, 'nythraxis_heroic_priest_add');
    const voss = spawn(sim, 8022, 'nythraxis_heroic_rogue_add');
    const aldren = spawn(sim, 8023, 'nythraxis_heroic_warrior_add');
    const playerSource = 999; // a non-self source (a player's stun)

    inner(sim).applyAura(malric, stun(playerSource));
    inner(sim).applyAura(voss, stun(playerSource));
    inner(sim).applyAura(aldren, stun(playerSource));

    expect(malric.auras.some((a) => a.kind === 'stun')).toBe(true);
    expect(voss.auras.some((a) => a.kind === 'stun')).toBe(true);
    expect(aldren.auras.some((a) => a.kind === 'stun')).toBe(false); // CC-immune like the boss
  });

  it('holds a standoff near its protectee and channels, instead of chasing the player', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    const pid = sim.playerId;
    // Player in aggro range to one side; Malric keeps him as a target but must NOT
    // run him down, he holds near the boss instead.
    sim.player.pos = { x: 12, y: 0, z: 0 };
    sim.player.prevPos = { ...sim.player.pos };
    const boss = spawn(sim, 8200, 'forest_wolf');
    boss.hostile = true;
    boss.maxHp = 5000;
    boss.hp = 2500; // damaged, so there is healing to do
    boss.moveSpeed = 0; // pin it so it doesn't wander out of Malric's standoff
    boss.pos = { x: 0, y: 0, z: 0 };
    boss.prevPos = { ...boss.pos };
    const malric = spawn(sim, 8201, 'nythraxis_heroic_priest_add');
    malric.hostile = true;
    malric.pos = { x: 4, y: 0, z: 0 };
    malric.prevPos = { ...malric.pos };
    malric.aggroTargetId = pid;
    malric.threat.set(pid, 1000);
    for (let i = 0; i < 20 * 3; i++) sim.tick();
    const distToBoss = Math.hypot(malric.pos.x - boss.pos.x, malric.pos.z - boss.pos.z);
    expect(distToBoss).toBeLessThan(8); // held near the boss
    expect(malric.pos.x).toBeLessThan(8); // did NOT chase the player at x=12
    expect(malric.castingAbility).toBe('nythraxis_spirit_mending'); // standing and casting
  });

  it('a shadow-school lockout breaks the channel and resets the ramp', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const boss = spawn(sim, 8401, 'nythraxis_scourge_of_thornpeak', 1000);
    const malric = spawn(sim, 8402, 'nythraxis_heroic_priest_add');
    boss.pos = { x: 4, y: 0, z: 0 };
    tickOneChannel(sim, malric, boss); // 320
    expect(tickOneChannel(sim, malric, boss)).toBe(560); // ramp built
    // A successful interrupt lands a shadow-school lockout (the scripted channel
    // is registered in SCRIPTED_INTERRUPTIBLE_CHANNELS). The channel breaks and
    // the ramp resets, exactly like the silence path.
    malric.auras.push({
      id: 'test_lockout',
      name: 'Test Lockout',
      kind: 'lockout',
      remaining: 4,
      duration: 4,
      value: 0,
      sourceId: 0,
      school: 'shadow',
    });
    expect(tickOneChannel(sim, malric, boss)).toBe(0); // locked out: no heal
    expect(malric.channelRamp).toBe(0);
  });

  it('a silence breaks the channel and resets the ramp', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const boss = spawn(sim, 8401, 'nythraxis_scourge_of_thornpeak', 1000);
    const malric = spawn(sim, 8402, 'nythraxis_heroic_priest_add');
    boss.pos = { x: 4, y: 0, z: 0 };
    tickOneChannel(sim, malric, boss); // 320
    expect(tickOneChannel(sim, malric, boss)).toBe(560); // ramp built
    malric.auras.push({
      id: 'test_silence',
      name: 'Test Silence',
      kind: 'silence',
      remaining: 10,
      duration: 10,
      value: 0,
      sourceId: 0,
      school: 'shadow',
    });
    expect(tickOneChannel(sim, malric, boss)).toBe(0); // silenced: no heal
    expect(malric.channelRamp).toBe(0);
  });

  it('the ramp caps at maxHeal and the heroic heal multiplier applies', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const boss = spawn(sim, 8501, 'nythraxis_scourge_of_thornpeak', 1); // huge pool, deeply wounded
    boss.maxHp = 1_000_000;
    const malric = spawn(sim, 8502, 'nythraxis_heroic_priest_add');
    malric.mechanicHealMult = 1.6; // the heroic-instance multiplier the balance rests on
    boss.pos = { x: 4, y: 0, z: 0 };
    // First tick reflects the 1.6x multiplier (a heal crit only adds on top).
    const first = tickOneChannel(sim, malric, boss);
    expect(first).toBeGreaterThanOrEqual(Math.round(320 * 1.6)); // baseHeal x mult
    // The ramp is capped so base+ramp never exceeds maxHeal (1440): cap = 1440 - 320.
    for (let i = 0; i < 12; i++) tickOneChannel(sim, malric, boss);
    expect(malric.channelRamp).toBe(1440 - 320);
  });
});
