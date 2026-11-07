// The Smith's Heart raid bots' rotations measured headless: each damage
// dealer of the bot raid (scripts/lib/heart_raid_bots.mjs ROSTER) plays its
// rotation from scripts/lib/heart_raid_kits.mjs against an inert level-20
// target with a raid boss's armor, standing still, for a fixed time, in the
// gear the raid runs with (GEAR=kit: the fresh level-20 preset; GEAR=bis: the
// top Nythraxis parse loadout, the previous tier's best). The number is the
// rotation's ceiling with no movement and no mechanics, the yardstick for the
// live raid's DPS (docs: E:/woc/entregas/raid_corazon/heroico/NOTAS.md).
//
//   GEAR=bis SECONDS=120 npx tsx scripts/heart_raid_kit_probe.ts [key...]
//
// DEV ONLY tooling.

import { ruinAmount } from '../src/sim/combat/destruction';
import { BUILTIN_WORLD, MOBS } from '../src/sim/data';
import { equipBestInSlotForDev } from '../src/sim/dev/bis_gear';
import { applyDevKit } from '../src/sim/dev_kit';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { dist2d, type Entity, type PlayerClass, type WorldContent } from '../src/sim/types';
import { BUILDS, PREPULL, ROTATIONS } from './lib/heart_raid_kits.mjs';
import { anchorProbeInOpenField } from './probe_anchor';

const ROSTER: { key: string; cls: PlayerClass; melee: boolean }[] = [
  { key: 'mt', cls: 'warrior', melee: true },
  { key: 'ot', cls: 'paladin', melee: true },
  { key: 'rogue', cls: 'rogue', melee: true },
  { key: 'arms', cls: 'warrior', melee: true },
  { key: 'mage', cls: 'mage', melee: false },
  { key: 'hunter', cls: 'hunter', melee: false },
  { key: 'lock', cls: 'warlock', melee: false },
  { key: 'ele', cls: 'shaman', melee: false },
];

const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

type ProbeSim = Sim & { addEntity(entity: Entity): void };

function fingerprint(p: Entity, id: string): string {
  return JSON.stringify([
    p.resource,
    p.gcdRemaining,
    p.castingAbility,
    p.cooldowns.get(id) ?? null,
    p.auras.length,
  ]);
}

