// Target-dummy DPS sim (the empirical layer of the balance framework). Drives the
// REAL Sim: a level-20 caster vs an immortal, passive training dummy, with infinite
// mana, and measures actual damage dealt over a long fight. Two modes per class:
//   - per-nuke SPAM dps: cast ONLY this spell whenever the GCD/cooldown/cast allow.
//     This is the empirical "is this nuke worth casting" number (validates the
//     analytical balance_report.mjs).
//   - ROTATION dps: a simple priority (keep DoTs up, then spam the best nuke), the
//     real single-target throughput a class achieves.
//
// Run: npx tsx scripts/dummy_sim.mjs [class]   (no server needed)

import { abilitiesKnownAt } from '../src/sim/content/classes.ts';
import { MOBS } from '../src/sim/data.ts';
import { createMob } from '../src/sim/entity.ts';
import { Sim } from '../src/sim/sim.ts';
import { DT, MAX_LEVEL } from '../src/sim/types.ts';

const SECONDS = 300;
const TICKS = Math.round(SECONDS / DT);

function setup(cls) {
  const sim = new Sim({ seed: 12345, playerClass: 'warrior', noPlayer: true });
  const pid = sim.addPlayer(cls, 'Ref');
  sim.setPlayerLevel(MAX_LEVEL, pid);
  sim.tick();
  const p = sim.entities.get(pid);
  // Immortal, passive dummy at 25yd (in spell range, out of melee so it never
  // swings -> no cast pushback). Kept idle and de-aggroed every tick.
  const dummy = createMob(sim.nextId++, MOBS.forest_wolf, MAX_LEVEL, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + 8,
  });
  dummy.hostile = true;
  dummy.aiState = 'idle';
  dummy.maxHp = 1e12;
  dummy.hp = 1e12;
  sim.addEntity(dummy);
  const dpos = { ...dummy.pos };
  p.facing = Math.atan2(dummy.pos.x - p.pos.x, dummy.pos.z - p.pos.z);
  sim.targetEntity(dummy.id, p.id);

  // capture damage dealt to the dummy by the player
  let dealt = 0;
  const orig = sim.emit.bind(sim);
  sim.emit = (e) => {
    if (e?.type === 'damage' && e.targetId === dummy.id && e.sourceId === p.id)
      dealt += e.amount || 0;
    return orig(e);
  };
  const tick = () => {
    p.resource = p.maxResource; // infinite mana
    // keep the dummy an immortal, pinned, passive punching bag (out of melee, idle)
    dummy.hp = 1e12;
    dummy.aiState = 'idle';
    dummy.targetId = null;
    dummy.pos.x = dpos.x;
    dummy.pos.y = dpos.y;
    dummy.pos.z = dpos.z;
    p.facing = Math.atan2(dummy.pos.x - p.pos.x, dummy.pos.z - p.pos.z);
    sim.tick();
  };
  return { sim, p, pid, dummy, getDealt: () => dealt, tick };
}

function canCast(p, _sim, id) {
  return !p.castingAbility && p.gcdRemaining <= 0 && !p.cooldowns.has(id);
}

function spamDPS(cls, id) {
  const s = setup(cls);
  for (let i = 0; i < TICKS; i++) {
    if (canCast(s.p, s.sim, id)) s.sim.castAbility(id, s.pid);
    s.tick();
  }
  return s.getDealt() / SECONDS;
}

// Priority rotation: keep listed DoTs applied, then cast the first castable nuke.
function rotationDPS(cls, dots, nukes) {
  const s = setup(cls);
  for (let i = 0; i < TICKS; i++) {
    if (canCast(s.p, s.sim, 'x')) {
      // refresh a DoT that is missing/expiring on the dummy
      let acted = false;
      for (const d of dots) {
        const aura = s.dummy.auras.find((a) => a.id === d);
        if ((!aura || aura.remaining < 1.5) && canCast(s.p, s.sim, d)) {
          s.sim.castAbility(d, s.pid);
          acted = true;
          break;
        }
      }
      if (!acted)
        for (const n of nukes) {
          if (canCast(s.p, s.sim, n)) {
            s.sim.castAbility(n, s.pid);
            break;
          }
        }
    }
    s.tick();
  }
  return s.getDealt() / SECONDS;
}

const ROTATIONS = {
  mage: { dots: [], nukes: ['fireball', 'frostbolt', 'scorch'] },
  warlock: {
    dots: ['corruption', 'curse_of_agony', 'immolate'],
    nukes: ['shadow_bolt', 'searing_pain'],
  },
  priest: { dots: ['shadow_word_pain'], nukes: ['mind_blast', 'mind_flay', 'smite'] },
  shaman: { dots: ['flame_shock'], nukes: ['lightning_bolt', 'earth_shock'] },
  druid: { dots: ['moonfire', 'insect_swarm'], nukes: ['starfire', 'wrath'] },
};
const DMG = new Set(['directDamage', 'aoeDamage', 'aoeRoot', 'dot', 'drainTick']);

const only = process.argv[2];
for (const cls of Object.keys(ROTATIONS)) {
  if (only && cls !== only) continue;
  console.log(`\n=== ${cls.toUpperCase()} (target dummy, ${SECONDS}s, infinite mana) ===`);
  const nukes = abilitiesKnownAt(cls, MAX_LEVEL)
    .filter(
      (k) =>
        k.def.class === cls &&
        k.def.school !== 'physical' &&
        k.effects.some((e) => DMG.has(e.type)),
    )
    .map((k) => k.def.id);
  const rows = nukes.map((id) => ({ id, dps: spamDPS(cls, id) })).sort((a, b) => b.dps - a.dps);
  for (const r of rows) console.log(`  spam ${r.id.padEnd(18)} ${r.dps.toFixed(1)} dps`);
  const rot = rotationDPS(cls, ROTATIONS[cls].dots, ROTATIONS[cls].nukes);
  console.log(`  >>> ROTATION dps: ${rot.toFixed(1)}`);
}