export function probeKit(
  key: string,
  seed: number,
  seconds: number,
  gear: string,
): { dps: number; casts: Record<string, number>; manaEnd: number } {
  const row = ROSTER.find((r) => r.key === key);
  if (!row) throw new Error(`no roster key ${key}`);
  const base = BUILDS[key as keyof typeof BUILDS];
  const build = {
    spec: base.spec,
    rows: { ...base.rows, ...JSON.parse(process.env.ROWS ?? '{}') },
  };
  const sim = new Sim({ seed, playerClass: row.cls, autoEquip: false, world: WORLD }) as ProbeSim;
  sim.setPlayerLevel(20);
  anchorProbeInOpenField(sim);
  if (!sim.applyTalents({ spec: build.spec, rows: { ...build.rows } }))
    throw new Error(`${key}: talents refused`);
  const pid = sim.playerId;
  if (gear === 'bis') equipBestInSlotForDev(sim.ctx, pid, build.spec);
  else applyDevKit(sim.ctx as never, row.cls, build.spec, pid);
  const p = sim.player;
  for (const id of PREPULL[key as keyof typeof PREPULL] ?? []) {
    sim.castAbility(id.replace('*', ''));
    for (let i = 0; i < 120; i++) sim.tick();
    p.gcdRemaining = 0;
  }
  const dist = row.melee ? 2.5 : 18;
  const target = createMob(sim.nextId++, MOBS.training_dummy, 20, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + dist,
  });
  target.hostile = true;
  target.aiState = 'idle';
  target.moveSpeed = 0;
  target.stats.armor = 800;
  target.maxHp = 100_000_000;
  target.hp = target.maxHp;
  target.weapon.min = 0;
  target.weapon.max = 0;
  target.weapon.speed = 100;
  sim.addEntity(target);
  sim.targetEntity(target.id);
  p.facing = Math.atan2(target.pos.x - p.pos.x, target.pos.z - p.pos.z);
  p.resource = p.resourceType === 'rage' ? 0 : p.maxResource;
  sim.drainEvents();
  sim.startAutoAttack();
  const t0 = sim.time;
  const failedAt = new Map<string, number>();
  const casts: Record<string, number> = {};
  const rotation = ROTATIONS[build.spec as keyof typeof ROTATIONS];
  const c = {
    get res() {
      return p.resource;
    },
    get mres() {
      return p.maxResource;
    },
    get manaPct() {
      return p.resourceType === 'mana' ? p.resource / p.maxResource : 1;
    },
    get combo() {
      return p.comboPoints;
    },
    get hpPct() {
      return p.hp / p.maxHp;
    },
    get tPct() {
      return 0.6;
    },
    get dist() {
      return dist2d(p.pos, target.pos);
    },
    get age() {
      return sim.time - t0;
    },
    moving: false,
    stillFor: 99,
    get devotion() {
      return p.paladinDevotion?.value ?? 0;
    },
    get ruin() {
      return ruinAmount(p);
    },
    aura(id: string) {
      const a = p.auras.find((x) => x.id === id || x.kind === id);
      return a ? { stacks: a.stacks ?? 1, rem: a.remaining } : null;
    },
    tAura(id: string) {
      const a = target.auras.find((x) => x.id === id && x.sourceId === p.id);
      return a ? { stacks: a.stacks ?? 1, rem: a.remaining } : null;
    },
    ready(id: string) {
      const r = sim.resolvedAbility(id);
      if (!r) return false;
      if ((failedAt.get(id) ?? -99) > sim.time - 1) return false;
      if (p.resource < r.cost) return false;
      if ((p.cooldowns.get(r.cooldownId ?? r.def.id) ?? 0) > 0.05) return false;
      if (!r.def.offGcd && p.gcdRemaining > 0.001) return false;
      return true;
    },
  };
  let total = 0;
  for (let tick = 0; tick < seconds * 20; tick++) {
    if (!p.castingAbility) {
      for (let tries = 0; tries < 3; tries++) {
        const id = rotation(c);
        if (!id) break;
        const before = fingerprint(p, id);
        sim.castAbility(id);
        if (fingerprint(p, id) === before) failedAt.set(id, sim.time);
        else {
          casts[id] = (casts[id] ?? 0) + 1;
          break;
        }
      }
    }
    for (const ev of sim.tick()) {
      if (ev.type !== 'damage' || ev.targetId !== target.id) continue;
      const src = sim.entities.get(ev.sourceId);
      if (ev.sourceId === p.id || src?.ownerId === p.id) total += ev.amount;
    }
  }
  const threat = target.threat.get(p.id) ?? 0;
  if (process.env.THREAT) console.log(`  ${key} threat/s ${(Number(threat) / seconds).toFixed(1)}`);
  return { dps: total / seconds, casts, manaEnd: c.manaPct };
}

if (process.argv[1]?.endsWith('heart_raid_kit_probe.ts')) {
  const gear = (process.env.GEAR ?? 'bis').toLowerCase();
  const seconds = Number(process.env.SECONDS ?? 120);
  const keys = process.argv.slice(2).length ? process.argv.slice(2) : ROSTER.map((r) => r.key);
  for (const key of keys) {
    const runs = [11, 22, 33].map((seed) => probeKit(key, seed, seconds, gear));
    const dps = runs.reduce((s, r) => s + r.dps, 0) / runs.length;
    const casts = Object.entries(runs[0].casts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k} ${n}`)
      .join(', ');
    console.log(
      `${key.padEnd(7)} ${gear} ${seconds}s: ${dps.toFixed(1)} DPS (mana end ${(runs[0].manaEnd * 100).toFixed(0)}%) | ${casts}`,
    );
  }
}
