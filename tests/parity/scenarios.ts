// Parity scenarios: deterministic, seed-pinned drives that exercise the sim's
// behavior so that any future extraction is checked against a committed golden.
//
// Coverage matrix (every item is mandatory per the S0a brief):
//  - multiple classes:        warrior / mage / rogue / hunter / warlock / paladin
//  - meleeSwing weaponStrike:  heroic_strike (warrior), sinister_strike (rogue)
//  - auto-attack + mobSwing:   solo_warrior (mob swings back)
//  - frenzy + on-hit affix:    affix_mob (old_greyjaw frenzyOnHit + ridge_stalker bleed)
//  - mob-swing affix cascade:  mob_swing_affixes (stun/venom/silence/rampage + friendly-pet short-circuit, M3)
//  - pets:                     hunter_pet (updateRangedPetAttack), warlock_pet (mobSwing pet arm + applyTaunt)
//  - ground-AoE:               paladin_consecration (updateGroundAoEs first + pulseGroundAoE both callers)
//  - arena + fiesta:           arena_1v1, fiesta
//  - delve + lockpick:         delve_lockpick
//  - loot roll:                solo_warrior (death->rollLoot), party_loot (need/greed)
//  - loot distribution (L1):   l1_loot_distribution (fair-split remainder draw, need/greed/pass, personal/looter-takes-all)
//
// All drives are MOVE-safe: they only call public Sim methods + the documented
// internal plumbing the existing tests use (createMob/addEntity, dealDamage,
// mobSwing, spawnDelveModule), never reaching into not-yet-extracted internals
// in a way the sim itself does not already expose.

import { arenaOrigin, DELVES, instanceOrigin, MOBS, PROPS, QUESTS } from '../../src/sim/data';
import { createMob } from '../../src/sim/entity';
import { solveLockActions } from '../../src/sim/lockpick';
import { Sim } from '../../src/sim/sim';
import { addThreat } from '../../src/sim/threat';
import {
  type Aura,
  CAST_QUEUE_WINDOW_SEC,
  DT,
  dist2d,
  type Entity,
  FISHING_CAST_ID,
  MAX_LEVEL,
  NYTHRAXIS_ADD_ID,
  NYTHRAXIS_BOSS_ID,
  PRESTIGE_XP_PER_RANK,
  SISTER_NHALIA_BOSS_ID,
  xpForLevel,
} from '../../src/sim/types';
import { terrainHeight } from '../../src/sim/world';
import type { Recorder, Scenario } from './record';

// ----- shared helpers ---------------------------------------------------------

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

// Move an entity to (x,z) on the terrain and keep the spatial grid consistent —
// the same idiom every existing scenario test uses.
function teleport(sim: AnySim, e: AnyEntity, x: number, z: number): void {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = terrainHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  e.vx = 0;
  e.vy = 0;
  e.vz = 0;
  e.onGround = true;
  e.fallStartY = e.pos.y;
  sim.rebucket(e);
}

// Spawn a mob from a template key and register it (entities + spatial grid),
// allocating a fresh id from nextId so it never collides with ctor spawns.
function spawnMob(
  sim: AnySim,
  key: string,
  level: number,
  x: number,
  y: number,
  z: number,
): AnyEntity {
  const mob = createMob(sim.nextId++, MOBS[key], level, { x, y, z }) as AnyEntity;
  sim.addEntity(mob);
  return mob;
}

// Face `e` toward `target` (sim uses atan2(dx, dz), 0 = +Z).
function face(e: AnyEntity, target: AnyEntity): void {
  e.facing = Math.atan2(target.pos.x - e.pos.x, target.pos.z - e.pos.z);
}

// Make an entity a damage sponge so a scenario can run long enough to fire its
// target path repeatedly without anyone dying early.
function beef(e: AnyEntity, hp = 50000): void {
  e.maxHp = hp;
  e.hp = hp;
}

// Aggro `mob` onto `target` so the mob's tick AI drives real mobSwing calls.
function aggroOnto(mob: AnyEntity, target: AnyEntity): void {
  mob.hostile = true;
  mob.aiState = 'attack';
  mob.aggroTargetId = target.id;
  mob.targetId = target.id;
}

const lethal = (sim: AnySim, src: AnyEntity | null, target: AnyEntity): void => {
  sim.dealDamage(src, target, target.maxHp + 1000, false, 'physical', null, 'hit', true);
};

// ----- scenarios --------------------------------------------------------------

// Warrior: auto-attack + heroic_strike (the castAbility -> meleeSwing weaponStrike
// entry) against a mob that swings back (base mobSwing), then a lethal blow that
// runs the death -> rollLoot path.
function soloWarrior(): Scenario {
  return {
    name: 'solo_warrior',
    coverage: [
      'class:warrior',
      'meleeSwing weaponStrike (heroic_strike via castAbility ~3736)',
      'player auto-attack (C5)',
      'base mobSwing (mob swings the player)',
      'rollLoot via mob death (L1, ~5876/6036)',
    ],
    build: () => new Sim({ seed: 1001, playerClass: 'warrior', autoEquip: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      sim.setPlayerLevel(10);
      const p = sim.player as AnyEntity;
      beef(p);
      const mob = spawnMob(sim, 'forest_wolf', 2, p.pos.x + 2, p.pos.y, p.pos.z);
      beef(mob, 6000);
      rec.track(mob.id);
      teleport(sim, p, mob.pos.x - 1.5, mob.pos.z);
      face(p, mob);
      sim.targetEntity(mob.id);
      aggroOnto(mob, p);
      sim.startAutoAttack();
      for (let round = 0; round < 6; round++) {
        p.resource = p.maxResource; // keep rage for heroic_strike
        if (p.gcdRemaining <= 0 && !p.castingAbility) sim.castAbility('heroic_strike');
        rec.tick(12);
        face(p, mob);
      }
      // Death -> credit -> rollLoot.
      mob.hp = mob.maxHp;
      lethal(sim, p, mob);
      rec.snapshot('kill');
      rec.tick(4);
    },
  };
}

// Mage: the casting lifecycle (cast time -> effect dispatch -> spell damage)
// driven by repeated fireball/frostbolt at a ranged target.
function soloMage(): Scenario {
  return {
    name: 'solo_mage',
    coverage: [
      'class:mage (caster)',
      'casting lifecycle (C4a)',
      'effect dispatch + spell damage (C4b/C1)',
    ],
    build: () => new Sim({ seed: 1002, playerClass: 'mage', autoEquip: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      sim.setPlayerLevel(10);
      const p = sim.player as AnyEntity;
      beef(p);
      const mob = spawnMob(sim, 'forest_wolf', 5, p.pos.x, p.pos.y, p.pos.z + 18);
      beef(mob, 9000);
      rec.track(mob.id);
      face(p, mob);
      sim.targetEntity(mob.id);
      const spells = ['fireball', 'frostbolt'];
      for (let round = 0; round < 8; round++) {
        p.resource = p.maxResource; // mana
        if (p.gcdRemaining <= 0 && !p.castingAbility)
          sim.castAbility(spells[round % spells.length]);
        rec.tick(16);
        face(p, mob);
      }
    },
  };
}

// Rogue: sinister_strike (another castAbility -> meleeSwing weaponStrike entry)
// building combo points.
function soloRogue(): Scenario {
  return {
    name: 'solo_rogue',
    coverage: [
      'class:rogue',
      'meleeSwing weaponStrike (sinister_strike via castAbility ~3736)',
      'combo points',
    ],
    build: () => new Sim({ seed: 1003, playerClass: 'rogue', autoEquip: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      sim.setPlayerLevel(10);
      const p = sim.player as AnyEntity;
      beef(p);
      const mob = spawnMob(sim, 'forest_wolf', 5, p.pos.x + 2, p.pos.y, p.pos.z);
      beef(mob, 9000);
      rec.track(mob.id);
      teleport(sim, p, mob.pos.x - 1.5, mob.pos.z);
      face(p, mob);
      sim.targetEntity(mob.id);
      aggroOnto(mob, p);
      sim.startAutoAttack();
      for (let round = 0; round < 6; round++) {
        p.resource = p.maxResource; // energy
        if (p.gcdRemaining <= 0 && !p.castingAbility) sim.castAbility('sinister_strike');
        rec.tick(12);
        face(p, mob);
      }
    },
  };
}

// Frenzy + on-hit affix cascade: the player hits old_greyjaw (frenzyOnHit ->
// blood_frenzy buff) while ridge_stalker swings the player (bleed on-hit affix).
// Both procs are forced deterministically by pinning the affix chance to 1 (which
// still draws rng through the real path, so the draw log stays meaningful) and
// restored afterward so the shared MOBS table is left untouched.
function affixMob(): Scenario {
  return {
    name: 'affix_mob',
    coverage: [
      'frenzyOnHit (old_greyjaw -> blood_frenzy)',
      'on-hit affix cascade via mobSwing (ridge_stalker bleed, ~7070/7100)',
      'applyTaunt player-cast arm (taunt ability, ~4279)',
      'class:warrior',
    ],
    build: () => new Sim({ seed: 1004, playerClass: 'warrior', autoEquip: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      sim.setPlayerLevel(13);
      const p = sim.player as AnyEntity;
      beef(p, 90000);
      const greyjaw = spawnMob(sim, 'old_greyjaw', 4, p.pos.x + 2, p.pos.y, p.pos.z);
      const stalker = spawnMob(sim, 'ridge_stalker', 13, p.pos.x - 2, p.pos.y, p.pos.z);
      beef(greyjaw, 60000);
      beef(stalker, 60000);
      aggroOnto(greyjaw, p);
      aggroOnto(stalker, p);
      rec.track(greyjaw.id, stalker.id);
      teleport(sim, p, greyjaw.pos.x - 1.5, greyjaw.pos.z);

      const greyTrait = MOBS.old_greyjaw.frenzyOnHit;
      const stalkBleed = MOBS.ridge_stalker.bleed;
      const greyOrig = greyTrait ? greyTrait.chance : undefined;
      const bleedOrig = stalkBleed ? stalkBleed.chance : undefined;
      try {
        // Inside the try so the finally restore covers every path (MOBS is a
        // process-wide singleton shared across all scenarios in one test run).
        if (greyTrait) greyTrait.chance = 1;
        if (stalkBleed) stalkBleed.chance = 1;
        for (let round = 0; round < 5; round++) {
          // player wounds greyjaw -> frenzyOnHit proc (source !== target)
          sim.dealDamage(p, greyjaw, 40, false, 'physical', null, 'hit', true);
          // stalker swings player -> bleed on-hit affix (direct, the exerciser path)
          sim.mobSwing(stalker, p);
          rec.tick(10);
        }
      } finally {
        if (greyTrait && greyOrig !== undefined) greyTrait.chance = greyOrig;
        if (stalkBleed && bleedOrig !== undefined) stalkBleed.chance = bleedOrig;
      }
      // Player-cast taunt on the (still-alive, beefed) greyjaw -> applyTaunt ~4279.
      sim.targetEntity(greyjaw.id);
      sim.castAbility('taunt');
      rec.snapshot('taunt');
      rec.tick(4);
    },
  };
}

// M3 mob on-hit affix cascade: four hostile mobs, each carrying a distinct
// heavy-hitter affix, swing a player so the cascade's per-template proc rng.chance
// rolls fire at fixed stream positions and land their auras (stun / venom DoT /
// silence, chances pinned to 1 in a try/finally so the shared MOBS table is restored;
// rampage self-buff is unconditional). A FRIENDLY (hostile=false) pet also swings a
// separate mob through mobSwing so the load-bearing `mob.hostile` short-circuit branch
// -- which draws NO cascade rng and applies no debuff to the mob it hits -- is pinned
// in the trace too. The affix mobs sit one level above the player so the base hit
// table lands reliably (a missed/dodged base swing short-circuits the whole cascade).
function mobSwingAffixes(): Scenario {
  return {
    name: 'mob_swing_affixes',
    coverage: [
      'mobSwing affix cascade: stunOnHit (mogger_lackey -> stun aura on player)',
      'mobSwing affix cascade: venom DoT (webwood_spider -> dot aura on player)',
      'mobSwing affix cascade: silence (gravecaller_summoner -> silence aura on player)',
      'mobSwing affix cascade: rampage stacking buff_ap (warlord_drogmar self-buff)',
      'friendly-pet mobSwing: mob.hostile=false short-circuits every proc (no debuff on its target)',
    ],
    build: () => new Sim({ seed: 1007, playerClass: 'warrior', autoEquip: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      sim.setPlayerLevel(16);
      const p = sim.player as AnyEntity;
      // beef() does not stick on a player (applyAura -> recalcPlayerStats resets maxHp,
      // and several affixes ride negative buff_* drains); top the player up right before
      // each swing so it survives every draw, mirroring mob_locomotion's reviveTarget.
      const topUp = () => {
        p.hp = 1_000_000;
      };
      const lackey = spawnMob(sim, 'mogger_lackey', 18, p.pos.x + 2, p.pos.y, p.pos.z);
      const spider = spawnMob(sim, 'webwood_spider', 18, p.pos.x - 2, p.pos.y, p.pos.z);
      const summoner = spawnMob(sim, 'gravecaller_summoner', 18, p.pos.x + 3, p.pos.y, p.pos.z);
      const drogmar = spawnMob(sim, 'warlord_drogmar', 18, p.pos.x - 3, p.pos.y, p.pos.z);
      for (const m of [lackey, spider, summoner, drogmar]) {
        beef(m, 200000);
        aggroOnto(m, p);
      }
      // Friendly pet: a hostile=false forest_wolf (affix-free) swinging a separate mob.
      // Every cascade guard short-circuits on its hostile flag, so it deals base damage
      // but applies no on-hit debuff to the mob it hits.
      const pet = spawnMob(sim, 'forest_wolf', 8, p.pos.x + 1, p.pos.y, p.pos.z);
      pet.ownerId = p.id;
      pet.hostile = false;
      const dummy = spawnMob(sim, 'forest_wolf', 8, p.pos.x + 9, p.pos.y, p.pos.z);
      beef(dummy, 200000);
      rec.track(lackey.id, spider.id, summoner.id, drogmar.id, pet.id, dummy.id);
      rec.notes.petId = pet.id;
      rec.notes.dummyId = dummy.id;
      teleport(sim, p, lackey.pos.x - 1.5, lackey.pos.z);

      // OR-accumulate "ever landed" across rounds so a single base miss never makes the
      // coverage assertion flaky; deterministic for this seed (the golden pins it).
      let stunLanded = false;
      let venomLanded = false;
      let silenceLanded = false;
      let rampageStacks = 0;
      let dummyDebuffs = 0;

      const stun = MOBS.mogger_lackey.stunOnHit;
      const venom = MOBS.webwood_spider.venom;
      const silence = MOBS.gravecaller_summoner.silence;
      const stunOrig = stun ? stun.chance : undefined;
      const venomOrig = venom ? venom.chance : undefined;
      const silenceOrig = silence ? silence.chance : undefined;
      try {
        if (stun) stun.chance = 1;
        if (venom) venom.chance = 1;
        if (silence) silence.chance = 1;
        for (let round = 0; round < 6; round++) {
          topUp();
          sim.mobSwing(lackey, p);
          topUp();
          sim.mobSwing(spider, p);
          topUp();
          sim.mobSwing(summoner, p);
          topUp();
          sim.mobSwing(drogmar, p);
          stunLanded = stunLanded || p.auras.some((a: any) => a.id === 'stun_mogger_lackey');
          venomLanded = venomLanded || p.auras.some((a: any) => a.id === 'venom_webwood_spider');
          silenceLanded =
            silenceLanded || p.auras.some((a: any) => a.id === 'silence_gravecaller_summoner');
          rampageStacks = Math.max(
            rampageStacks,
            drogmar.auras.find((a: any) => a.id === 'rampage_warlord_drogmar')?.stacks ?? 0,
          );
          // Friendly pet swings the dummy: base hit only, no cascade procs.
          sim.mobSwing(pet, dummy);
          dummyDebuffs = Math.max(dummyDebuffs, dummy.auras.length);
          rec.tick(10);
        }
      } finally {
        if (stun && stunOrig !== undefined) stun.chance = stunOrig;
        if (venom && venomOrig !== undefined) venom.chance = venomOrig;
        if (silence && silenceOrig !== undefined) silence.chance = silenceOrig;
      }
      rec.notes.stunLanded = stunLanded;
      rec.notes.venomLanded = venomLanded;
      rec.notes.silenceLanded = silenceLanded;
      rec.notes.rampageStacks = rampageStacks;
      rec.notes.dummyDebuffs = dummyDebuffs;
      topUp();
      rec.snapshot('affixes');
      rec.tick(4);
    },
  };
}

// Ranged pet spell path, BOTH callers of updateRangedPetAttack:
//  - friendly arm (~8093): a ranged_dps pet (warlock_imp: petSpell Ashbolt)
//    adopted onto the hunter.
//  - hostile mob arm (~6776): a WILD warlock_imp (ownerId null) whose attack-state
//    AI fires its petSpell at the player.
function hunterPet(): Scenario {
  return {
    name: 'hunter_pet',
    coverage: [
      'class:hunter',
      'updateRangedPetAttack friendly pet arm (~8093/8217)',
      'updateRangedPetAttack hostile-mob arm (~6776)',
    ],
    build: () => new Sim({ seed: 1005, playerClass: 'hunter', autoEquip: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      sim.setPlayerLevel(12);
      const p = sim.player as AnyEntity;
      beef(p);
      const pet = spawnMob(sim, 'warlock_imp', 8, p.pos.x + 1, p.pos.y, p.pos.z);
      pet.ownerId = p.id;
      pet.hostile = false;
      pet.hp = pet.maxHp;
      pet.petMode = 'aggressive';
      rec.track(pet.id);
      const target = spawnMob(sim, 'forest_wolf', 8, p.pos.x + 7, p.pos.y, p.pos.z);
      beef(target);
      aggroOnto(target, p);
      pet.aggroTargetId = target.id;
      rec.track(target.id);
      // A wild (hostile, un-owned) petSpell mob whose AI shoots the player -> 6776.
      const hostileImp = spawnMob(sim, 'warlock_imp', 8, p.pos.x - 8, p.pos.y, p.pos.z);
      hostileImp.ownerId = null;
      beef(hostileImp);
      aggroOnto(hostileImp, p);
      rec.track(hostileImp.id);
      rec.notes.hostileImpId = hostileImp.id;
      sim.targetEntity(target.id);
      sim.startAutoAttack();
      rec.tick(120); // 6s: friendly Ashbolt every 2s + hostile fire demon shoots the player
    },
  };
}

// Warlock melee pet: summon_voidwalker (melee_tank) swings through the pet arm of
// mobSwing and taunts via the applyTaunt pet arm.
function warlockPet(): Scenario {
  return {
    name: 'warlock_pet',
    coverage: [
      'class:warlock (caster)',
      'mobSwing pet arm (voidwalker melee ~8117)',
      'applyTaunt pet auto-taunt arm (~8110)',
      'applyTaunt pet manual-taunt arm (petTaunt, ~4885)',
    ],
    build: () => new Sim({ seed: 1006, playerClass: 'warlock', autoEquip: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      sim.setPlayerLevel(12);
      const p = sim.player as AnyEntity;
      beef(p);
      p.resource = p.maxResource;
      sim.castAbility('summon_voidwalker');
      for (let i = 0; i < 20 * 12 && p.castingAbility; i++) rec.tick(1);
      const pet = sim.petOf(sim.playerId) as AnyEntity | null;
      if (pet) {
        rec.track(pet.id);
        pet.petMode = 'aggressive';
        pet.petAutoTaunt = true;
        pet.petTauntTimer = 0;
      }
      const target = spawnMob(sim, 'forest_wolf', 8, p.pos.x + 5, p.pos.y, p.pos.z);
      beef(target);
      aggroOnto(target, p);
      if (pet) pet.aggroTargetId = target.id;
      rec.track(target.id);
      sim.targetEntity(target.id);
      sim.startAutoAttack();
      rec.tick(120);
      // Manual pet taunt: place the pet in PET_TAUNT_RANGE (5) and command it ->
      // applyTaunt via petTaunt (~4885), distinct from the auto-taunt arm (~8110).
      if (pet) {
        pet.pos = { x: target.pos.x - 1, y: target.pos.y, z: target.pos.z };
        pet.prevPos = { ...pet.pos };
        sim.rebucket(pet);
        pet.petTauntTimer = 0;
        sim.petTaunt();
        rec.snapshot('pet-taunt');
        rec.tick(4);
      }
    },
  };
}

// P1a pet-AI tick: the slice paths the existing hunter_pet / warlock_pet goldens
// leave UNPINNED. A warlock imp (a petRanged demon) runs the petRangedAttack
// imp-bolt arm (the crit roll + AP-scaled fire damage, distinct from the shared
// updateRangedPetAttack a ranged_dps petSpell mob uses, which hunter_pet covers); a
// voidwalker melee pet with NO pre-set target acquires one via petPickTarget
// (aggressive auto-pull) then closes, auto-taunts, and mobSwings while keeping the
// OWNER inCombat (the PET_COMBAT_LINGER coupling); and finally both pets drop their
// targets and heel-follow a moved owner (petFollow). updatePet draws rng only in the
// imp-bolt arm, so the draw-order log pins petRangedAttack and the full-state sample
// pins petPickTarget / petFollow / the owner inCombat flag tick-by-tick.
function petAi(): Scenario {
  return {
    name: 'pet_ai',
    coverage: [
      'class:hunter (pet owner)',
      'petRangedAttack imp-bolt arm (petRanged crit roll + AP-scaled fire damage)',
      'petPickTarget aggressive auto-pull',
      'updatePet melee arm: close + auto-taunt + mobSwing (PET_COMBAT_LINGER owner inCombat)',
      'petFollow heel transition (pets return to a moved owner)',
    ],
    build: () => new Sim({ seed: 1016, playerClass: 'hunter', autoEquip: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      sim.setPlayerLevel(12);
      const p = sim.player as AnyEntity;
      beef(p);

      // Emberkin (petRanged demon): pre-targeted on a beefed wolf inside bolt range so
      // updatePet runs the petRangedAttack arm (crit roll + AP-scaled fire damage).
      const imp = spawnMob(sim, 'emberkin', 12, p.pos.x + 2, p.pos.y, p.pos.z);
      imp.ownerId = p.id;
      imp.hostile = false;
      imp.hp = imp.maxHp;
      imp.petMode = 'aggressive';
      rec.track(imp.id);
      const impTarget = spawnMob(sim, 'forest_wolf', 8, p.pos.x + 12, p.pos.y, p.pos.z);
      beef(impTarget);
      imp.aggroTargetId = impTarget.id;
      rec.track(impTarget.id);

      // Gloomshade (melee tank): NO pre-set target, so petPickTarget runs the
      // aggressive auto-pull to acquire a beefed wolf in range, then the melee arm
      // closes, auto-taunts the mob, and swings via mobSwing.
      const tank = spawnMob(sim, 'gloomshade', 12, p.pos.x - 2, p.pos.y, p.pos.z);
      tank.ownerId = p.id;
      tank.hostile = false;
      tank.hp = tank.maxHp;
      tank.petMode = 'aggressive';
      tank.petAutoTaunt = true;
      tank.petTauntTimer = 0;
      rec.track(tank.id);
      const tankTarget = spawnMob(sim, 'forest_wolf', 8, p.pos.x - 10, p.pos.y, p.pos.z);
      beef(tankTarget);
      aggroOnto(tankTarget, p);
      rec.track(tankTarget.id);
      rec.notes.impId = imp.id;
      rec.notes.tankId = tank.id;

      // Target + auto-attack the tank's mark: stamps owner activity (so the
      // aggressive auto-pull gate stays open) and drives the owner's own combat.
      sim.targetEntity(tankTarget.id);
      sim.startAutoAttack();
      rec.tick(120); // 6s combat: imp bolts; tank pulls + closes + auto-taunts + swings

      // Heel: drop both pets to passive with no target and move the owner away, so
      // updatePet takes the heel arm (petFollow) each tick and the PET_COMBAT_LINGER
      // coupling releases the owner's inCombat once the pets stop trading blows.
      teleport(sim, impTarget, p.pos.x + 200, p.pos.z);
      teleport(sim, tankTarget, p.pos.x + 200, p.pos.z + 20);
      imp.petMode = 'passive';
      imp.aggroTargetId = null;
      tank.petMode = 'passive';
      tank.aggroTargetId = null;
      teleport(sim, p, p.pos.x + 25, p.pos.z);
      rec.snapshot('heel');
      rec.tick(60); // pets route home; owner regen resumes after the linger window
    },
  };
}

// P1b pet commands/lifecycle: the command surface + create/destroy/persist plumbing
// the hunter_pet/warlock_pet/pet_ai goldens leave UNPINNED. A hunter tames a beast
// (completeTame -> syncPetLevel), cycles pet mode (passive clears aggro/inCombat/
// autoAttack), feeds it (feed_pet HoT replace-then-apply), petTaunts a hostile target
// (applyTaunt manual arm + PET_GROWL_INTERVAL), then ABANDONS it with a mob aggroed
// on the pet so despawnPersistentPet's threat-scrub + retargetMob draws; then re-tames,
// revives a dead pet, and a stow/restore round-trip (serializePet -> despawnPersistentPet
// -> restorePet). A warlock summons a demon, channels Demon Heal (applyDemonHealTick:
// heal2 + healingThreat), swaps demons (despawnPersistentPet + "answers your summons"),
// then re-summons the SAME demon while it is alive (despawnPersistentPet + a fresh
// full-health demon answers, rather than toggling off), then stows a demon so despawnPet
// runs its player-target + threat scrub (retargetMob draw). The despawn scrubs are the
// slice's only rng draws, so the draw-order log pins them; the snapshots pin every state
// change.
function petCommands(): Scenario {
  return {
    name: 'pet_commands',
    coverage: [
      'class:hunter (tame/feed/revive/abandon/stow)',
      'class:warlock (summon/demon-swap/healPet channel)',
      'completeTame + syncPetLevel (tamePet target -> owned pet scaled to owner)',
      'despawnPersistentPet threat-scrub + retargetMob (abandon, demon swap, stow beast)',
      'despawnPet player-target + threat scrub + retargetMob (stow demon)',
      'feedPet feed_pet HoT (replace-then-apply)',
      'revivePet (dead pet -> alive at 35%)',
      'setPetMode passive clears aggroTargetId/inCombat/autoAttack',
      'applyDemonHealTick (heal2 + healingThreat) via the Demon Heal channel',
      'petTaunt -> applyTaunt manual arm + PET_GROWL_INTERVAL cooldown',
      'stowPetForDelve/restorePetFromDelveStash (serializePet/restorePet round-trip)',
    ],
    build: () => new Sim({ seed: 1017, playerClass: 'hunter', autoEquip: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      sim.setPlayerLevel(12);
      const hunter = sim.player as AnyEntity;
      const hid = sim.playerId as number;
      beef(hunter);

      // --- HUNTER: tame -> setMode -> feed ---
      const wolf = spawnMob(sim, 'forest_wolf', 2, hunter.pos.x + 4, hunter.pos.y, hunter.pos.z);
      rec.track(wolf.id);
      (sim as any).completeTame(hunter, wolf); // tamePet effect target -> owned pet, syncPetLevel to owner
      const pet = sim.petOf(hid) as AnyEntity;
      rec.notes.petId = pet.id;
      rec.track(pet.id);

      sim.setPetMode('aggressive');
      pet.aggroTargetId = wolf.id; // give passive something to clear
      pet.inCombat = true;
      pet.autoAttack = true;
      sim.setPetMode('passive'); // clears aggroTargetId/inCombat/autoAttack
      rec.snapshot('pet-passive');
      sim.setPetMode('defensive');

      pet.hp = Math.max(1, Math.floor(pet.maxHp * 0.5)); // wound so feed lands
      sim.addItem('baked_bread', 1, hid);
      sim.feedPet('baked_bread'); // feed_pet HoT applied (replace-then-apply)
      rec.snapshot('pet-fed');
      rec.tick(40); // feed HoT ticks

      // --- HUNTER: petTaunt then ABANDON (despawnPersistentPet retarget scrub draw) ---
      const biter = spawnMob(sim, 'forest_wolf', 8, pet.pos.x + 1, pet.pos.y, pet.pos.z);
      beef(biter);
      biter.hostile = true;
      addThreat(biter, pet.id, 50);
      addThreat(biter, hid, 30);
      biter.aggroTargetId = pet.id;
      biter.targetId = pet.id;
      rec.track(biter.id);
      pet.petTauntTimer = 0;
      pet.aggroTargetId = biter.id;
      sim.petTaunt(); // applyTaunt manual arm + PET_GROWL_INTERVAL
      rec.snapshot('pet-taunt');
      biter.aggroTargetId = pet.id; // force the scrub branch in despawnPersistentPet
      sim.abandonPet(); // despawnPersistentPet(pet): threat-scrub + retargetMob(biter) draw
      rec.snapshot('pet-abandoned');

      // --- HUNTER: re-tame -> revive a dead pet -> stow/restore round-trip ---
      const wolf2 = spawnMob(sim, 'forest_wolf', 2, hunter.pos.x + 4, hunter.pos.y, hunter.pos.z);
      rec.track(wolf2.id);
      (sim as any).completeTame(hunter, wolf2);
      const pet2 = sim.petOf(hid) as AnyEntity;
      rec.notes.pet2Id = pet2.id;
      rec.track(pet2.id);
      pet2.dead = true; // a dead pet to revive
      pet2.hp = 0;
      rec.snapshot('pet-dead');
      sim.revivePet(); // back to life at 35% hp
      rec.snapshot('pet-revived');
      (sim as any).stowPetForDelve(hid); // serializePet + despawnPersistentPet (beast, not demon)
      rec.snapshot('pet-stowed');
      (sim as any).restorePetFromDelveStash(hid); // restorePet from the stash snapshot
      rec.snapshot('pet-restored');

      // --- WARLOCK: summon -> Demon Heal channel -> demon swap -> despawnPet ---
      const wpid = sim.addPlayer('warlock', 'Demonist') as number;
      sim.setPlayerLevel(12, wpid);
      const warlock = sim.entities.get(wpid) as AnyEntity;
      teleport(sim, warlock, hunter.pos.x + 30, hunter.pos.z);
      beef(warlock);
      warlock.resource = warlock.maxResource;
      rec.track(wpid);

      (sim as any).summonPet(warlock, 'emberkin'); // createDemonPet -> "answers your summons"
      const imp = sim.petOf(wpid) as AnyEntity;
      rec.notes.impId = imp.id;
      rec.track(imp.id);
      imp.hp = Math.max(1, Math.floor(imp.maxHp * 0.4)); // wound so Demon Heal lands
      sim.healPet(wpid); // Demon Heal channel start (castStart)
      rec.snapshot('demon-heal-start');
      rec.tick(40); // applyDemonHealTick fires: heal2 + healingThreat
      rec.snapshot('demon-heal-tick');

      (sim as any).summonPet(warlock, 'gloomshade'); // different template: despawnPersistentPet(emberkin) + "answers"
      const vw = sim.petOf(wpid) as AnyEntity;
      rec.notes.voidId = vw.id;
      rec.track(vw.id);
      (sim as any).summonPet(warlock, 'gloomshade'); // same template, alive: dismissed + a fresh full-health demon answers
      const vw2 = sim.petOf(wpid) as AnyEntity;
      rec.notes.void2Id = vw2.id;
      rec.track(vw2.id);
      rec.snapshot('demon-resummoned');

      // despawnPet (demon hard despawn): re-summon, point a player target + mob threat at it, stow the demon.
      (sim as any).summonPet(warlock, 'emberkin');
      const imp2 = sim.petOf(wpid) as AnyEntity;
      rec.notes.imp2Id = imp2.id;
      rec.track(imp2.id);
      hunter.targetId = imp2.id; // player-target scrub target
      const hater = spawnMob(sim, 'forest_wolf', 8, imp2.pos.x + 1, imp2.pos.y, imp2.pos.z);
      beef(hater);
      hater.hostile = true;
      addThreat(hater, imp2.id, 40);
      addThreat(hater, wpid, 20);
      hater.aggroTargetId = imp2.id;
      hater.targetId = imp2.id;
      rec.track(hater.id);
      (sim as any).stowPetForDelve(wpid); // demon -> despawnPet: scrub hunter.targetId + retargetMob(hater) draw
      rec.snapshot('demon-despawned');
    },
  };
}

// Paladin Consecration: a ground AoE so updateGroundAoEs (which runs FIRST in the
// tick) and pulseGroundAoE fire from BOTH callers (the immediate on-cast pulse and
// the deferred interval pulses).
function paladinConsecration(): Scenario {
  return {
    name: 'paladin_consecration',
    coverage: [
      'class:paladin',
      'updateGroundAoEs first-in-tick (~2256)',
      'pulseGroundAoE both callers (immediate ~4097 + deferred ~3052)',
    ],
    build: () => new Sim({ seed: 1007, playerClass: 'paladin', autoEquip: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      sim.setPlayerLevel(20); // consecration learnLevel 18
      const p = sim.player as AnyEntity;
      beef(p);
      const mob = spawnMob(sim, 'forest_wolf', 5, p.pos.x, p.pos.y, p.pos.z + 3);
      beef(mob, 40000);
      mob.hostile = true;
      rec.track(mob.id);
      teleport(sim, p, mob.pos.x, mob.pos.z - 2); // mob within the 8yd radius
      sim.targetEntity(mob.id);
      p.resource = p.maxResource;
      rec.tick(1);
      p.gcdRemaining = 0;
      sim.castAbility('consecration'); // pushes the ground AoE; immediate pulse fires
      rec.tick(20 * 10); // 10s: interval-2 deferred pulses
    },
  };
}

// Arena 1v1: queue two solos, run the countdown to active, then force a kill so
// the Elo result lands on both players' PlayerMeta (arenaRating/Wins/Losses).
function arena1v1(): Scenario {
  return {
    name: 'arena_1v1',
    coverage: [
      'arena 1v1 match + Elo result',
      'multi-player PlayerMeta sampling',
      'classes:warrior,mage',
    ],
    sampleEvery: 25,
    build: () => new Sim({ seed: 1008, playerClass: 'warrior', noPlayer: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      const a = sim.addPlayer('warrior', 'Aleph');
      const b = sim.addPlayer('mage', 'Bet');
      teleport(sim, sim.entities.get(a)!, 0, -40);
      teleport(sim, sim.entities.get(b)!, 6, -40);
      sim.arenaQueueJoin(a);
      sim.arenaQueueJoin(b);
      rec.tick(1); // matchmake
      for (let i = 0; i < 20 * 8; i++) {
        rec.tick(1);
        const m = sim.arenaMatchFor(a);
        if (m && m.state === 'active') break;
      }
      const ea = sim.entities.get(a) as AnyEntity;
      const eb = sim.entities.get(b) as AnyEntity;
      sim.dealDamage(ea, eb, 99999, false, 'physical', null, 'hit');
      rec.tick(1); // arenaEnd + rating update
      rec.tick(20 * 2);
    },
  };
}

// Fiesta: queue four solos into the score-based 2v2 party mode, run to active,
// then force a cross-team kill (scores a point + benches the victim on a respawn
// timer). Exercises fiesta match logic; the fiesta sub-stream's effects surface
// through PlayerMeta + match state.
function fiesta(): Scenario {
  return {
    name: 'fiesta',
    coverage: [
      'fiesta match (2v2 score mode)',
      'cross-team takedown + respawn bench',
      'augment wave: fiestaPickOffers + arenaAugmentPick (fiestaAugments on meta + augmentOffer/Chosen events)',
      'multi-player meta',
    ],
    sampleEvery: 25,
    build: () => new Sim({ seed: 1009, playerClass: 'warrior', noPlayer: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      const classes: Array<'warrior' | 'mage' | 'rogue' | 'hunter'> = [
        'warrior',
        'mage',
        'rogue',
        'hunter',
      ];
      const pids = classes.map((c, i) => sim.addPlayer(c, `P${i}`));
      pids.forEach((pid, i) => {
        teleport(sim, sim.entities.get(pid)!, i * 4, -40);
      });
      pids.forEach((pid) => {
        sim.arenaQueueJoin(pid, 'fiesta');
      });
      rec.tick(1);
      for (let i = 0; i < 20 * 10; i++) {
        rec.tick(1);
        const m = sim.arenaMatchFor(pids[0]);
        if (m && m.state === 'active') break;
      }
      const match = sim.arenaMatchFor(pids[0]);
      if (match && match.fiesta && match.teamA.length && match.teamB.length) {
        const victimPid = match.teamB[0];
        const killer = sim.entities.get(match.teamA[0]) as AnyEntity;
        const victim = sim.entities.get(victimPid) as AnyEntity;
        // 6-arg form (kind defaulted) matches how the fiesta test drives a takedown.
        (sim as any).dealDamage(killer, victim, victim.maxHp + 50, false, 'physical', null);
        rec.tick(1); // fiestaDown + score; victim is now benched (down)
        // Open an augment wave: the downed victim is offered augments (drawing the
        // fiesta sub-stream via fiestaPickOffers), then picks one -> fiestaAugments.
        (sim as any).fiestaOpenWave(match);
        const offer = match.fiesta.offers.get(victimPid);
        if (offer && offer.choices.length) sim.arenaAugmentPick(offer.choices[0], victimPid);
        rec.notes.fiestaVictimPid = victimPid;
        rec.tick(1);
      }
      rec.tick(20 * 3);
    },
  };
}

// Fiesta power-ups, hazard ring, and respawn revive (A3). Seats a 2v2 Fiesta, runs
// until the first power-up spawns (fiestaSpawnPowerup draws the PER-MATCH f.rng: one
// pick + two next() for placement), telegraphs it to ready, walks a live fighter
// onto it (fiestaGrabPowerup applies a buff aura), then closes the ring and pushes a
// fighter outside (fiestaRingDamage burn), and finally downs a fighter and runs
// their respawn timer out (fiestaRevive). The per-match f.rng power-up placement
// surfaces in the full-state trace (powerup defId/x/z); the SHARED this.rng
// draw-order digest is untouched (fiesta match logic draws only the per-match
// stream). Complements `fiesta` (takedown + augment wave) with the power-up / ring /
// revive arms it does not reach.
function fiestaPowerups(): Scenario {
  return {
    name: 'fiesta_powerups',
    coverage: [
      'fiesta power-up spawn (f.rng pick/next) + telegraph + grab (buff aura)',
      'hazard ring burn (fiestaRingDamage) outside the closing ring',
      'down + respawn-timer revive (fiestaRevive)',
    ],
    sampleEvery: 10,
    build: () => new Sim({ seed: 2027, playerClass: 'warrior', noPlayer: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      const classes: Array<'warrior' | 'mage' | 'rogue' | 'priest'> = [
        'warrior',
        'mage',
        'rogue',
        'priest',
      ];
      const pids = classes.map((c, i) => sim.addPlayer(c, `P${i}`));
      pids.forEach((pid, i) => {
        teleport(sim, sim.entities.get(pid)!, i * 4, -40);
      });
      pids.forEach((pid) => {
        sim.arenaQueueJoin(pid, 'fiesta');
      });
      rec.tick(1);
      for (let i = 0; i < 20 * 10; i++) {
        rec.tick(1);
        const m = sim.arenaMatchFor(pids[0]);
        if (m && m.state === 'active') break;
      }
      const match = sim.arenaMatchFor(pids[0]);
      if (match && match.fiesta) {
        const f = match.fiesta;
        // First power-up attempt is ~12s into the bout; run until one spawns.
        for (let i = 0; i < 20 * 20 && f.powerups.length === 0; i++) rec.tick(1);
        // Telegraph -> ready.
        for (let i = 0; i < 20 * 6 && f.powerups[0]?.state === 'spawning'; i++) rec.tick(1);
        // Walk a live fighter onto the ready power-up so it is grabbed (buff aura).
        const p = f.powerups[0];
        if (p && p.state === 'ready') {
          const grabPid = match.teamA[0];
          teleport(sim, sim.entities.get(grabPid)! as AnyEntity, p.x, p.z);
          rec.tick(1);
        }
        // Hazard ring: close it tight and push a fighter well outside -> burn.
        f.ringRadius = 6;
        const origin = arenaOrigin(match.slot);
        const ringPid = match.teamA[0];
        teleport(sim, sim.entities.get(ringPid)! as AnyEntity, origin.x + 30, origin.z);
        rec.tick(20); // ~1s; the ring burns twice a second
        // Down a cross-team fighter, then run their respawn timer out -> revive.
        const victimPid = match.teamB[0];
        const killer = sim.entities.get(match.teamA[0]) as AnyEntity;
        const victim = sim.entities.get(victimPid) as AnyEntity;
        (sim as any).dealDamage(killer, victim, victim.maxHp + 50, false, 'physical', null);
        rec.notes.fiestaPowerupVictimPid = victimPid;
        const downedFor = f.respawn.get(victimPid) ?? 5;
        rec.tick(Math.ceil(downedFor * 20) + 10);
      }
      rec.tick(20 * 2);
    },
  };
}

// Duel to a winner (A2): two adjacent players, duelRequest -> duelAccept, run the
// DUEL_COUNTDOWN out so the bout is live, then one lands a finishing blow. The
// dealDamage 1-HP duel guard ends the bout via endDuel (a winner/loser duelEnd,
// the loser clamped to 1 hp, this.duels cleared). This slice draws no rng of its
// own, so the draw-order digest must stay byte-identical across the move.
function duelToWinner(): Scenario {
  return {
    name: 'duel_to_winner',
    coverage: [
      'duelRequest/duelAccept duel formation (~11982/12022)',
      'updateDuels countdown -> active + duelStart',
      'endDuel on a PvP finishing blow (winner/loser + this.duels cleared)',
    ],
    build: () => new Sim({ seed: 1015, playerClass: 'warrior', noPlayer: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      const a = sim.addPlayer('warrior', 'Aleph', { autoEquip: true });
      const b = sim.addPlayer('mage', 'Bet', { autoEquip: true });
      teleport(sim, sim.entities.get(a)!, 0, -40);
      teleport(sim, sim.entities.get(b)!, 4, -40);
      rec.track(a, b);
      sim.duelRequest(b, a); // Aleph challenges Bet
      sim.duelAccept(b); // Bet accepts -> countdown
      // run the 3s countdown (TICK_RATE 20) out so the duel flips to 'active'.
      for (let i = 0; i < 20 * 4; i++) {
        rec.tick(1);
        const d = sim.duels.get(a);
        if (d && d.state === 'active') break;
      }
      rec.snapshot('duel-active');
      // Aleph lands a finishing blow; the 1-HP duel guard ends the bout with
      // Aleph as the winner (Bet survives at 1 hp, the duel is cleared).
      const ea = sim.entities.get(a) as AnyEntity;
      const eb = sim.entities.get(b) as AnyEntity;
      sim.dealDamage(ea, eb, eb.hp + 1000, false, 'physical', 'Finisher', 'hit');
      rec.snapshot('duel-ended');
      rec.tick(20 * 2);
    },
  };
}

// Arena 2v2 to a team wipe (A2): queue four solos into one 2v2 match, run the
// countdown to active, then drop BOTH of teamB. The first death does NOT end the
// match; the second wipes the team (isArenaTeamWiped) so endArenaMatch scores a
// ranked, symmetric Elo delta on all four metas (arena2v2 standings, floored at
// ARENA_MIN_RATING), then returnFromArena sends survivors home after the aftermath.
function arena2v2Wipe(): Scenario {
  return {
    name: 'arena_2v2_wipe',
    coverage: [
      'arena 2v2 matchmaking (matchmakeTeamFormat: four solos -> two teams)',
      'first kill does not end the match; team wipe (isArenaTeamWiped) does',
      'endArenaMatch ranked Elo on both teams (arena2v2 standings) + returnFromArena',
    ],
    sampleEvery: 25,
    build: () => new Sim({ seed: 1016, playerClass: 'warrior', noPlayer: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      const classes: Array<'warrior' | 'mage' | 'rogue' | 'priest'> = [
        'warrior',
        'mage',
        'rogue',
        'priest',
      ];
      const names = ['Aleph', 'Bet', 'Gimel', 'Dalet'];
      const pids = classes.map((c, i) => sim.addPlayer(c, names[i]));
      pids.forEach((pid, i) => {
        teleport(sim, sim.entities.get(pid)!, i * 3, -40);
      });
      rec.track(...pids);
      pids.forEach((pid) => {
        sim.arenaQueueJoin(pid, '2v2');
      });
      rec.tick(1); // matchmake seats the four solos into one 2v2 match
      for (let i = 0; i < 20 * 8; i++) {
        rec.tick(1);
        const m = sim.arenaMatchFor(pids[0]);
        if (m && m.state === 'active') break;
      }
      const match = sim.arenaMatchFor(pids[0]);
      if (match && match.teamA.length === 2 && match.teamB.length === 2) {
        rec.snapshot('bout-active');
        const killer = sim.entities.get(match.teamA[0]) as AnyEntity;
        // First takedown: teamB[0] dies but the team is not wiped -> match active.
        sim.dealDamage(
          killer,
          sim.entities.get(match.teamB[0]) as AnyEntity,
          99999,
          false,
          'physical',
          null,
          'hit',
        );
        rec.tick(1);
        rec.snapshot('first-down');
        // Second takedown: teamB is wiped -> endArenaMatch (ranked Elo on all four).
        sim.dealDamage(
          killer,
          sim.entities.get(match.teamB[1]) as AnyEntity,
          99999,
          false,
          'physical',
          null,
          'hit',
        );
        rec.tick(1);
        rec.snapshot('team-wiped');
      }
      // run the aftermath out so returnFromArena frees the slot + sends them home.
      for (let i = 0; i < 20 * 7; i++) rec.tick(1);
      rec.snapshot('returned');
    },
  };
}

// Delve + lockpick: enter the Collapsed Reliquary finale, pin the module so it is
// deterministic, kill the boss, then pick the reward chest flawlessly. Exercises
// the delve run progression, the lockpick minigame, and the reward-chest loot.
function delveLockpick(): Scenario {
  return {
    name: 'delve_lockpick',
    coverage: [
      'delve run (collapsed_reliquary finale)',
      'mobSwing delve-companion caller (~16762)',
      'lockpick minigame (flawless solve)',
      'reward chest + delve marks',
    ],
    sampleEvery: 10,
    build: () => new Sim({ seed: 1010, playerClass: 'rogue', autoEquip: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      const def = DELVES.collapsed_reliquary;
      sim.setPlayerLevel(def.minLevel);
      const p = sim.player as AnyEntity;
      beef(p);
      teleport(sim, p, def.doorPos.x, def.doorPos.z);
      sim.enterDelve('collapsed_reliquary', 'normal');
      const run = sim.delveRunForPlayer(sim.playerId);
      if (!run) {
        rec.tick(2);
        return;
      }
      run.bountiful = false; // pin against the rare coffer roll
      run.modules = ['reliquary_finale'];
      run.moduleIndex = 0;
      (sim as any).spawnDelveModule(run);
      const boss = [...sim.entities.values()].find(
        (e: AnyEntity) => e.templateId === 'deacon_varric',
      ) as AnyEntity | undefined;
      // Let the auto-spawned delve companion swing the boss -> mobSwing companion
      // caller (~16762) before we kill it. The companion prefers the owner's target.
      const comp = run.companion
        ? (sim.entities.get(run.companion.entityId) as AnyEntity | undefined)
        : undefined;
      if (boss && comp) {
        boss.hostile = true;
        comp.pos = { x: boss.pos.x + 1, y: boss.pos.y, z: boss.pos.z };
        comp.prevPos = { ...comp.pos };
        comp.swingTimer = 0;
        sim.rebucket(comp);
        sim.targetEntity(boss.id);
        rec.track(comp.id, boss.id);
        rec.notes.companionId = comp.id;
        rec.tick(30); // companion swings the boss
      }
      if (boss) {
        rec.track(boss.id);
        lethal(sim, p, boss);
      }
      rec.tick(4); // reward chest spawns
      const chestId = run.rewardChestId;
      if (chestId != null) {
        rec.track(chestId);
        const chest = sim.entities.get(chestId) as AnyEntity;
        p.pos = { ...chest.pos };
        p.prevPos = { ...chest.pos };
        sim.rebucket(p);
        sim.lockpickEngage(chestId, 1);
        rec.tick(1);
        let guard = 0;
        while (run.lockpick && run.lockpick.state === 'IN_PROGRESS' && guard++ < 50) {
          const actions = solveLockActions(run.lockpick.pages[run.lockpick.pageIndex]);
          if (!actions || actions.length === 0) break;
          for (const action of actions) sim.lockpickAction(action);
          rec.tick(1);
        }
      }
      rec.snapshot('delve-end');
      rec.tick(2);
    },
  };
}

// Delve + lockpick FAIL/jam: enter the same Collapsed Reliquary finale, engage the
// reward chest, then idle past the server-authoritative per-step clock so the single
// premium try burns -> the chest jams (attemptAvailable=false) and the surface exit
// opens (the party is never stranded). Pins the timeout/burn-try/fail path the
// success-only delve_lockpick golden does not exercise.
function delveLockpickFail(): Scenario {
  return {
    name: 'delve_lockpick_fail',
    coverage: [
      'delve run (collapsed_reliquary finale)',
      'lockpick minigame (server-authoritative timeout jam)',
      'tickLockpickTimeout -> lockpickStepTimeout -> lockpickBurnTry -> lockpickFail',
      'jammed chest (attemptAvailable=false) + surface exit opens',
    ],
    sampleEvery: 10,
    build: () => new Sim({ seed: 2024, playerClass: 'rogue', autoEquip: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      const def = DELVES.collapsed_reliquary;
      sim.setPlayerLevel(def.minLevel);
      const p = sim.player as AnyEntity;
      beef(p);
      teleport(sim, p, def.doorPos.x, def.doorPos.z);
      sim.enterDelve('collapsed_reliquary', 'normal');
      const run = sim.delveRunForPlayer(sim.playerId);
      if (!run) {
        rec.tick(2);
        return;
      }
      run.bountiful = false; // pin against the rare coffer roll
      run.modules = ['reliquary_finale'];
      run.moduleIndex = 0;
      (sim as any).spawnDelveModule(run);
      const boss = [...sim.entities.values()].find(
        (e: AnyEntity) => e.templateId === 'deacon_varric',
      ) as AnyEntity | undefined;
      if (boss)
        (sim as any).dealDamage(p, boss, boss.maxHp + 1, false, 'physical', null, 'hit', true);
      rec.tick(4); // reward chest spawns
      // Drop the finale swarm so the ONLY thing that can end the attempt during the
      // pause is the per-step clock under test (incidental combat is covered elsewhere).
      for (const [id, e] of [...sim.entities]) {
        if ((e as AnyEntity).kind === 'mob') sim.entities.delete(id);
      }
      const chestId = run.rewardChestId;
      if (chestId != null) {
        rec.track(chestId);
        rec.notes.chestId = chestId;
        const chest = sim.entities.get(chestId) as AnyEntity;
        p.pos = { ...chest.pos };
        p.prevPos = { ...chest.pos };
        sim.rebucket(p);
        sim.lockpickEngage(chestId, 1); // premium ante: a single try
        rec.tick(1);
        // Idle past the single-try step deadline (3000ms / 50ms = 60 ticks) so the sim
        // clock burns the try -> lockpickFail jams the chest and opens the surface exit.
        rec.tick(64);
      }
      rec.snapshot('lockpick-jammed');
      rec.tick(2);
    },
  };
}

// The Drowned Litany (second delve): heroic entry rolls a ruin affix, the choir
// loft exercises the bell-rope F-pull (Bell Shock on live cantors mid-combat)
// and the every-puzzle exit gate, then the apse runs the Sister Nhalia driver
// through its shared-stream rng draws (Blackwater Mark target pick, Tolling
// Bells volley offset + interval) plus both cantor phases and the Final Bell,
// ending on the Drowned Reliquary Rite choose -> first playback pulses.
function drownedLitany(): Scenario {
  return {
    name: 'drowned_litany',
    coverage: [
      'drowned_litany heroic run (ruin affix roll + module advance)',
      'bell-rope pull -> Bell Shock on live cantors (delveInteract)',
      'Sister Nhalia driver: Blackwater Mark + Tolling Bells volley rng draws',
      'cantor phases + Final Bell + rite choose -> playback pulses',
    ],
    sampleEvery: 10,
    build: () => new Sim({ seed: 3131, playerClass: 'warrior', autoEquip: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      const def = DELVES.drowned_litany;
      const heroic = def.tiers.find((t: any) => t.id === 'heroic');
      sim.setPlayerLevel(heroic?.minPlayerLevel ?? def.minLevel);
      const p = sim.player as AnyEntity;
      beef(p);
      teleport(sim, p, def.doorPos.x, def.doorPos.z);
      sim.enterDelve('drowned_litany', 'heroic');
      const run = sim.delveRunForPlayer(sim.playerId);
      if (!run) {
        rec.tick(2);
        return;
      }
      run.bountiful = false; // pin against the rare coffer roll
      rec.notes.affixes = [...run.affixes];
      run.modules = ['litany_choir_loft', 'litany_apse'];
      run.moduleIndex = 0;
      (sim as any).spawnDelveModule(run);
      // Open combat on a cantor so onBellRopePulled has a live, in-combat target.
      const cantor = run.mobIds
        .map((id: number) => sim.entities.get(id) as AnyEntity | undefined)
        .find((m: AnyEntity | undefined) => m && !m.dead && m.templateId === 'drowned_cantor');
      if (cantor) {
        rec.track(cantor.id);
        aggroOnto(cantor, p);
        sim.dealDamage(p, cantor, 1, false, 'physical', null, 'hit', true);
        rec.tick(2);
      }
      // Pull both ropes mid-combat: the deliberate F-pull path (delveInteract),
      // Bell Shock lands on the cantor, and the rope template swaps to _pulled.
      for (const oid of [...run.objectIds]) {
        if (run.objectState[oid]?.kind !== 'bell_rope') continue;
        const rope = sim.entities.get(oid) as AnyEntity | undefined;
        if (!rope) continue;
        // In-delve placement copies the object's pos: the teleport helper's
        // terrainHeight y is the open-world surface, a lethal fall in here.
        p.pos = { ...rope.pos };
        p.prevPos = { ...p.pos };
        sim.rebucket(p);
        sim.delveInteract(oid);
        rec.tick(1);
      }
      // Clear the room; with every rope pulled the exit opens and walking into
      // the tombstone advances onto the apse finale.
      for (const id of [...run.mobIds]) {
        const m = sim.entities.get(id) as AnyEntity | undefined;
        if (m) m.dead = true;
      }
      rec.tick(2);
      const portal = [...sim.entities.values()].find(
        (e: AnyEntity) => run.objectState[e.id]?.kind === 'module_exit',
      ) as AnyEntity | undefined;
      if (portal) {
        p.pos = { ...portal.pos };
        p.prevPos = { ...p.pos };
        sim.rebucket(p);
        rec.tick(3);
      }
      rec.snapshot('advanced-to-apse');
      const boss = run.mobIds
        .map((id: number) => sim.entities.get(id) as AnyEntity | undefined)
        .find((m: AnyEntity | undefined) => m && m.templateId === SISTER_NHALIA_BOSS_ID);
      if (boss) {
        rec.track(boss.id);
        p.pos = { x: boss.pos.x + 1.5, y: boss.pos.y, z: boss.pos.z };
        p.prevPos = { ...p.pos };
        sim.rebucket(p);
        face(p, boss);
        // Real engagement: the boss runs PROFILED mob combat, whose state machine
        // manages its own aggro, so a synthetic aggroOnto does not stick. Auto-
        // attacking keeps the pull live the whole window (threat + inCombat).
        sim.targetEntity(boss.id);
        addThreat(boss, p.id, 5000);
        aggroOnto(boss, p);
        sim.startAutoAttack();
        // Past the 70% gate -> cantor phase 1 (shield adds), then ride out the
        // 14s mark timer + ~12s first volley window on the driver's rng draws.
        sim.dealDamage(
          p,
          boss,
          Math.ceil(boss.hp - boss.maxHp * 0.65),
          false,
          'physical',
          null,
          'hit',
          true,
        );
        for (let round = 0; round < 15; round++) {
          rec.tick(20);
          if (!boss.dead) face(p, boss);
        }
        rec.notes.marksSeen = (run.nhaliaBoss?.marks?.length ?? 0) as number;
        rec.notes.bellsLive = run.mobIds.filter((id: number) => {
          const m = sim.entities.get(id) as AnyEntity | undefined;
          return m && !m.dead && m.templateId === 'tolling_bell';
        }).length;
        // Drop the shield adds, cross the 35% gate (phase 2), then the Final
        // Bell at 10%, and finish the boss.
        for (const id of [...run.mobIds]) {
          const m = sim.entities.get(id) as AnyEntity | undefined;
          if (m && !m.dead && m.templateId === 'drowned_cantor') lethal(sim, p, m);
        }
        rec.tick(20);
        sim.dealDamage(
          p,
          boss,
          Math.ceil(boss.hp - boss.maxHp * 0.3),
          false,
          'physical',
          null,
          'hit',
          true,
        );
        rec.tick(40);
        sim.dealDamage(
          p,
          boss,
          Math.ceil(boss.hp - boss.maxHp * 0.08),
          false,
          'physical',
          null,
          'hit',
          true,
        );
        rec.tick(40);
        lethal(sim, p, boss);
      }
      rec.tick(6); // reliquary + shrines rise, rite awaits the intensity choice
      const reliquary = [...run.objectIds]
        .map((id: number) => sim.entities.get(id) as AnyEntity | undefined)
        .find(
          (o: AnyEntity | undefined) => o && run.objectState[o.id]?.kind === 'drowned_reliquary',
        );
      if (reliquary) {
        p.pos = { x: reliquary.pos.x + 1, y: reliquary.pos.y, z: reliquary.pos.z };
        p.prevPos = { ...p.pos };
        sim.rebucket(p);
        sim.delveInteract(reliquary.id); // -> delveRiteChoosePrompt (the popup cue)
      }
      sim.delveRiteChoose('easy');
      rec.tick(90); // first playback pulses stream out
      rec.snapshot('rite-started');
      rec.tick(2);
    },
  };
}

// Party loot: a need/greed roll over a party-tagged corpse carrying a premium
// item. Exercises lootCorpse -> lootRoll -> submitLootRoll resolution.
function partyLoot(): Scenario {
  return {
    name: 'party_loot',
    coverage: ['party need/greed loot roll (lootCorpse/submitLootRoll)', 'multi-player party'],
    build: () => new Sim({ seed: 1011, playerClass: 'warrior', noPlayer: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      const a = sim.addPlayer('warrior', 'Aaa');
      const b = sim.addPlayer('mage', 'Bbb');
      sim.partyInvite(b, a);
      sim.partyAccept(b);
      teleport(sim, sim.entities.get(a)!, 20, 20);
      teleport(sim, sim.entities.get(b)!, 21, 20);
      const mob = createMob(sim.nextId++, MOBS.forest_wolf, 2, {
        x: 20,
        y: terrainHeight(20, 22, sim.cfg.seed),
        z: 22,
      }) as AnyEntity;
      mob.dead = true;
      mob.lootable = true;
      mob.tappedById = a;
      mob.loot = { copper: 0, items: [{ itemId: 'greyjaw_hide_boots', count: 1 }] };
      sim.addEntity(mob);
      rec.track(mob.id);
      sim.lootCorpse(mob.id, a);
      rec.tick(1);
      const rollEv = rec.allEvents.find((e: any) => e.type === 'lootRoll') as any;
      if (rollEv) {
        sim.submitLootRoll(rollEv.rollId, 'need', a);
        sim.submitLootRoll(rollEv.rollId, 'need', b);
      }
      rec.tick(2);
    },
  };
}

// L1 loot distribution: a 3-member party loots a tagged corpse carrying copper
// plus item slots, exercising every distribution path the loot slice owns:
//  - fair-split currency with a NON-ZERO remainder (100 over 3) so the
//    tryAwardCopperByFairSplit Fisher-Yates draw (rng.int(i, len-1)) FIRES -- the
//    one shared-stream draw no other scenario hits;
//  - two need-greed rolls on the premium item: one resolved need(a)/greed(b)/pass(c)
//    in party-member order (need beats greed -> a wins, two rng.int(1,100) draws),
//    one where everyone passes (returnLootRollItemToCorpse, no draw);
//  - a common item via looter-takes-all (awardSharedLootItem direct add, no roll);
//  - a personal slot only b may see (lootSlotVisibleTo skips a, then b claims it).
// Candidates come from the death-time lootRecipientIds snapshot so the candidate
// set + order are deterministic without depending on range.
function l1LootDistribution(): Scenario {
  return {
    name: 'l1_loot_distribution',
    coverage: [
      'fair-split copper with remainder (Fisher-Yates rng.int draw)',
      'need/greed/pass roll in party-member order (need beats greed)',
      'everyone-passes returnLootRollItemToCorpse',
      'looter-takes-all common item + personal-loot visibility',
    ],
    build: () => new Sim({ seed: 1021, playerClass: 'warrior', noPlayer: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      const a = sim.addPlayer('warrior', 'Aaa');
      const b = sim.addPlayer('mage', 'Bbb');
      const c = sim.addPlayer('rogue', 'Ccc');
      sim.partyInvite(b, a);
      sim.partyAccept(b);
      sim.partyInvite(c, a);
      sim.partyAccept(c);
      teleport(sim, sim.entities.get(a)!, 20, 20);
      teleport(sim, sim.entities.get(b)!, 21, 20);
      teleport(sim, sim.entities.get(c)!, 22, 20);
      const mob = createMob(sim.nextId++, MOBS.forest_wolf, 2, {
        x: 20,
        y: terrainHeight(20, 22, sim.cfg.seed),
        z: 22,
      }) as AnyEntity;
      mob.dead = true;
      mob.lootable = true;
      mob.tappedById = a;
      mob.lootRecipientIds = [a, b, c];
      mob.loot = {
        copper: 100,
        items: [
          { itemId: 'greyjaw_hide_boots', count: 2 }, // uncommon -> two need-greed rolls
          { itemId: 'worn_sword', count: 1 }, // common -> looter-takes-all direct add
          { itemId: 'gnarled_staff', count: 1, personalFor: [b] }, // personal -> only b sees it
        ],
      };
      sim.addEntity(mob);
      rec.track(mob.id);
      // a loots: fair-split copper (remainder 1 -> Fisher-Yates draw), starts two
      // need-greed rolls for the premium item, takes the common item directly, and
      // is denied the personal slot.
      sim.lootCorpse(mob.id, a);
      rec.snapshot('after-loot-a');
      rec.tick(1);
      const rollIds = [
        ...new Set(
          (rec.allEvents as { type: string; rollId?: number }[])
            .filter((e) => e.type === 'lootRoll')
            .map((e) => e.rollId as number),
        ),
      ];
      rec.notes.rollIds = rollIds;
      // Roll 1: need(a) beats greed(b); c passes -> a wins (two int(1,100) draws).
      if (rollIds[0] !== undefined) {
        sim.submitLootRoll(rollIds[0], 'need', a);
        sim.submitLootRoll(rollIds[0], 'greed', b);
        sim.submitLootRoll(rollIds[0], 'pass', c);
      }
      // Roll 2: everyone passes -> item returns to the corpse as openToAll (no draw).
      if (rollIds[1] !== undefined) {
        sim.submitLootRoll(rollIds[1], 'pass', a);
        sim.submitLootRoll(rollIds[1], 'pass', b);
        sim.submitLootRoll(rollIds[1], 'pass', c);
      }
      rec.snapshot('after-rolls');
      // b claims the personal slot and the returned-to-corpse openToAll item.
      sim.lootCorpse(mob.id, b);
      rec.snapshot('after-loot-b');
      rec.tick(2);
    },
  };
}

// Entity roster (E1): the spawn/despawn/decay plumbing, the delayed-event drain,
// and the outdoor player release-spirit path. Spawns mobs via addEntity, expires
// them through BOTH despawn branches (despawnTimer + the idle-despawn timer on a
// DAMAGE_IDLE_DESPAWN mob) so the prologue collect-then-drop loop fires; schedules
// three delayed events (due+fires, due+guard-fails-and-drops, future+stays-pending)
// so emitDueDelayedEvents exercises every branch; then kills the player, releases the
// spirit (rises as a ghost at the nearest graveyard), and resurrects at the Spirit
// Healer (in place, with Resurrection Sickness at level 10).
function entityRoster(): Scenario {
  return {
    name: 'entity_roster',
    coverage: [
      'addEntity roster + spatial grids',
      'despawn prologue: despawnTimer + DAMAGE_IDLE_DESPAWN idle-despawn (collect-then-drop)',
      'emitDueDelayedEvents drain (fires / guard-drops / stays-pending)',
      'releaseSpirit ghost release + Spirit Healer resurrect (Resurrection Sickness)',
    ],
    sampleEvery: 2,
    build: () => new Sim({ seed: 1012, playerClass: 'warrior', autoEquip: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      sim.setPlayerLevel(10);
      const p = sim.player as AnyEntity;
      beef(p);
      // (1a) despawnTimer churn: a far, quiescent mob set to expire in ~2 ticks.
      const ghost = spawnMob(sim, 'forest_wolf', 2, p.pos.x + 200, p.pos.y, p.pos.z + 200);
      ghost.hostile = false;
      ghost.despawnTimer = 0.1;
      rec.track(ghost.id);
      // (1b) idle-despawn churn: a DAMAGE_IDLE_DESPAWN mob, idle + out of combat,
      // with its idle timer pre-seeded so the second despawn branch fires.
      const guard = spawnMob(sim, 'varkas_boneguard', 30, p.pos.x - 200, p.pos.y, p.pos.z - 200);
      guard.hostile = false;
      guard.inCombat = false;
      guard.damageIdleDespawnTimer = 0.1;
      rec.track(guard.id);
      rec.notes.ghostId = ghost.id;
      rec.notes.guardId = guard.id;
      // (2) delayed-event drain: one due+fires, one due+guard-false (dropped), one
      // future (stays pending). delayedEvents is the field this slice owns.
      const delayed = (sim as any).delayedEvents as {
        at: number;
        event: any;
        guard?: () => boolean;
      }[];
      delayed.push({ at: sim.time + 0.05, event: { type: 'respawn', pid: p.id } });
      delayed.push({
        at: sim.time + 0.05,
        event: { type: 'respawn', pid: p.id },
        guard: () => false,
      });
      delayed.push({ at: sim.time + 100, event: { type: 'respawn', pid: p.id } });
      rec.tick(5); // both mobs despawn (0.1s) and the due delayed events resolve
      rec.snapshot('post-churn');
      // (4) outdoor release-spirit -> rise as a ghost at the nearest graveyard, then
      // resurrect at the Spirit Healer (in place, with Resurrection Sickness at lvl 10).
      p.hp = 1;
      p.dead = true;
      sim.releaseSpirit();
      rec.snapshot('ghost-release');
      sim.resurrectAtSpiritHealer();
      rec.snapshot('healer-resurrect');
      rec.tick(2);
    },
  };
}

// Delve player death (E1, merged E2): the in-delve release-spirit path. First death
// respawns at the module entry at 50% hp; a second death in the same run fails the
// run (no respawn) and ejects to the board door.
function delveDeath(): Scenario {
  return {
    name: 'delve_death',
    coverage: [
      'releaseSpiritInDelve first death (50% hp respawn at module entry, ~16345)',
      'releaseSpiritInDelve second death fails the run (deathsThisRun >= 2)',
      'rebucket after delve respawn teleport',
    ],
    sampleEvery: 5,
    build: () => new Sim({ seed: 1013, playerClass: 'rogue', autoEquip: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      const def = DELVES.collapsed_reliquary;
      sim.setPlayerLevel(def.minLevel);
      const p = sim.player as AnyEntity;
      beef(p);
      teleport(sim, p, def.doorPos.x, def.doorPos.z);
      sim.enterDelve('collapsed_reliquary', 'normal');
      const run = sim.delveRunForPlayer(sim.playerId);
      if (!run) {
        rec.tick(2);
        return;
      }
      run.bountiful = false; // pin against the rare coffer roll
      run.modules = ['reliquary_finale'];
      run.moduleIndex = 0;
      (sim as any).spawnDelveModule(run);
      // First death: 50% hp respawn at the module entry.
      p.dead = true;
      sim.releaseSpirit();
      rec.snapshot('delve-first-release');
      // Second death in the same run: fails the run (delveFailed, ejected).
      const e2 = sim.entities.get(sim.playerId) as AnyEntity;
      e2.dead = true;
      sim.releaseSpirit();
      rec.tick(2); // failDelveRun's delveFailed is queued, drained on the next tick
      rec.snapshot('delve-fail');
    },
  };
}

// C1 damage core: kill a player who is mid-cast inside a fiesta. Pins the
// dealDamage cross-team lethal arm's emit-THEN-fiestaTakedown order, plus the
// mid-cast interaction both ways: a non-lethal hit on a normal cast pushes the cast
// back (pushbackCast ~5664) and a non-lethal hit on the fishing cast cancels it
// (cancelCast ~5663). Mirrors the fiesta matchmaking flow so the match reaches
// active before the takedown.
function fiestaMidcastKill(): Scenario {
  return {
    name: 'fiesta_midcast_kill',
    coverage: [
      'dealDamage fiesta mid-cast pushback (pushbackCast ~5664)',
      'dealDamage fiesta mid-cast fishing-cancel (cancelCast ~5663)',
      'dealDamage fiesta cross-team takedown emit-then-fiestaTakedown order (~5512-5525)',
      'fiesta lifesteal augment arm (~5499)',
      'multi-player fiesta meta',
    ],
    sampleEvery: 25,
    build: () => new Sim({ seed: 1014, playerClass: 'warrior', noPlayer: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      const classes: Array<'warrior' | 'mage' | 'rogue' | 'hunter'> = [
        'warrior',
        'mage',
        'rogue',
        'hunter',
      ];
      const pids = classes.map((c, i) => sim.addPlayer(c, `F${i}`));
      pids.forEach((pid, i) => {
        teleport(sim, sim.entities.get(pid)!, i * 4, -40);
      });
      pids.forEach((pid) => {
        sim.arenaQueueJoin(pid, 'fiesta');
      });
      rec.tick(1);
      for (let i = 0; i < 20 * 10; i++) {
        rec.tick(1);
        const m = sim.arenaMatchFor(pids[0]);
        if (m && m.state === 'active') break;
      }
      const match = sim.arenaMatchFor(pids[0]);
      if (match && match.fiesta && match.teamA.length && match.teamB.length) {
        const killer = sim.entities.get(match.teamA[0]) as AnyEntity;
        const victim = sim.entities.get(match.teamB[0]) as AnyEntity;
        beef(victim, 5000); // survive the two non-lethal cast-interrupt hits
        // (a) mid-cast pushback: a normal (non-fishing) cast, hit non-lethally.
        victim.castingAbility = 'fireball';
        victim.castRemaining = 2;
        victim.castTotal = 2;
        victim.channeling = false;
        sim.dealDamage(killer, victim, 50, false, 'physical', null, 'hit');
        rec.snapshot('midcast-pushback');
        // (b) mid-cast fishing cancel: the fishing cast is cancelled, not pushed.
        victim.castingAbility = FISHING_CAST_ID;
        victim.castRemaining = 5;
        victim.channeling = false;
        sim.dealDamage(killer, victim, 50, false, 'physical', null, 'hit');
        rec.snapshot('midcast-fishcancel');
        // (c) lethal cross-team hit: hp=0 -> emit damage -> fiestaTakedown -> return.
        victim.castingAbility = 'fireball';
        victim.castRemaining = 2;
        victim.castTotal = 2;
        victim.channeling = false;
        sim.dealDamage(killer, victim, victim.maxHp + 50, false, 'physical', null, 'hit');
        rec.notes.fiestaVictimPid = victim.id;
        rec.notes.fiestaKillerPid = killer.id;
        rec.snapshot('takedown');
        rec.tick(1);
      }
      rec.tick(20 * 2);
    },
  };
}

// Quest kill-credit (Q1): accept a kill quest at its giver NPC (driving
// finalizeQuestAccept's onInventoryChangedForQuests), then slay the target mob one
// at a time so handleDeath's party-credit loop fires onMobKilledForQuests (counts++
// + questProgress) until checkQuestReady promotes active -> ready; finally turn the
// quest in at the NPC for its xp + copper. Pins the quest-credit trio's kill path and
// the promotion arm of checkQuestReady.
function questKillCredit(): Scenario {
  return {
    name: 'quest_kill_credit',
    coverage: [
      'onMobKilledForQuests kill credit via handleDeath party loop (~5925)',
      'checkQuestReady promotion (active -> ready)',
      'acceptQuest -> finalizeQuestAccept -> onInventoryChangedForQuests',
      'turnInQuest (xp + copper reward)',
    ],
    build: () => new Sim({ seed: 1014, playerClass: 'warrior', autoEquip: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      sim.setPlayerLevel(10);
      const p = sim.player as AnyEntity;
      beef(p);
      const quest = QUESTS.q_wolves;
      // Accept at the giver NPC (marshal_redbrook): exercises finalizeQuestAccept's
      // onInventoryChangedForQuests foreign call.
      const giver = [...sim.entities.values()].find(
        (e: AnyEntity) => e.kind === 'npc' && e.templateId === quest.giverNpcId,
      ) as AnyEntity | undefined;
      if (giver) teleport(sim, p, giver.pos.x, giver.pos.z);
      sim.acceptQuest('q_wolves', sim.playerId);
      rec.snapshot('quest-accepted');
      // Slay each Forest Wolf one at a time (only one alive, so frenzyPackmates finds
      // no living packmate), crediting the player on every death.
      const need = quest.objectives[0].count; // 8
      for (let i = 0; i < need; i++) {
        const wolf = spawnMob(sim, 'forest_wolf', 2, p.pos.x + 2, p.pos.y, p.pos.z);
        wolf.tappedById = p.id;
        lethal(sim, p, wolf);
        rec.tick(1); // flush the kill's credit events; sample progress
      }
      rec.snapshot('quest-ready');
      // Turn in at the NPC (giver is also the turn-in for q_wolves).
      if (giver) teleport(sim, p, giver.pos.x, giver.pos.z);
      sim.turnInQuest('q_wolves', sim.playerId);
      rec.snapshot('quest-turned-in');
      rec.tick(2);
    },
  };
}

// C1 damage core: multiple classes wound a frenzyOnHit mob so maybeFrenzyOnHit (the
// ONLY rng draw in this slice) fires once per qualifying hit, pinning that draw at
// its global stream position. The frenzy chance is forced to 1 (the draw still
// happens; it just makes the blood_frenzy buff land deterministically so the push +
// refresh branches both run) and restored afterward (MOBS is a process-wide
// singleton). dealDamage is called directly per class source.
function multiClassFrenzy(): Scenario {
  return {
    name: 'multi_class_frenzy',
    coverage: [
      'dealDamage -> maybeFrenzyOnHit rng draw (the only in-slice draw, ~5651/5702)',
      'blood_frenzy push then refresh branches',
      'amp stack + threat handoff + tap rights across multiple attackers',
      'multi-class sources: warrior/mage/rogue',
    ],
    sampleEvery: 5,
    build: () => new Sim({ seed: 1015, playerClass: 'warrior', noPlayer: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      const classes: Array<'warrior' | 'mage' | 'rogue'> = ['warrior', 'mage', 'rogue'];
      const pids = classes.map((c, i) => sim.addPlayer(c, `M${i}`));
      pids.forEach((pid, i) => {
        const e = sim.entities.get(pid) as AnyEntity;
        teleport(sim, e, i * 2, -30);
        beef(e); // keep every attacker alive while the mob swings back
      });
      const lead = sim.entities.get(pids[0]) as AnyEntity;
      const greyjaw = spawnMob(sim, 'old_greyjaw', 6, lead.pos.x + 1, lead.pos.y, lead.pos.z + 2);
      beef(greyjaw, 200000);
      greyjaw.hostile = true;
      rec.track(greyjaw.id);
      rec.notes.greyjawId = greyjaw.id;

      const greyTrait = MOBS.old_greyjaw.frenzyOnHit;
      const greyOrig = greyTrait ? greyTrait.chance : undefined;
      try {
        if (greyTrait) greyTrait.chance = 1;
        for (let round = 0; round < 4; round++) {
          for (const pid of pids) {
            const e = sim.entities.get(pid) as AnyEntity;
            sim.dealDamage(e, greyjaw, 30, false, 'physical', null, 'hit');
          }
          rec.snapshot(`frenzy-round-${round}`);
        }
      } finally {
        if (greyTrait && greyOrig !== undefined) greyTrait.chance = greyOrig;
      }
      rec.tick(10);
    },
  };
}

// Mob target selection + threat switching (M1): the per-tick target picker and the
// threat-switch rules that decide which player a mob hits and when a taunt or
// pull-over forces a swap. Drives updateMobTarget through the 110% melee and 130%
// ranged pull-over branches (plus the strict-boundary no-switch), the forced-target/
// taunt branch and its forcedTargetTimer expiry, then retargetMob through both the
// highest-threat pick and the prune-to-evade path (which also exercises the two new
// Nythraxis-add seam callbacks via a non-add mob, where they no-op). One hostile mob
// and three players each hold different threat; the mob + players are tracked so
// aggroTargetId, the threat table, forcedTargetTimer/Id, and aiState are pinned every
// snapshot. The four methods draw no rng, so this scenario pins their STATE decisions
// (the surrounding mob-AI draw order is already pinned by affix_mob / the solo runs).
function mobTargeting(): Scenario {
  return {
    name: 'mob_targeting',
    coverage: [
      'updateMobTarget 110% melee pull-over (MELEE_SWITCH_MULT, inMelee MELEE_RANGE*1.2)',
      'updateMobTarget 130% ranged pull-over (RANGED_SWITCH_MULT) + strict-boundary no-switch',
      'forced-target/taunt branch + forcedTargetTimer -= DT expiry + forcedTargetId clear',
      'retargetMob highest-threat pick + prune-to-evade (highestThreatTarget delete-during-iterate)',
      'nythraxisAddFallbackTarget / scheduleNythraxisAddDespawnIfBossReset seam callbacks (non-add -> no-op)',
    ],
    sampleEvery: 2,
    build: () => new Sim({ seed: 1014, playerClass: 'warrior', noPlayer: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      const tankId = sim.addPlayer('warrior', 'Tank');
      const bruiserId = sim.addPlayer('rogue', 'Bruiser');
      const casterId = sim.addPlayer('mage', 'Caster');
      const tank = sim.entities.get(tankId) as AnyEntity;
      const bruiser = sim.entities.get(bruiserId) as AnyEntity;
      const caster = sim.entities.get(casterId) as AnyEntity;
      beef(tank);
      beef(bruiser);
      beef(caster);
      const mob = spawnMob(sim, 'forest_wolf', 5, 0, terrainHeight(0, 0, sim.cfg.seed), 0);
      beef(mob, 50000);
      mob.hostile = true;
      rec.track(mob.id, tankId, bruiserId, casterId);
      rec.notes.mobId = mob.id;
      rec.notes.tankId = tankId;
      rec.notes.bruiserId = bruiserId;
      rec.notes.casterId = casterId;
      // tank + bruiser inside MELEE_RANGE*1.2 (=6) of the mob; caster well outside.
      teleport(sim, tank, 2, 0);
      teleport(sim, bruiser, -2, 0);
      teleport(sim, caster, 0, 20);

      // Baseline: mob on the tank (highest threat); no one is over a switch threshold.
      mob.threat.set(tankId, 100);
      mob.threat.set(bruiserId, 50);
      mob.threat.set(casterId, 50);
      mob.aggroTargetId = tankId;
      mob.aiState = 'attack';
      mob.inCombat = true;
      (sim as any).updateMobTarget(mob);
      rec.snapshot('baseline-tank');

      // 110% melee pull-over: bruiser (in melee) crosses 110% of the tank's 100.
      mob.threat.set(bruiserId, 120);
      (sim as any).updateMobTarget(mob);
      rec.notes.afterMelee = mob.aggroTargetId;
      rec.snapshot('melee-pullover');

      // Ranged strict boundary: caster at EXACTLY 130% does NOT pull (strict `>`).
      mob.aggroTargetId = tankId;
      mob.threat.set(bruiserId, 50);
      mob.threat.set(casterId, 130);
      (sim as any).updateMobTarget(mob);
      rec.notes.afterRangedBoundary = mob.aggroTargetId;
      rec.snapshot('ranged-boundary-no-switch');

      // 130% ranged pull-over: caster (out of melee) crosses 130% of the tank's 100.
      mob.aggroTargetId = tankId;
      mob.threat.set(casterId, 140);
      (sim as any).updateMobTarget(mob);
      rec.notes.afterRanged = mob.aggroTargetId;
      rec.snapshot('ranged-pullover');

      // Forced-target/taunt branch: lock the mob onto the tank despite the caster's
      // higher threat. The branch decrements the timer and early-returns first.
      mob.aggroTargetId = casterId;
      mob.forcedTargetId = tankId;
      mob.forcedTargetTimer = 3;
      (sim as any).updateMobTarget(mob);
      rec.notes.afterTauntForced = mob.aggroTargetId;
      rec.snapshot('taunt-forced');

      // Timer about to expire: this call still honors the forced target (returns
      // before the clear), but the `-= DT` drives forcedTargetTimer negative.
      mob.forcedTargetTimer = DT / 2;
      (sim as any).updateMobTarget(mob);
      rec.snapshot('taunt-decrement');

      // Timer expired: forcedTargetId clears and the threat scan reclaims the caster.
      (sim as any).updateMobTarget(mob);
      rec.notes.afterTauntExpired = mob.aggroTargetId;
      rec.snapshot('taunt-expired');

      // retargetMob: with living threat it grabs the highest (caster) and chases.
      (sim as any).retargetMob(mob);
      rec.notes.afterRetarget = mob.aggroTargetId;
      rec.snapshot('retarget-highest');

      // retargetMob with only stale (missing-entity) threat: highestThreatTarget
      // prunes every entry mid-iterate -> no living target -> (non-add, so both
      // Nythraxis seam callbacks no-op) -> evade home with an empty threat table.
      mob.threat.clear();
      mob.threat.set(900001, 30);
      mob.threat.set(900002, 10);
      mob.aggroTargetId = casterId;
      mob.aiState = 'chase';
      (sim as any).retargetMob(mob);
      rec.notes.finalAiState = mob.aiState;
      rec.snapshot('retarget-evade');
    },
  };
}

// Quest collect-credit + turn-in (Q1): accept a collect quest at its NPC, gather the
// objective item one at a time so each addItem drives onInventoryChangedForQuests
// (counts++ + questProgress) until checkQuestReady promotes active -> ready; then drop
// one item so removeItem demotes ready -> active (the demotion arm), re-collect it, and
// finally turn the quest in (turnInQuest's removeItem re-fires onInventoryChangedForQuests
// before granting xp + copper). Pins the collect path and BOTH arms of checkQuestReady.
function questCollectTurnIn(): Scenario {
  return {
    name: 'quest_collect_turnin',
    coverage: [
      'onInventoryChangedForQuests via addItem/removeItem inventory hub (~9782/9800)',
      'checkQuestReady promotion AND demotion (ready <-> active)',
      'acceptQuest -> finalizeQuestAccept -> onInventoryChangedForQuests',
      'turnInQuest -> removeItem -> onInventoryChangedForQuests (xp + copper)',
    ],
    build: () => new Sim({ seed: 1015, playerClass: 'warrior', autoEquip: false }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      const p = sim.player as AnyEntity;
      const quest = QUESTS.q_boars;
      const item = quest.objectives[0].itemId as string; // boar_hide
      const need = quest.objectives[0].count; // 5
      const npc = [...sim.entities.values()].find(
        (e: AnyEntity) => e.kind === 'npc' && e.templateId === quest.giverNpcId,
      ) as AnyEntity | undefined;
      if (npc) teleport(sim, p, npc.pos.x, npc.pos.z);
      sim.acceptQuest('q_boars', sim.playerId);
      rec.snapshot('quest-accepted');
      // Collect to completion, one hide at a time: each addItem drives the inventory
      // hub -> onInventoryChangedForQuests; the last one promotes the quest to ready.
      for (let i = 0; i < need; i++) {
        sim.addItem(item, 1, sim.playerId);
      }
      rec.snapshot('collect-ready');
      // Demotion arm: drop one hide -> onInventoryChangedForQuests recomputes have < count
      // -> checkQuestReady demotes ready -> active.
      sim.removeItem(item, 1, sim.playerId);
      rec.snapshot('collect-demoted');
      // Re-collect the dropped hide -> ready again.
      sim.addItem(item, 1, sim.playerId);
      rec.snapshot('collect-re-ready');
      // Turn in at the NPC: turnInQuest removes the collected items (re-firing
      // onInventoryChangedForQuests) then grants xp + copper.
      if (npc) teleport(sim, p, npc.pos.x, npc.pos.z);
      sim.turnInQuest('q_boars', sim.playerId);
      rec.snapshot('quest-turned-in');
      rec.tick(2);
    },
  };
}

// Quest link-share + abandon (W4): the two quest verbs no other parity scenario
// drives. Two players, NO proximity needed for the linked path. First the share is
// rejected by the party gate (acceptLinkedQuest's myParty/sharerParty check) and an
// abandon of an unheld quest hits the early-return guard (no emit); then A invites B
// into a party and the share goes through (finalizeQuestAccept's questLog.set + the
// fallback re-grant loop + the accept log, plus the sharer notice back to A); finally
// B abandons the held quest (questLog.delete + the 'Quest abandoned' log). q_wolves is
// shareable (no `shareable:false`), level-gateless, and prereq-free, so it is
// 'available' to a fresh player. Draws NO rng, so the draw-order digest must stay
// byte-identical across the move.
function questLinkAbandon(): Scenario {
  return {
    name: 'quest_link_abandon',
    coverage: [
      'acceptLinkedQuest party-gate: not-in-party error then in-party share',
      'finalizeQuestAccept via the linked-share path (questLog.set + fallback re-grant + sharer notice)',
      'abandonQuest questLog.delete + log emit, plus the not-in-log early-return guard',
    ],
    build: () => new Sim({ seed: 1017, playerClass: 'warrior', noPlayer: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      const a = sim.addPlayer('warrior', 'Aleph'); // sharer
      const b = sim.addPlayer('mage', 'Bet'); // acceptor
      teleport(sim, sim.entities.get(a)!, 20, 20);
      teleport(sim, sim.entities.get(b)!, 21, 20);
      rec.notes.a = a;
      rec.notes.b = b;
      const questId = 'q_wolves';
      // 1. Not partied yet: the party gate rejects the linked accept (error, no quest).
      sim.acceptLinkedQuest(questId, a, b);
      rec.snapshot('link-no-party');
      // 2. Abandon a quest B does not hold: the `!questLog.has` early-return (no emit).
      sim.abandonQuest(questId, b);
      rec.snapshot('abandon-noop');
      // 3. Form a party (A invites, B accepts).
      sim.partyInvite(b, a);
      sim.partyAccept(b);
      rec.snapshot('partied');
      // 4. In party + quest available: the share goes through (finalizeQuestAccept
      //    re-grant + accept log, plus the sharer notice to A).
      sim.acceptLinkedQuest(questId, a, b);
      rec.snapshot('link-accepted');
      // 5. B abandons the quest it now holds (questLog.delete + 'Quest abandoned' log).
      sim.abandonQuest(questId, b);
      rec.snapshot('abandoned');
      rec.tick(2);
    },
  };
}

// Party/raid state machine (A1): the full social flow, which draws NO rng of its
// own. Forms a party of five, converts it to a raid, fills to a second subgroup,
// moves a member across groups, then hands off leadership and drains the roster to
// a disband. Pins the party emit stream (invite + join/convert/move/leave/handoff/
// disband logs) in order; partyOf must keep resolving after the move. The draw-order
// digest must stay byte-identical (this slice never touches rng), so any drift means
// a surrounding draw shifted.
function partyRaid(): Scenario {
  return {
    name: 'party_raid',
    coverage: [
      'partyInvite/partyAccept party formation (~11864/11901)',
      'convertPartyToRaid full-party gate (RAID_MIN) + normalizeRaidGroups',
      'raid fill to two subgroups (nextRaidGroupFor) + moveRaidMember (RAID_GROUP_MAX)',
      'removeFromParty leadership handoff + disband + partyOf via SimContext',
    ],
    build: () => new Sim({ seed: 1014, playerClass: 'warrior', noPlayer: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      const a = sim.addPlayer('warrior', 'Aaa');
      const b = sim.addPlayer('mage', 'Bbb');
      const c = sim.addPlayer('rogue', 'Ccc');
      const d = sim.addPlayer('hunter', 'Ddd');
      const e = sim.addPlayer('warlock', 'Eee');
      const f = sim.addPlayer('paladin', 'Fff');
      const g = sim.addPlayer('warrior', 'Ggg');
      rec.track(a, b, c, d, e, f, g);
      // 1) a invites four; each accepts -> a full party of five.
      for (const m of [b, c, d, e]) {
        sim.partyInvite(m, a);
        sim.partyAccept(m);
      }
      rec.snapshot('party-of-5');
      // 2) convert the full party to a raid (requires RAID_MIN members).
      sim.convertPartyToRaid(a);
      rec.snapshot('raid');
      // 3) invite two more; subgroup 1 is full (5) so they land in subgroup 2.
      for (const m of [f, g]) {
        sim.partyInvite(m, a);
        sim.partyAccept(m);
      }
      rec.snapshot('raid-of-7');
      // 4) move a subgroup-1 member into subgroup 2.
      sim.moveRaidMember(b, 2, a);
      rec.snapshot('moved');
      // 5) the leader leaves -> leadership hands off to the first remaining member.
      sim.partyLeave(a);
      rec.snapshot('leader-left');
      // 6) drain the rest; the last departure triggers the disband branch.
      for (const m of [c, d, e, f, g]) sim.partyLeave(m);
      rec.snapshot('disband');
    },
  };
}

// Talent application (G1a): exercise every sim-side talent method (applyTalents /
// respec / saveLoadout + switchLoadout / setSpec) on a max-level warrior so the flat
// `talentMods` struct re-bakes and the known-ability list flips on each change. Drives
// NO rng (talent application is deterministic validation + struct baking), so the draw
// digest stays empty/byte-identical across the extraction. Pure snapshots, no ticks, so
// the player never enters combat and the talent-lock guard never trips.
function talentsProgression(): Scenario {
  return {
    name: 'talents_progression',
    coverage: [
      'applyTalents valid spec build (G1a) + recomputeTalents flat-struct bake',
      'respec wipes ranks, keeps spec',
      'saveLoadout (object-alloc overload) + switchLoadout (2 of 4 slots)',
      'setSpec drops the prior spec tree points',
      'refreshKnownAbilities(announce=false): known-ability list flips per change',
    ],
    sampleEvery: 2,
    build: () => new Sim({ seed: 1014, playerClass: 'warrior', autoEquip: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      sim.setPlayerLevel(MAX_LEVEL); // enough talent points for a spec'd build
      // (1) Apply a valid Arms build: the flat talentMods bakes + known list changes.
      sim.applyTalents({
        spec: 'arms',
        ranks: { war_cruelty: 2, arms_imp_overpower: 2 },
        choices: {},
      });
      rec.snapshot('apply-arms');
      // (2) Respec: ranks wiped, spec retained, stats revert.
      sim.respec();
      rec.snapshot('respec');
      // (3) Save the respec'd build as a loadout (the HUD positional-alloc overload),
      // apply a different build, then switch back to slot 0.
      sim.saveLoadout('Arms', ['mortal_strike', 'overpower', null], {
        spec: 'arms',
        ranks: { arms_imp_overpower: 2 },
        choices: {},
      });
      sim.applyTalents({ spec: 'arms', ranks: { war_cruelty: 3 }, choices: {} });
      rec.snapshot('second-build');
      sim.switchLoadout(0);
      rec.snapshot('switch-loadout');
      // (4) Set spec to Fury: the prior (Arms) spec tree's points drop; class points stay.
      sim.setSpec('fury');
      rec.snapshot('set-spec');
    },
  };
}

// C2 heal core: a healer of every class that owns a heal (priest/paladin/druid/
// shaman) heals a damaged tank while three hostile mobs hold threat on it, so BOTH
// the heal math (crit branch via the rng.chance(spellCrit) draw, overheal clamp,
// Weakening-Hex outgoing cut, Mortal-Wound incoming cut, heal-absorb soak with the
// depleted/survived split) AND the healingThreat fan-out (split evenly across the
// aware mobs, including the pet-owner threat-entry branch) land in the sampled
// trace. The four direct applyHeal calls are the verbatim heal core; the closing
// druid HoT exercises the aura-tick foreign callers (healingTakenMult + healingThreat
// off the `hot` branch), and a forced crit on a critvuln+hexed target exercises the
// dealDamage consumers of critVulnBonus/hexOutputMult. Forced crits boost the source's
// int so rng.chance(spellCrit) is certain to pass (the draw STILL fires, so the
// draw-order log stays meaningful); int is restored immediately. The existing four
// solo/mob scenarios never build a heal or a healing-threat table (parity CLAUDE.md
// "Known coverage gaps"), so this is the only scenario that pins heal drift.
function aura(spec: {
  id: string;
  name: string;
  kind: Aura['kind'];
  value: number;
  sourceId: number;
  duration?: number;
  tickInterval?: number;
}): Aura {
  const duration = spec.duration ?? 60;
  return {
    id: spec.id,
    name: spec.name,
    kind: spec.kind,
    remaining: duration,
    duration,
    value: spec.value,
    sourceId: spec.sourceId,
    school: 'physical',
    ...(spec.tickInterval !== undefined ? { tickInterval: spec.tickInterval } : {}),
  } as Aura;
}

function multiClassHeal(): Scenario {
  return {
    name: 'multi_class_heal',
    coverage: [
      'applyHeal core: crit branch (rng.chance(spellCrit) draw), overheal clamp, heal2 emit',
      'hexOutputMult outgoing cut (hex on source) + healingTakenMult Mortal-Wound cut (target)',
      'consumeHealAbsorb soak: small shield depletes+filters, big shield survives',
      'healingThreat even split across multiple aware mobs (entities.values insertion order)',
      'threatEntryMatchesEntity direct-target + pet-owner branches',
      'hot aura-tick heal path (healingTakenMult ~3089 + healingThreat ~3101)',
      'dealDamage consumers: critVulnBonus (crit-only) + hexOutputMult on a damage hit',
      'multi-class healers: priest/paladin/druid/shaman',
    ],
    sampleEvery: 5,
    build: () => new Sim({ seed: 1016, playerClass: 'priest', noPlayer: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      // Four healers, each a class that owns a heal.
      const priest = sim.addPlayer('priest', 'Pr') as number;
      const paladin = sim.addPlayer('paladin', 'Pa') as number;
      const druid = sim.addPlayer('druid', 'Dr') as number;
      const shaman = sim.addPlayer('shaman', 'Sh') as number;
      const healerIds = [priest, paladin, druid, shaman];
      healerIds.forEach((pid, i) => {
        teleport(sim, sim.entities.get(pid) as AnyEntity, i * 3, -30);
      });
      const ePriest = sim.entities.get(priest) as AnyEntity;
      const ePaladin = sim.entities.get(paladin) as AnyEntity;
      const eDruid = sim.entities.get(druid) as AnyEntity;
      const eShaman = sim.entities.get(shaman) as AnyEntity;

      // The damaged friendly the healers heal (a player, so it is sampled by default).
      const tankPid = sim.addPlayer('warrior', 'Tk') as number;
      const tank = sim.entities.get(tankPid) as AnyEntity;
      teleport(sim, tank, 30, -30);
      beef(tank, 10000);

      // A pet owned by the tank, so a mob holding threat on the PET (not the tank
      // directly) still counts the tank as aware via threatEntryMatchesEntity's
      // owner branch. Friendly + no threat of its own, so it is never an aware mob.
      const pet = spawnMob(sim, 'forest_wolf', 5, 80, tank.pos.y, 80);
      pet.ownerId = tankPid;
      pet.hostile = false;
      pet.inCombat = false;

      // Three hostile mobs in combat on the tank, far enough that they do not engage
      // within the short HoT tick window. m1/m2 hold the tank directly; m3 holds the
      // tank's pet (the owner branch). Threat is seeded directly so the split is
      // deterministic and re-derivable for QA.
      const m1 = spawnMob(sim, 'forest_wolf', 5, 90, tank.pos.y, 90);
      const m2 = spawnMob(sim, 'forest_wolf', 5, -90, tank.pos.y, 90);
      const m3 = spawnMob(sim, 'forest_wolf', 5, 90, tank.pos.y, -90);
      for (const m of [m1, m2, m3]) {
        beef(m, 50000);
        m.hostile = true;
        m.inCombat = true;
        m.aiState = 'idle';
      }
      m1.threat.set(tankPid, 10);
      m2.threat.set(tankPid, 10);
      m3.threat.set(pet.id, 10); // owner branch: pet in m3's hate table
      rec.track(m1.id, m2.id, m3.id, pet.id);
      rec.notes.healerIds = healerIds;
      rec.notes.tankPid = tankPid;
      rec.notes.m1Id = m1.id;
      rec.notes.m2Id = m2.id;
      rec.notes.m3Id = m3.id;
      rec.notes.petId = pet.id;
      rec.notes.hotAbility = 'Rejuvenation';

      // Force a crit by boosting int so spellCrit(source) >= 1: rng.chance STILL
      // draws (next() < p), it just always passes, so the *1.5 crit path lands in
      // the golden deterministically. Restored immediately after the heal.
      const forcedHeal = (e: AnyEntity, source: number, amount: number, ability: string): void => {
        const int0 = e.stats.int;
        e.stats.int = 5000;
        (sim as any).applyHeal(sim.entities.get(source) as AnyEntity, tank, amount, ability);
        e.stats.int = int0;
      };

      // Heal 1: priest, plain (no mults), tank damaged -> split across all 3 mobs.
      tank.hp = 2000;
      (sim as any).applyHeal(ePriest, tank, 600, 'Heal');

      // Heal 2: paladin, forced crit (no mults) -> *1.5 path.
      tank.hp = 2000;
      forcedHeal(ePaladin, paladin, 800, 'Holy Light');

      // Heal 3: druid, hex on source (outgoing cut) + Mortal-Wound on target
      // (incoming cut), forced crit -> crit*hex*mortal combined.
      eDruid.auras.push(
        aura({ id: 'hex_dr', name: 'Weakening Hex', kind: 'hex', value: 0.3, sourceId: m1.id }),
      );
      tank.auras.push(
        aura({
          id: 'mw_tk',
          name: 'Mortal Wound',
          kind: 'mortal_wound',
          value: 0.5,
          sourceId: m1.id,
        }),
      );
      tank.hp = 2000;
      forcedHeal(eDruid, druid, 1000, 'Healing Touch');
      tank.auras = tank.auras.filter((a: Aura) => a.kind !== 'mortal_wound');

      // Heal 4: shaman, two heal-absorb shields -> the small one depletes and is
      // filtered out, the big one survives with reduced budget.
      tank.auras.push(
        aura({
          id: 'absorb_small',
          name: 'Necrotic',
          kind: 'heal_absorb',
          value: 200,
          sourceId: m1.id,
        }),
      );
      tank.auras.push(
        aura({
          id: 'absorb_big',
          name: 'Necrotic',
          kind: 'heal_absorb',
          value: 5000,
          sourceId: m1.id,
        }),
      );
      tank.hp = 2000;
      (sim as any).applyHeal(eShaman, tank, 1000, 'Healing Wave');

      // Heal 5: overheal -> healed clamps to 0 -> healingThreat healed<=0 early bail.
      tank.hp = tank.maxHp;
      (sim as any).applyHeal(ePriest, tank, 500, 'Heal');

      // Heal 6: aware.length===0 early bail (target with no mob holding threat on it).
      ePaladin.hp = Math.max(1, ePaladin.maxHp - 200);
      (sim as any).applyHeal(ePriest, ePaladin, 300, 'Heal');
      // One checkpoint pins the cumulative result of all six heals (per-heal amount +
      // crit are folded into this window's event digest; the draw-order log + tank/mob
      // threat tables are pinned in the frame body).
      rec.snapshot('heals');

      // dealDamage consumers: druid (still hexed) crit-hits a critvuln mob ->
      // hexOutputMult (outgoing-damage cut) + critVulnBonus (crit-only) both read.
      m1.auras.push(
        aura({ id: 'cv_m1', name: 'Find Weakness', kind: 'critvuln', value: 0.5, sourceId: druid }),
      );
      sim.dealDamage(eDruid, m1, 100, true, 'physical', 'Smite', 'hit');
      rec.snapshot('crit-vuln-damage');

      // HoT path: a druid Rejuvenation on the tank ticks through the `hot` aura
      // branch -> healingTakenMult(~3089) + healingThreat(~3101) foreign callers.
      // (The surviving absorb_big rides along untouched: the hot branch never calls
      // consumeHealAbsorb, only applyHeal does.)
      tank.hp = 2000;
      tank.auras.push(
        aura({
          id: 'hot_tk',
          name: 'Rejuvenation',
          kind: 'hot',
          value: 300,
          sourceId: druid,
          duration: 3,
          tickInterval: 0.1,
        }),
      );
      rec.tick(8); // ~4 HoT ticks; finish() pins the end state + folded HoT events
    },
  };
}

// Mob locomotion (M2): the updateMob dispatcher's boss-mechanic attack arms plus the
// idle-wander, evade-arrival, and cowardly-flee states. Each is driven DIRECTLY through
// updateMob (exactly as the mob_* unit tests do; the extraction keeps a thin Sim
// delegate) so the rng draws INSIDE the moved arms are pinned at fixed stream positions:
// aoePulse rng.range(min,max), War Stomp rng.range(min,max), Banshee terrify
// rng.range(-PI,PI), the idle wander heading/radius draws, and resetEvadingMob's
// rng.range(2,8). The flee path (maybeFlee at FLEE_HP_THRESHOLD -> flee arm) draws no
// rng but pins its full-state transition. The four mechanic mobs sit on the player in
// melee (spawnPos == player pos, so no leash); the wanderer/evader sit far out of aggro
// range. None of these mobs is profiled, so the attack arm reaches every mechanic.
function mobLocomotion(): Scenario {
  return {
    name: 'mob_locomotion',
    coverage: [
      'attack arm aoePulse rng.range(pulse.min,pulse.max) + spellfx (mogger Ground Pound)',
      'attack arm War Stomp rng.range(stomp.min,stomp.max) + stomp_stun aura (korgath)',
      'attack arm Banshee terrify rng.range(-PI,PI) fear facing + fear_incap aura (sister_nhalia)',
      'idle arm wander draws (range(0,2PI) heading + range(2,9) radius -> groundPos wanderTarget)',
      'evade arm arrival -> resetEvadingMob (rng.range(2,8), full-heal, clearThreat, telegraph re-arm)',
      'cowardly flee: maybeFlee at FLEE_HP_THRESHOLD -> flee arm (fleeMoveSpeed run-away)',
    ],
    sampleEvery: 1,
    build: () => new Sim({ seed: 7777, playerClass: 'warrior', noPlayer: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      const pid = sim.addPlayer('warrior', 'Anvil');
      const player = sim.entities.get(pid) as AnyEntity;
      rec.track(pid);
      rec.notes.pid = pid;
      // Keep the target alive through every mechanic. beef() on a player does not
      // stick: applyAura -> recalcPlayerStats resets maxHp to the real (level-1)
      // value, so each boss aura would otherwise shrink maxHp and the next mechanic
      // would kill the player. recalc clamps only at the aura-apply point (at/after
      // the draw), so a fresh top-up right before each call keeps every draw firing.
      const reviveTarget = () => {
        player.hp = 1_000_000;
      };

      // Spawn a boss locked in melee on the player (spawnPos == player pos -> no leash),
      // arm its mechanic timer to fire now, then tick its AI once so the mechanic lands.
      const fireMechanic = (key: string, level: number, arm: (m: AnyEntity) => void): AnyEntity => {
        const m = spawnMob(sim, key, level, player.pos.x, player.pos.y, player.pos.z);
        m.spawnPos = { ...player.pos };
        m.aiState = 'attack';
        m.aggroTargetId = pid;
        m.inCombat = true;
        m.hostile = true;
        arm(m);
        reviveTarget();
        rec.track(m.id);
        (sim as any).updateMob(m);
        return m;
      };

      // aoePulse: Ground Pound draws rng.range(14,20) per player in radius.
      const pulser = fireMechanic('mogger', 6, (m) => {
        m.pulseTimer = 0.001;
      });
      rec.notes.pulserId = pulser.id;
      rec.snapshot('aoe-pulse');

      // War Stomp: draws rng.range(20,30) + lands a stomp_stun aura on the player.
      const stomper = fireMechanic('korgath_the_bound', 20, (m) => {
        m.stompTimer = 0.001;
      });
      rec.notes.stomperId = stomper.id;
      rec.notes.stompStunLanded = player.auras.some((a: any) => a.id === 'stomp_stun');
      rec.snapshot('war-stomp');

      // Banshee terrify: draws rng.range(-PI,PI) for the fear facing + fear_incap aura.
      const terrifier = fireMechanic('sister_nhalia', 12, (m) => {
        m.terrifyTimer = 0.001;
      });
      rec.notes.terrifierId = terrifier.id;
      rec.notes.fearLanded = player.auras.some((a: any) => a.id === 'fear_incap');
      rec.snapshot('terrify');

      // Idle wander: a mob far out of aggro range whose wanderTimer is due picks a new
      // wander target (rng.range(0,2PI) heading + rng.range(2,9) radius -> groundPos).
      const wanderer = spawnMob(
        sim,
        'forest_wolf',
        5,
        300,
        terrainHeight(300, 300, sim.cfg.seed),
        300,
      );
      wanderer.aiState = 'idle';
      wanderer.wanderTarget = null;
      wanderer.wanderTimer = 0.001;
      rec.track(wanderer.id);
      (sim as any).updateMob(wanderer);
      rec.notes.wandererId = wanderer.id;
      rec.snapshot('idle-wander');

      // Evade arrival: a mob already at its spawn in the evade state arrives immediately
      // (moveToward returns true at dist 0) -> resetEvadingMob (rng.range(2,8) wanderTimer,
      // hp -> maxHp, threat cleared, telegraph timers re-armed).
      const evader = spawnMob(
        sim,
        'forest_wolf',
        5,
        320,
        terrainHeight(320, 320, sim.cfg.seed),
        320,
      );
      evader.aiState = 'evade';
      evader.hp = 1;
      evader.inCombat = true;
      evader.threat.set(pid, 50);
      rec.track(evader.id);
      (sim as any).updateMob(evader);
      rec.notes.evaderHp = evader.hp;
      rec.notes.evaderState = evader.aiState;
      rec.snapshot('evade-reset');

      // Cowardly flee: a low-HP humanoid in melee panics once (maybeFlee at/under
      // FLEE_HP_THRESHOLD -> aiState 'flee'), then the flee arm runs it away. The
      // 'attempts to flee!' emit stays on Sim; a fleeing mob no longer rallies
      // allies (no social aggro), and the flee arm draws no rng.
      const coward = spawnMob(
        sim,
        'mogger_lackey',
        6,
        player.pos.x + 1,
        player.pos.y,
        player.pos.z + 1,
      );
      coward.spawnPos = { ...coward.pos };
      coward.aiState = 'attack';
      coward.aggroTargetId = pid;
      coward.inCombat = true;
      coward.hostile = true;
      coward.hp = Math.max(1, Math.floor(coward.maxHp * 0.15)); // <= FLEE_HP_THRESHOLD (0.2)
      rec.track(coward.id);
      reviveTarget(); // the lackey needs a living target to panic away from
      (sim as any).updateMob(coward); // attack arm -> maybeFlee triggers the flee
      rec.notes.cowardStateAfterPanic = coward.aiState;
      rec.snapshot('flee-panic');
      reviveTarget();
      (sim as any).updateMob(coward); // flee arm: fleeMoveSpeed + run away from the player
      rec.notes.cowardStateFleeing = coward.aiState;
      rec.snapshot('flee-run');
    },
  };
}

// Delve run progression (I2a): the multi-module run lifecycle the existing
// delve_lockpick golden skips (it pins straight to the finale). Pins a two-module
// run (one non-finale chamber + the finale), clears the chamber (mobs down +
// pressure plates stepped), walks the opened tombstone exit so advanceDelveModule
// rolls onto the finale, then buys at the Marks shop (delveBuyShopItem gate +
// addItem), upgrades the companion (Marks/copper spend), and rolls the UTC day so
// refreshDelveDaily resets firstClearXp/markClears. Covers spawnDelveModule(x2),
// tickDelvePressurePlates, tryOpen/openDelveExitPortal, findDelveExitPortal,
// tickDelveModuleExit, advanceDelveModule, the shop, and the daily reset, none of
// which the finale-only delve_lockpick scenario exercises.
function delveProgression(): Scenario {
  return {
    name: 'delve_progression',
    coverage: [
      'multi-module delve: spawnDelveModule(non-finale) -> clear -> advanceDelveModule',
      'tickDelvePressurePlates + exit portal open + tombstone advance',
      'Marks shop buy (delveBuyShopItem gate + addItem + vendor)',
      'companionUpgrade rank bump + refreshDelveDaily day rollover',
    ],
    sampleEvery: 5,
    build: () => new Sim({ seed: 2010, playerClass: 'warrior', autoEquip: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      const def = DELVES.collapsed_reliquary;
      sim.setPlayerLevel(def.minLevel);
      const p = sim.player as AnyEntity;
      beef(p);
      teleport(sim, p, def.doorPos.x, def.doorPos.z);
      sim.enterDelve('collapsed_reliquary', 'normal');
      const run = sim.delveRunForPlayer(sim.playerId);
      if (!run) {
        rec.tick(2);
        return;
      }
      run.bountiful = false; // pin against the rare coffer roll
      // Pin a two-module run: one non-finale chamber, then the finale.
      const nonFinale = def.modules.find((m: string) => m !== def.finaleModuleId) as string;
      run.modules = [nonFinale, def.finaleModuleId];
      run.moduleIndex = 0;
      (sim as any).spawnDelveModule(run);
      // Clear the chamber: down every spawned mob, then step every pressure plate
      // through the real tickDelvePressurePlates path (teleport onto the plate).
      for (const id of [...run.mobIds]) {
        const m = sim.entities.get(id) as AnyEntity | undefined;
        if (m) m.dead = true;
      }
      for (const oid of [...run.objectIds]) {
        if (run.objectState[oid]?.kind !== 'pressure_plate') continue;
        const plate = sim.entities.get(oid) as AnyEntity | undefined;
        if (!plate) continue;
        p.pos = { x: plate.pos.x, y: plate.pos.y, z: plate.pos.z };
        p.prevPos = { ...p.pos };
        sim.rebucket(p);
        rec.tick(1); // tickDelvePressurePlates triggers this plate
      }
      rec.tick(2); // all mobs dead + plates triggered -> exit portal opens
      const portal = [...sim.entities.values()].find(
        (e: AnyEntity) => run.objectState[e.id]?.kind === 'module_exit',
      ) as AnyEntity | undefined;
      if (portal) {
        p.pos = { x: portal.pos.x, y: portal.pos.y, z: portal.pos.z };
        p.prevPos = { ...p.pos };
        sim.rebucket(p);
        rec.tick(3); // walk into the tombstone -> advanceDelveModule to the finale
      }
      rec.snapshot('advanced-to-finale');
      // Marks shop: an 'available'-gated piece + a companion rank bump.
      const meta = sim.players.get(sim.playerId) as any;
      meta.delveMarks = 100;
      meta.copper = 100000;
      sim.delveBuyShopItem('collapsed_reliquary', 'reliquary_legs');
      sim.companionUpgrade('companion_tessa');
      // Daily rollover: a fresh UTC day resets firstClearXp/markClears.
      meta.delveDaily = { date: '2099-01-01', firstClearXp: new Set(['seed']), markClears: 2 };
      sim.utcDay = '2099-06-25';
      sim.delveDailyWire(sim.playerId);
      rec.snapshot('shop-daily');
      rec.tick(2);
    },
  };
}

// Delve companion AI (I2c): the full updateDelveCompanion brain for Acolyte Tessa,
// upgraded to rank 2, across all three arms in one run. (a) COMBAT: she acquires the
// owner's hostile target (the finale boss), closes to MELEE_RANGE*0.9, and swings via
// the shared mobSwing on her weapon cadence (the rng crit/hit draws this slice must
// keep in stream order). To pin the close-to-reach branch too, she is shoved out of
// reach mid-fight so she re-approaches and swings again. (b) HEAL: while in combat the
// owner drops to 50% within DELVE_COMPANION_HEAL_RANGE and the wanderTimer fires a
// RANK-2 DELVE_COMPANION_HEAL_PCT percent heal (direct hp mutation + heal/spellfx emit,
// no aura). (c) HEEL: with the swarm dropped and combatTarget null she moveToward's the
// owner past DELVE_COMPANION_FOLLOW, then warps + rebuckets past PET_TELEPORT_DISTANCE.
// Pins the heal/heel arms + rank scaling the combat-only delve_lockpick golden skips.
function delveCompanion(): Scenario {
  return {
    name: 'delve_companion',
    coverage: [
      'updateDelveCompanion combat arm: acquire owner target -> close-to-reach -> mobSwing on cadence (~16762 rng draws)',
      'updateDelveCompanion rank-2 heal arm: DELVE_COMPANION_HEAL_PCT[2] percent heal of the lowest-HP party member (heal + spellfx tick)',
      'updateDelveCompanion heel arm: moveToward owner past DELVE_COMPANION_FOLLOW, then warp + rebucket past PET_TELEPORT_DISTANCE',
      'combat_start/low_hp barks via maybeCompanionBark (stays on Sim)',
    ],
    sampleEvery: 5,
    build: () => new Sim({ seed: 3010, playerClass: 'warrior', autoEquip: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      const def = DELVES.collapsed_reliquary;
      sim.setPlayerLevel(def.minLevel);
      const p = sim.player as AnyEntity;
      beef(p);
      teleport(sim, p, def.doorPos.x, def.doorPos.z);
      // Rank 2 BEFORE enter: spawnDelveCompanion scales her level AND the heal arm
      // scales by DELVE_COMPANION_HEAL_PCT[2].
      const meta = sim.players.get(sim.playerId) as Record<string, any>;
      meta.companionUpgrades.companion_tessa = 2;
      sim.enterDelve('collapsed_reliquary', 'normal');
      const run = sim.delveRunForPlayer(sim.playerId);
      if (!run) {
        rec.tick(2);
        return;
      }
      run.bountiful = false; // pin against the rare coffer roll
      run.modules = ['reliquary_finale'];
      run.moduleIndex = 0;
      (sim as any).spawnDelveModule(run);
      const comp = run.companion
        ? (sim.entities.get(run.companion.entityId) as AnyEntity | undefined)
        : undefined;
      const boss = [...sim.entities.values()].find(
        (e: AnyEntity) => e.templateId === 'deacon_varric',
      ) as AnyEntity | undefined;
      if (!comp || !boss) {
        rec.tick(2);
        return;
      }
      rec.notes.companionId = comp.id;
      rec.track(comp.id, boss.id);

      // (a) COMBAT: owner targets the beefed boss; the companion acquires it and swings
      // on cadence. Start adjacent for a guaranteed first swing...
      beef(boss, 40000); // survive the swings -> repeated cadence draws
      boss.hostile = true;
      comp.pos = { x: boss.pos.x + 1, y: boss.pos.y, z: boss.pos.z };
      comp.prevPos = { ...comp.pos };
      comp.swingTimer = 0;
      sim.rebucket(comp);
      sim.targetEntity(boss.id);
      rec.tick(20); // in-reach: mobSwing on cadence
      // ...then shove her out of reach so the close-to-reach branch (moveToward) runs
      // and she re-approaches to swing again.
      comp.pos = { x: boss.pos.x + 10, y: boss.pos.y, z: boss.pos.z };
      comp.prevPos = { ...comp.pos };
      sim.rebucket(comp);
      rec.tick(20); // close-to-reach -> re-approach -> swing
      rec.snapshot('combat');

      // (b) HEAL: still in combat, the owner drops to 50% within heal range -> the
      // wanderTimer fires a rank-2 percent heal (direct hp + heal/spellfx emit).
      teleport(sim, p, comp.pos.x + 3, comp.pos.z); // within DELVE_COMPANION_HEAL_RANGE
      p.hp = Math.max(1, Math.round(p.maxHp * 0.5));
      comp.wanderTimer = 0;
      rec.tick(1);
      rec.snapshot('heal');

      // (c) HEEL: drop the swarm + clear the target so combatTarget is null; the owner
      // a short walk away pulls a moveToward, and far away a warp + rebucket.
      for (const [id, ent] of [...sim.entities]) {
        if ((ent as AnyEntity).kind === 'mob' && (ent as AnyEntity).hostile)
          sim.entities.delete(id);
      }
      p.targetId = null;
      p.autoAttack = false;
      p.inCombat = false;
      teleport(sim, p, comp.pos.x + 12, comp.pos.z); // > DELVE_COMPANION_FOLLOW (4)
      rec.tick(8); // heel: moveToward owner
      rec.snapshot('heel-walk');
      teleport(sim, p, comp.pos.x + 80, comp.pos.z); // > PET_TELEPORT_DISTANCE (60)
      rec.tick(2); // heel: warp + rebucket
      rec.snapshot('heel-teleport');
    },
  };
}

// Dungeon instancing (I1): a party walks through the Hollow Crypt door (the
// updateDoorTriggers door-trigger teleport -> enterDungeon -> claimInstance, which
// draws rng.int once per spawn). The second party member walks the same door and
// joins the SAME instance via instanceKeyFor (no re-claim, no rng). Both then walk
// the exit portal back out (updateDoorTriggers exit branch -> leaveDungeon), and
// finally the empty instance resets (updateInstances -> freeInstance despawns the
// mobs/objects/exit and nulls partyKey).
function dungeonInstances(): Scenario {
  return {
    name: 'dungeon_instances',
    coverage: [
      'updateDoorTriggers door-trigger enter (~14612)',
      'enterDungeon -> claimInstance rng.int per spawn (~14774) + addEntity mobs/objects/exit',
      'party shares ONE instance via instanceKeyFor (second member joins, no re-claim)',
      'updateDoorTriggers exit portal -> leaveDungeon (~14620)',
      'updateInstances empty-reset -> freeInstance despawn + partyKey null (~14841/14816)',
    ],
    sampleEvery: 5,
    build: () => new Sim({ seed: 1016, playerClass: 'warrior', noPlayer: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      const a = sim.addPlayer('warrior', 'Aaa');
      const b = sim.addPlayer('mage', 'Bbb');
      sim.partyInvite(b, a);
      sim.partyAccept(b);
      const ea = sim.entities.get(a) as AnyEntity;
      const eb = sim.entities.get(b) as AnyEntity;
      beef(ea);
      beef(eb);
      // Walk player A onto the Hollow Crypt door -> the movement-pass door trigger
      // enters the dungeon and claims a fresh instance (rng.int per spawned mob).
      const door = [...sim.entities.values()].find(
        (e: AnyEntity) => e.templateId === 'dungeon_door' && e.dungeonId === 'hollow_crypt',
      ) as AnyEntity;
      teleport(sim, ea, door.pos.x, door.pos.z);
      rec.tick(1);
      // Player B walks the same door -> same instanceKeyFor -> joins A's instance.
      teleport(sim, eb, door.pos.x, door.pos.z);
      rec.tick(1);
      const inst = (sim.instances as any[]).find(
        (i) => i.dungeonId === 'hollow_crypt' && i.partyKey !== null,
      );
      rec.track(...inst.mobIds, ...inst.objectIds);
      if (inst.exitId != null) rec.track(inst.exitId);
      rec.notes.slotA = sim.instanceSlotAt(ea.pos);
      rec.notes.slotB = sim.instanceSlotAt(eb.pos);
      rec.notes.instMobIds = [...inst.mobIds];
      rec.snapshot('entered');
      // Walk both out via the exit portal (the inside branch of updateDoorTriggers).
      const exit = sim.entities.get(inst.exitId) as AnyEntity;
      teleport(sim, ea, exit.pos.x, exit.pos.z);
      rec.tick(1);
      teleport(sim, eb, exit.pos.x, exit.pos.z);
      rec.tick(1);
      rec.snapshot('left');
      // Reset-when-empty: nobody inside, jump the empty timer past INSTANCE_EMPTY_TIMEOUT
      // (300s) so a single updateInstances cycle (% 20) runs freeInstance.
      inst.emptyFor = 100000;
      rec.tick(20);
      rec.snapshot('reset');
    },
  };
}

// Dungeon raid lockout (I1): a five-strong attuned raid is blocked from re-entering
// the Nythraxis arena by an active raid lockout. Exercises enterDungeon's raid gating
// (convertPartyToRaid + canEnterNythraxisRaid attunement) and the isRaidLocked block
// emitting "You are locked to Nythraxis Raid Arena." (no rng drawn).
function dungeonRaidLockout(): Scenario {
  return {
    name: 'dungeon_raid_lockout',
    coverage: [
      'enterDungeon raid gating: convertPartyToRaid + canEnterNythraxisRaid attunement (~14640)',
      'isRaidLocked active lockout blocks entry (~14706) + locked-to-arena emit',
    ],
    sampleEvery: 10,
    build: () => new Sim({ seed: 1017, playerClass: 'warrior', noPlayer: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      const leader = sim.addPlayer('warrior', 'Lead');
      // convertPartyToRaid requires a full party of five.
      while ((sim.partyOf(leader)?.members.length ?? 1) < 5) {
        const pid = sim.addPlayer('priest', `Fill${sim.players.size}`);
        sim.partyInvite(pid, leader);
        sim.partyAccept(pid);
      }
      sim.convertPartyToRaid(leader);
      const meta = sim.players.get(leader) as any;
      meta.questsDone.add('q_nythraxis_bound_guardian'); // attune past the royal-door seal
      meta.raidLockouts.set('nythraxis_boss_arena', 999999999); // active lockout (far future ms)
      rec.snapshot('locked');
      sim.enterDungeon('nythraxis_boss_arena', leader); // blocked by isRaidLocked
      rec.snapshot('lockout-blocked');
      rec.tick(1);
    },
  };
}

// Nythraxis full raid pull (N1): the most coupled scripted content in the sim,
// driven end to end through every phase so the encounter extraction is pinned.
// A five-strong attuned raid enters the arena; the tank engages and four max-level
// mages stack in the room as Soul Rend candidates + wardstone channelers. Every
// room player is topped to full each tick (`step`) so a stray wipe never resets the
// encounter mid-pull -- the transition stun re-applies player stats (applyAura ->
// recalcPlayerStats), so we cannot simply inflate maxHp once. The drive exercises:
//  - phase 1 Gravebreaker (rng.range weapon draw + cone) and a forced Raise Fallen add wave
//  - the 70% transition: room War Stomp stun + Brother Aldric spawn/walk-in + wardstones lit
//  - phase 2 Soul Rend (rng.int marks pick) -> mark expiry damage
//  - Deathless Rage cast -> three players channel the wardstones (tryStartNythraxisWardChannel
//    via the object click) -> the interrupt + boss self-stun
//  - the 5% Final Stand enrage
//  - the kill: grantNythraxisLockout (raidLockouts set) + the onBossDeath death dialogue
// The two encounter rng draws (Gravebreaker rng.range, Soul Rend rng.int) ride the
// shared stream, so the draw-order digest pins them at their global positions.
function nythraxisFullPull(): Scenario {
  return {
    name: 'nythraxis_full_pull',
    coverage: [
      'updateNythraxisEncounter full pull (phase 1 -> transition -> phase 2 -> final stand -> death)',
      'Gravebreaker rng.range weapon draw + front-cone Gravebreaker damage',
      'Raise Fallen add wave (spawnNythraxisAdds) in phase one',
      'transition: nythraxis_transition_stun room stun + Aldric spawn/walk-in + wardstones lit',
      'Soul Rend rng.int marks pick + mark-expiry damage',
      'Deathless Rage interrupt via tryStartNythraxisWardChannel (object-click channel) + boss self-stun',
      'Final Stand enrage at 5% + grantNythraxisLockout (raidLockouts) + onBossDeath death dialogue',
      'class:warrior',
    ],
    sampleEvery: 10,
    build: () => new Sim({ seed: 1031, playerClass: 'warrior', noPlayer: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      const tankPid = sim.addPlayer('warrior', 'NyxTank') as number;
      sim.setPlayerLevel(MAX_LEVEL, tankPid);
      (sim.players.get(tankPid) as any).questsDone.add('q_nythraxis_bound_guardian'); // attune
      const dpsPids: number[] = [];
      for (let i = 0; i < 4; i++) {
        const pid = sim.addPlayer('mage', `NyxDps${i}`) as number;
        sim.setPlayerLevel(MAX_LEVEL, pid);
        sim.partyInvite(pid, tankPid);
        sim.partyAccept(pid);
        dpsPids.push(pid);
      }
      sim.convertPartyToRaid(tankPid); // raid requires five
      sim.enterDungeon('nythraxis_boss_arena', tankPid);
      const tank = sim.entities.get(tankPid) as AnyEntity;
      const boss = [...sim.entities.values()].find(
        (e: AnyEntity) => e.kind === 'mob' && e.templateId === NYTHRAXIS_BOSS_ID && !e.dead,
      ) as AnyEntity;
      rec.track(boss.id);
      rec.notes.bossId = boss.id;

      // Place an entity at (x,z) on the instance FLOOR (y). The parity `teleport`
      // helper snaps y to the overworld terrainHeight, which floats players above the
      // arena floor (y=0) so they take lethal Falling damage; pin y to the local floor.
      const floorTeleport = (e: AnyEntity, x: number, z: number, y: number) => {
        teleport(sim, e, x, z);
        e.pos.y = y;
        e.prevPos = { ...e.pos };
        e.fallStartY = y;
        e.vy = 0;
        e.onGround = true;
        sim.rebucket(e);
      };

      // Tank in melee in front of the throne; four mages stacked tightly behind him
      // (within Soul Rend's 5yd stack range so a triple mark splits the damage three
      // ways and nobody is one-shot).
      floorTeleport(tank, boss.pos.x, boss.pos.z - 6, boss.pos.y);
      const dps = dpsPids.map((pid) => sim.entities.get(pid) as AnyEntity);
      dps.forEach((e, i) => {
        floorTeleport(e, boss.spawnPos.x + (i - 1.5), boss.spawnPos.z - 20, boss.pos.y);
      });
      const room = [tank, ...dps];
      const topUp = () => {
        for (const e of room) {
          e.hp = e.maxHp;
          e.dead = false;
        }
      };
      // Tick n times, restoring every room player to full after each tick so the
      // room is never empty at the next updateNythraxisEncounter wipe check.
      const step = (n: number) => {
        for (let i = 0; i < n; i++) {
          rec.tick(1);
          topUp();
        }
      };

      // engage: lock the boss onto the tank (mirrors the raid-test engage helper).
      boss.inCombat = true;
      boss.aiState = 'attack';
      boss.aggroTargetId = tank.id;
      boss.threat.set(tank.id, 1000);
      step(1); // init the encounter (intro yells)
      rec.snapshot('engage');

      // ----- Phase 1: Gravebreaker (rng.range) + a forced Raise Fallen add wave -----
      step(20 * 2); // ~2s: gravebreakerTimer (1.5) elapses -> rng.range draw + front cone
      (boss.nythraxis as any).raiseFallenTimer = DT; // fire the add wave next tick
      step(1);
      const adds = [...sim.entities.values()].filter(
        (e: AnyEntity) => e.kind === 'mob' && e.templateId === NYTHRAXIS_ADD_ID && !e.dead,
      ) as AnyEntity[];
      rec.track(...adds.map((a) => a.id));
      rec.notes.addIds = adds.map((a) => a.id);
      rec.snapshot('phase1-adds');

      // ----- Transition at 70%: room War Stomp stun + Aldric + wardstones lit -----
      boss.hp = Math.floor(boss.maxHp * 0.69);
      step(1);
      const aldric = [...sim.entities.values()].find(
        (e: AnyEntity) => e.templateId === 'brother_aldric_raid' && !e.dead,
      ) as AnyEntity | undefined;
      if (aldric) rec.track(aldric.id);
      const wards = (
        [...sim.entities.values()].filter(
          (e: AnyEntity) =>
            e.kind === 'object' &&
            e.objectItemId === 'bastion_ward_stone' &&
            dist2d(e.pos, boss.spawnPos) < 100,
        ) as AnyEntity[]
      ).sort((a, b) => a.id - b.id);
      rec.track(...wards.map((w) => w.id));
      rec.notes.wardIds = wards.map((w) => w.id);
      rec.snapshot('transition');

      // Shorten the transition timer so phase two opens without 21s of ticks, then
      // run updateNythraxisTransition (Aldric walk-in + timer) to completion.
      (boss.nythraxis as any).transitionTimer = 1;
      step(20 * 8); // transition (1s) + settle (5s) + margin -> phase 2, soul-rend timer live
      // Freeze the auto cadence so the explicit Soul Rend / Deathless Rage triggers
      // below fire in a controlled order (no stray auto-cast mid-resolve).
      (boss.nythraxis as any).soulRendTimer = 999;
      (boss.nythraxis as any).deathlessTimer = 999;
      rec.snapshot('phase2');

      // ----- Soul Rend: the rng.int marks pick -----
      (boss.nythraxis as any).soulRendTimer = DT;
      step(1); // castNythraxisSoulRend -> rng.int pick + Soul Rend marks
      rec.snapshot('soulrend');
      step(20 * 9); // marks expire (8s duration) -> dealDamage split across the stack

      // The phase-1 adds are spent by now (a real raid kills them before the
      // wardstone phase); clear them so their on-hit stun cannot break a channel.
      for (const add of adds)
        sim.dealDamage(tank, add, add.hp + 1, false, 'physical', null, 'hit', true);
      step(1);

      // ----- Deathless Rage + the three-wardstone interrupt -----
      (boss.nythraxis as any).soulRendLockout = 0;
      (boss.nythraxis as any).soulRendMarks = [];
      (boss.nythraxis as any).deathlessTimer = DT;
      step(1); // startNythraxisDeathlessRage -> ward channels armed (10s cast)
      rec.snapshot('deathless-start');
      // Three distinct players each channel a distinct wardstone via the object click.
      wards.forEach((ward, i) => {
        const channeler = dps[i];
        floorTeleport(channeler, ward.pos.x, ward.pos.z, ward.pos.y);
        sim.pickUpObject(ward.id, channeler.id);
      });
      step(20 * 6); // channels complete (5s) -> interrupt + nythraxis_deathless_stun
      rec.snapshot('deathless-interrupt');
      step(20 * 6); // the 5s self-stun expires

      // ----- Final Stand at 5% -----
      boss.hp = Math.floor(boss.maxHp * 0.04);
      step(1); // finalStand -> enrage + Final Stand haste aura
      rec.snapshot('finalstand');

      // ----- Kill: grantNythraxisLockout + onBossDeath death dialogue -----
      // Clear the dialogue lock so the (non-critical) death line is not suppressed by
      // the still-active Final Stand callout.
      (boss.nythraxis as any).dialogueBusyUntil = 0;
      sim.dealDamage(tank, boss, boss.hp, false, 'physical', null, 'hit', true);
      step(1); // updateMob dead-branch -> onBossDeath schedules the death dialogue
      rec.snapshot('death');
      step(20 * 3); // drain the delayed death-dialogue yells
    },
  };
}

// C3 aura/regen runner: the per-tick aura/regen/timer slice that moves to
// src/sim/combat/auras.ts. Three phases pin the pieces other scenarios miss:
//  A. DoT-kills-mid-tick guard: a victim mob carries a buff at index 0 and a lethal
//     dot at index 1. updateAuras walks auras BACKWARD, so the dot ticks first; its
//     dealDamage drops the victim to dead and the `if (e.dead) return;` guard (~3095)
//     short-circuits BEFORE the index-0 aura is reached (handleDeath has already cleared
//     the corpse's auras, so without the guard the loop would walk a mutated list).
//     Reordering or dropping the guard forks the draw order / trace.
//  B. updateRegen eat/drink (the ctx.healingTakenMult seam call + the 'heal' emit) and
//     mana/hp regen, plus a short buff_ap that expires inside updateAuras -> statsDirty
//     -> recalcPlayerStats (player branch) + applyNonPlayerStatAura on expiry.
//  C. A ground AoE pulsing over 2+ hostiles so pulseGroundAoE iterates hostilesInRadius
//     and draws rng.range once per in-radius target in stable order (paladin_consecration
//     only ever has one mob in radius).
function c3AuraRunner(): Scenario {
  return {
    name: 'c3_aura_runner',
    coverage: [
      'updateAuras dot-tick kills target mid-walk -> e.dead guard short-circuits (~3095)',
      'updateAuras aura-expiry statsDirty -> recalcPlayerStats + applyNonPlayerStatAura',
      "updateRegen eat/drink path (ctx.healingTakenMult + 'heal' emit) + out-of-combat regen",
      'pulseGroundAoE over 2+ in-radius hostiles: rng.range per target, stable order',
      'class:paladin',
    ],
    sampleEvery: 5,
    build: () => new Sim({ seed: 1017, playerClass: 'paladin', autoEquip: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      sim.setPlayerLevel(20); // consecration learnLevel 18
      const p = sim.player as AnyEntity;
      beef(p);

      // ----- Phase A: a DoT kills the victim mid-updateAuras (the e.dead guard) -----
      // The buff at index 0 + the lethal dot at index 1: the backward walk ticks the dot
      // first, its dealDamage kills the victim, and the guard returns before index 0 is
      // touched (the rider buff survives intact on the corpse). The dot is sourceless
      // (caster id absent) so the death cascade stays minimal and attributable.
      const ABSENT_SOURCE = 999999;
      const victim = spawnMob(sim, 'forest_wolf', 5, 40, p.pos.y, 40);
      victim.hostile = true;
      victim.auras.push(
        aura({
          id: 'rider_buff',
          name: 'Rider',
          kind: 'buff_armor',
          value: 10,
          sourceId: ABSENT_SOURCE,
        }),
      );
      victim.auras.push(
        aura({
          id: 'lethal_dot',
          name: 'Rupture',
          kind: 'dot',
          value: 9999,
          sourceId: ABSENT_SOURCE,
          tickInterval: 0.05,
        }),
      );
      rec.track(victim.id);
      rec.notes.victimId = victim.id;
      rec.tick(2); // tick 1: dot ticks -> lethal -> guard fires; the index-0 buff survives
      rec.snapshot('dot-guard');

      // ----- Phase B: updateRegen eat/drink + an aura-expiry statsDirty recalc -----
      // Out of combat with hp/mana to recover, sitting to eat + drink. updateRegen fires
      // every 40 ticks (the 2s classic tick): the food heal runs ctx.healingTakenMult +
      // the 'heal' emit, the drink restores mana, and the short buff_ap expires inside
      // updateAuras -> statsDirty -> recalcPlayerStats (+ applyNonPlayerStatAura).
      p.inCombat = false;
      p.combatTimer = 99;
      p.fiveSecondRule = 99;
      p.hp = Math.max(1, p.maxHp - 600);
      p.resource = Math.max(0, p.maxResource - 300);
      p.eating = { itemId: 'parity_food', kind: 'food', hpPer2s: 90, manaPer2s: 0, remaining: 6 };
      p.drinking = {
        itemId: 'parity_drink',
        kind: 'drink',
        hpPer2s: 0,
        manaPer2s: 50,
        remaining: 6,
      };
      p.auras.push(
        aura({
          id: 'short_buff',
          name: 'Blessing',
          kind: 'buff_ap',
          value: 20,
          sourceId: p.id,
          duration: 1.5,
        }),
      );
      rec.tick(60); // >40: updateRegen fires (tick 40); buff_ap expires -> statsDirty recalc
      rec.snapshot('regen-expiry');

      // ----- Phase C: a ground AoE pulsing over 2+ hostiles -----
      // Two beefed mobs clustered inside consecration's 8yd radius so pulseGroundAoE
      // iterates hostilesInRadius (>=2 targets), drawing rng.range once per target in
      // entities-insertion order, from BOTH callers (the on-cast pulse + deferred ticks).
      const a1 = spawnMob(sim, 'forest_wolf', 5, p.pos.x + 2, p.pos.y, p.pos.z + 2);
      const a2 = spawnMob(sim, 'forest_wolf', 5, p.pos.x - 2, p.pos.y, p.pos.z - 2);
      for (const m of [a1, a2]) {
        beef(m, 40000);
        m.hostile = true;
      }
      rec.track(a1.id, a2.id);
      rec.notes.aoeMobIds = [a1.id, a2.id];
      p.resource = p.maxResource;
      p.gcdRemaining = 0;
      sim.castAbility('consecration'); // immediate on-cast pulse + deferred interval pulses
      rec.tick(20 * 6); // 6s of interval-2 deferred pulses over both mobs
    },
  };
}

// C4a casting lifecycle: drives the player cast lifecycle end to end across three
// caster classes plus a fishing cast, so the cast-start / updateCasting-progress /
// pushback / cancel / channel-tick / finish branches and their rng draws are all
// pinned in one trace. Forks no behavior off castAbility -> updateCasting; every
// interrupt rides the real dealDamage spell-pushback block (cancel vs pushback).
//  - mage fireball: timed-cast START (gcd arm) -> a mid-cast melee hit takes the
//    pushbackCast timed branch (+CAST_PUSHBACK_SEC) -> the cast FINISHES ->
//    applyAbility spell-hit roll (rng.chance(spellHitChance)) -> runEffects.
//  - priest lesser_heal (self): timed-cast START -> a silence aura lands ->
//    updateCasting's silence branch CANCELS it (cancelCast, castStop success:false).
//  - warlock drain_life: channel START (spend+arm at START) -> applyChannelTick
//    fires (drainTick rng.range draw + dealDamage + self-heal + healingThreat) ->
//    a mid-channel hit takes the pushbackCast channel-fraction branch.
//  - warlock fishing cast: a non-lethal hit CANCELS it (the FISHING_CAST_ID arm of
//    dealDamage's spell-pushback block -> cancelCast, not pushback).
function c4aCastingLifecycle(): Scenario {
  return {
    name: 'c4a_casting_lifecycle',
    coverage: [
      'castAbility timed-cast START (mage fireball) + Math.max gcd arm',
      'updateCasting progress + finish -> applyAbility spell-hit roll (rng) -> runEffects',
      'single-slot spell queue (#1360): tail-window press queues, fires on completion',
      'pushbackCast timed branch (+CAST_PUSHBACK_SEC) via dealDamage mid-cast',
      'updateCasting silence branch -> cancelCast (priest lesser_heal, holy)',
      'castAbility channel START (warlock drain_life): spend+arm at START',
      'applyChannelTick drainTick (rng.range draw + dealDamage + self-heal + healingThreat)',
      'pushbackCast channel-fraction branch via dealDamage mid-channel',
      'cancelCast fishing arm via dealDamage (FISHING_CAST_ID, not pushback)',
      'multi-class casters: mage/priest/warlock',
    ],
    sampleEvery: 5,
    build: () => new Sim({ seed: 1017, playerClass: 'mage', noPlayer: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      const mage = sim.addPlayer('mage', 'Mg') as number;
      const priest = sim.addPlayer('priest', 'Pr') as number;
      const warlock = sim.addPlayer('warlock', 'Wl') as number;
      const eMage = sim.entities.get(mage) as AnyEntity;
      const ePriest = sim.entities.get(priest) as AnyEntity;
      const eWarlock = sim.entities.get(warlock) as AnyEntity;
      // Level 12: fireball rank 3 (3.0s), lesser_heal rank 3 (2.0s, holy),
      // drain_life rank 1 (5s channel / 5 ticks = 1s per tick). drain_life needs >=10.
      for (const pid of [mage, priest, warlock]) sim.setPlayerLevel(12, pid);
      teleport(sim, eMage, -3, -45);
      teleport(sim, ePriest, 0, -45);
      teleport(sim, eWarlock, 3, -45);
      for (const e of [eMage, ePriest, eWarlock]) beef(e, 20000);

      // An idle (un-aggroed) hostile dummy the casters target; hostile=true so
      // isHostileTo passes, aiState idle so it does not retaliate mid-cast.
      const mob = spawnMob(sim, 'forest_wolf', 8, 0, eMage.pos.y, -40);
      beef(mob, 200000);
      mob.hostile = true;
      mob.aiState = 'idle';
      rec.track(mob.id);
      rec.notes.mageId = mage;
      rec.notes.priestId = priest;
      rec.notes.warlockId = warlock;
      rec.notes.mobId = mob.id;

      // --- mage: timed-cast start -> mid-cast pushback -> finish -> applyAbility ---
      eMage.resource = eMage.maxResource;
      face(eMage, mob);
      sim.targetEntity(mob.id, mage);
      sim.castAbility('fireball', mage); // timed-cast START (castStart)
      rec.tick(1); // updateCasting progress one tick
      sim.dealDamage(mob, eMage, 40, false, 'physical', null, 'hit'); // pushbackCast timed branch
      rec.snapshot('mage-pushback');
      rec.tick(120); // let the 2.5s cast (+ pushback) finish -> applyAbility -> runEffects

      // --- mage: spell queue (#1360): a press in the cast tail queues, fires on completion ---
      eMage.resource = eMage.maxResource;
      face(eMage, mob);
      sim.castAbility('fireball', mage); // second timed-cast START (fresh cast, no pushback)
      // drain to inside the queue window: tick one at a time (cast time varies by rank/level,
      // so a hardcoded tick count would silently drift outside the window) until castRemaining
      // is within CAST_QUEUE_WINDOW_SEC but the cast has not yet completed.
      while (eMage.castRemaining > CAST_QUEUE_WINDOW_SEC) rec.tick(1);
      if (!(eMage.castingAbility && eMage.castRemaining > 0)) {
        throw new Error(
          'c4a_casting_lifecycle: fireball cast completed before entering the queue window',
        );
      }
      sim.castAbility('fireball', mage); // queues instead of erroring "You are busy."
      if (eMage.queuedCastAbility !== 'fireball') {
        throw new Error('c4a_casting_lifecycle: press inside the queue window did not queue');
      }
      rec.snapshot('mage-queued');
      rec.tick(20); // finishes the in-flight cast (fires the queued one) and lets it progress

      // --- priest: timed self-heal start -> silence lands -> updateCasting cancel ---
      ePriest.hp = Math.max(1, ePriest.maxHp - 1000);
      ePriest.resource = ePriest.maxResource;
      sim.castAbility('lesser_heal', priest); // self (friendly fallback), timed START
      rec.tick(1); // progress one tick (no interrupt yet)
      ePriest.auras.push(
        aura({
          id: 'c4a_silence',
          name: 'Silenced',
          kind: 'silence',
          value: 0,
          sourceId: mob.id,
          duration: 4,
        }),
      );
      rec.tick(1); // updateCasting silence branch -> cancelCast (castStop success:false)
      rec.snapshot('priest-silence-cancel');

      // --- warlock: channel start -> channel tick -> channel-fraction pushback ---
      eWarlock.hp = Math.max(1, eWarlock.maxHp - 500); // so the drain self-heal lands
      eWarlock.resource = eWarlock.maxResource;
      face(eWarlock, mob);
      sim.targetEntity(mob.id, warlock);
      sim.castAbility('drain_life', warlock); // channel START (spend+arm at START)
      rec.tick(22); // first channel tick fires at ~1s (20 ticks): applyChannelTick draws rng
      sim.dealDamage(mob, eWarlock, 40, false, 'physical', null, 'hit'); // pushbackCast channel branch
      rec.snapshot('warlock-channel-pushback');
      rec.tick(8);

      // --- warlock: a fishing cast cancelled by a hit (cancelCast fishing arm) ---
      eWarlock.castingAbility = FISHING_CAST_ID;
      eWarlock.castRemaining = 5;
      eWarlock.castTotal = 5;
      eWarlock.channeling = false;
      sim.dealDamage(mob, eWarlock, 20, false, 'physical', null, 'hit'); // cancelCast, not pushback
      rec.snapshot('warlock-fishing-cancel');
      rec.tick(5);
    },
  };
}

// M4 mob death-lifecycle: the five execution bodies (frenzyPackmates,
// armDeathThroes, detonateCorpse, respawnMob, despawnSummonedAdds) driven through
// their stable entry points so the move is checked against a committed golden:
// frenzy + arm fire from handleDeath (via dealDamage); detonate + respawn fire
// from the updateMob corpse-tick. Pins the two rng draws this slice carries:
// detonateCorpse's rng.range(min,max) per in-radius player and respawnMob's
// rng.range(2,8) wanderTimer. Drives like mobLocomotion (direct updateMob +
// snapshot, no full tick) so each path fires in isolation.
function mobLifecycle(): Scenario {
  return {
    name: 'mob_lifecycle',
    coverage: [
      'death -> frenzyPackmates: a packFrenzy mob death gives same-template hostile neighbors the Pack Frenzy buff_haste aura (different-template boar unaffected; no rng)',
      'death -> armDeathThroes: a deathThroes mob arms its detonateTimer fuse + swell telegraph (no rng)',
      'corpse-tick -> detonateCorpse: fuse reaches 0, rng.range(dt.min,dt.max) per in-radius living player + dealDamage burst, fires once',
      'corpse-tick -> respawnMob: a slain wild mob respawns at spawnPos (rng.range(2,8) wanderTimer) and despawnSummonedAdds drops its summoned add',
      'corpse-tick gate: a dungeon mob (spawnPos.x > DUNGEON_X_THRESHOLD) stays dead, no respawn',
    ],
    sampleEvery: 1,
    build: () => new Sim({ seed: 1015, playerClass: 'warrior', noPlayer: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      const pid = sim.addPlayer('warrior', 'Anvil');
      const player = sim.entities.get(pid) as AnyEntity;
      rec.track(pid);
      rec.notes.pid = pid;
      const revive = () => {
        player.hp = 1_000_000;
      };

      // 1) Pack frenzy: kill one forest_wolf amid a same-template pack. Survivors
      // within packFrenzy.radius (12) gain the Pack Frenzy haste aura; a
      // different-template boar in range stays unaffected (frenzyPackmates draws no rng).
      const wolfA = spawnMob(
        sim,
        'forest_wolf',
        5,
        player.pos.x + 3,
        player.pos.y,
        player.pos.z + 3,
      );
      const wolfB = spawnMob(
        sim,
        'forest_wolf',
        5,
        player.pos.x + 5,
        player.pos.y,
        player.pos.z + 3,
      );
      const wolfC = spawnMob(
        sim,
        'forest_wolf',
        5,
        player.pos.x + 7,
        player.pos.y,
        player.pos.z + 3,
      );
      const boar = spawnMob(sim, 'wild_boar', 5, player.pos.x + 4, player.pos.y, player.pos.z + 4);
      rec.track(wolfA.id, wolfB.id, wolfC.id, boar.id);
      lethal(sim, player, wolfA); // handleDeath -> frenzyPackmates(wolfA)
      rec.notes.wolfBFrenzied = wolfB.auras.some((a: any) => a.id === 'pack_frenzy');
      rec.notes.wolfCFrenzied = wolfC.auras.some((a: any) => a.id === 'pack_frenzy');
      rec.notes.boarFrenzied = boar.auras.some((a: any) => a.id === 'pack_frenzy');
      rec.snapshot('pack-frenzy');

      // 2) Death Throes arm: kill a bog_bloat with the player in blast radius (8).
      // The corpse arms a detonateTimer fuse (delay 1.5s) + the swell telegraph.
      const bog = spawnMob(sim, 'bog_bloat', 10, player.pos.x + 2, player.pos.y, player.pos.z + 2);
      rec.track(bog.id);
      lethal(sim, player, bog); // handleDeath -> armDeathThroes(bog): detonateTimer = 1.5
      rec.notes.bogArmed = bog.detonateTimer;
      rec.snapshot('throes-arm');

      // 3) Death Throes detonate: count the fuse down via the corpse tick. On the
      // tick the fuse reaches 0 the corpse bursts for rng.range(min,max) to the
      // in-radius player (one draw), then sets detonateTimer = Infinity (fires once).
      revive();
      for (let i = 0; i < 31; i++) (sim as any).updateMob(bog);
      rec.notes.bogDetonated = bog.detonateTimer === Infinity;
      rec.notes.playerHpAfterBurst = player.hp;
      rec.snapshot('throes-detonate');

      // 4) Respawn: a slain WILD mob whose corpse/respawn timers have elapsed
      // respawns at spawnPos (rng.range(2,8) wanderTimer) and despawnSummonedAdds
      // drops the add it summoned this pull.
      const wild = spawnMob(sim, 'forest_wolf', 5, 300, terrainHeight(300, 300, sim.cfg.seed), 300);
      wild.spawnPos = { x: 300, y: wild.pos.y, z: 300 };
      const add = spawnMob(sim, 'wild_boar', 5, 302, terrainHeight(302, 300, sim.cfg.seed), 300);
      rec.track(wild.id, add.id);
      lethal(sim, player, wild);
      wild.summonedIds = [add.id];
      wild.corpseTimer = 0;
      wild.respawnTimer = 0;
      wild.lootable = false;
      (sim as any).updateMob(wild); // corpse-tick gate -> respawnMob + despawnSummonedAdds(add)
      rec.notes.wildRespawned = !wild.dead;
      rec.notes.wildState = wild.aiState;
      rec.notes.wildAtSpawn = wild.pos.x === 300 && wild.pos.z === 300;
      rec.notes.addDespawned = !sim.entities.has(add.id);
      rec.snapshot('respawn');

      // 5) Dungeon mob stays dead: spawnPos past DUNGEON_X_THRESHOLD (600) -> the
      // corpse-tick respawn gate is skipped, the mob never respawns into the wild.
      const dungeonMob = spawnMob(
        sim,
        'forest_wolf',
        5,
        700,
        terrainHeight(700, 300, sim.cfg.seed),
        300,
      );
      dungeonMob.spawnPos = { x: 700, y: dungeonMob.pos.y, z: 300 };
      rec.track(dungeonMob.id);
      lethal(sim, player, dungeonMob);
      dungeonMob.corpseTimer = 0;
      dungeonMob.respawnTimer = 0;
      dungeonMob.lootable = false;
      (sim as any).updateMob(dungeonMob);
      rec.notes.dungeonStaysDead = dungeonMob.dead;
      rec.snapshot('dungeon-stays-dead');
    },
  };
}

// Player target selection (tab / nearest / friendly cycle) + the party-scoped raid
// marker store (set/toggle/symbol-uniqueness + death-strip). T1 extracts both into
// src/sim/targeting.ts; the slice draws no rng of its own, so this pins (a) the
// targetId/autoAttack the selectors write onto the player entity, and (b) that the
// surrounding draws (the lethal blow's rollLoot) stay byte-identical across the move.
function targetingMarkers(): Scenario {
  // Raid-marker symbols are integer ids 0..7 (skull / star here).
  const SKULL = 0;
  const STAR = 1;
  return {
    name: 'targeting_markers',
    coverage: [
      'tabTarget cycle over visible enemies via orderTabTargets + grid order (~9690)',
      'targetNearestEnemy / enemyCandidates grid scan, engaged vs idle (~9724/9740)',
      'targetNearestFriendly + friendlyTabTarget wrap, autoAttack never armed (~9782/9797)',
      'setMarker set/toggle-off/symbol-uniqueness + clearEntityMarker death-strip (~11956/12002)',
    ],
    build: () => new Sim({ seed: 7177, playerClass: 'warrior', noPlayer: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      const a = sim.addPlayer('warrior', 'Aaa');
      const b = sim.addPlayer('priest', 'Bbb');
      const c = sim.addPlayer('mage', 'Ccc');
      rec.notes.aPid = a;
      rec.notes.m2Id = -1; // filled once the mobs spawn (the SKULL-marked, killed mob)
      rec.notes.m3Id = -1; // a live STAR-marked mob whose mark must survive the kill
      const ae = sim.entities.get(a) as AnyEntity;
      const be = sim.entities.get(b) as AnyEntity;
      const ce = sim.entities.get(c) as AnyEntity;
      // cluster the trio so the friendly grid scan (radius 40) finds the allies.
      teleport(sim, ae, 0, 0);
      teleport(sim, be, 2, 0);
      teleport(sim, ce, -2, 0);
      ae.facing = 0; // face +Z so the tab cone has a stable orientation
      // hostile wild mobs at varied distance/angle: one engaged (aggro'd onto the
      // player), two idle, all inside TAB_QUERY_RADIUS.
      const m1 = spawnMob(sim, 'forest_wolf', 3, 4, 0, 4);
      const m2 = spawnMob(sim, 'forest_wolf', 3, -3, 0, 6);
      const m3 = spawnMob(sim, 'forest_wolf', 3, 0, 0, 10);
      beef(m1);
      beef(m3);
      rec.notes.m2Id = m2.id;
      rec.notes.m3Id = m3.id;
      rec.track(a, b, c, m1.id, m2.id, m3.id);
      aggroOnto(m1, ae); // m1 is "engaged" -> exercises the near-cluster branch

      // 1) cycle the visible enemies, then snap to the nearest.
      sim.tabTarget(a);
      rec.snapshot('tab-1');
      sim.tabTarget(a);
      rec.snapshot('tab-2');
      sim.tabTarget(a);
      rec.snapshot('tab-3');
      sim.targetNearestEnemy(a);
      rec.snapshot('nearest-enemy');

      // 2) form a party, then cycle friendlies (auto-attack must never arm).
      sim.partyInvite(b, a);
      sim.partyAccept(b);
      sim.partyInvite(c, a);
      sim.partyAccept(c);
      sim.targetNearestFriendly(a);
      rec.snapshot('nearest-friendly');
      sim.friendlyTabTarget(a);
      rec.snapshot('friendly-tab-1');
      sim.friendlyTabTarget(a);
      rec.snapshot('friendly-tab-2');

      // 3) markers: set, toggle off, set again, then move the symbol to another mob.
      sim.setMarker(m1.id, SKULL, a);
      rec.snapshot('mark-set');
      sim.setMarker(m1.id, SKULL, a); // same symbol same mob -> toggle off
      rec.snapshot('mark-toggle-off');
      sim.setMarker(m1.id, SKULL, a);
      sim.setMarker(m3.id, STAR, a); // a second, distinct symbol
      sim.setMarker(m2.id, SKULL, a); // uniqueness: SKULL leaves m1, lands on m2
      rec.notes.markedBeforeKill = { ...sim.markersFor(a) };
      rec.snapshot('mark-moved');

      // 4) kill the SKULL-marked mob -> clearEntityMarker strips it everywhere.
      lethal(sim, ae, m2);
      rec.snapshot('m2-dead');
    },
  };
}

// C4b effect dispatch: a multi-class drive that fans runEffects across its most
// draw-order-sensitive cases in ONE golden so the move (runEffects -> combat/
// effect_dispatch.ts) is pinned. The highest-risk reorder points the brief calls
// out are each fired at least once, in effect-array order:
//  - warrior sunder_armor: the sunder MISS roll (rng.chance(meleeMissChance)).
//  - mage arcane_explosion: aoeDamage per-target rng.range over 2 in-radius mobs.
//  - rogue sinister_strike -> eviscerate -> kidney_shot: weaponStrike awardCombo
//    latch, finisherDamage range-THEN-chance, and the combo-spend reset after the loop.
//  - paladin seal_of_righteousness -> judgement -> consecration: imbue Seal, the
//    judgement range-THEN-chance draw (consuming the Seal), and the groundAoE on-cast
//    pulse (pulseGroundAoE + groundAoEs.push).
//  - druid moonfire -> bear_form -> cat_form -> rejuvenation: directDamage range-then-
//    chance + a dot in ONE cast, exclusive selfBuff form switch (recalc), and a hot.
//  - warlock fear -> summon_imp: incapacitate fear-angle draw rng.range(-PI,PI) and the
//    summonDemon -> ctx.summonPet path. Run FIRST (clean cast environment) so the timed
//    casts are not pushed back by another caster's ground-AoE.
function c4bEffectDispatch(): Scenario {
  return {
    name: 'c4b_effect_dispatch',
    coverage: [
      'runEffects multi-class multi-effect dispatch',
      'directDamage/finisherDamage range-then-chance (druid moonfire, rogue eviscerate)',
      'judgement range-then-chance (paladin seal -> judgement)',
      'incapacitate fear-angle draw rng.range(-PI,PI) (warlock fear)',
      'aoeDamage per-target rng.range (mage arcane_explosion, 2 mobs)',
      'sunder miss rng.chance (warrior sunder_armor)',
      'groundAoE on-cast pulse (paladin consecration)',
      'summonDemon -> summonPet (warlock summon_imp) + selfBuff form switch (druid)',
      'weaponStrike awardCombo latch + finisher combo-spend reset',
    ],
    sampleEvery: 5,
    build: () => new Sim({ seed: 1018, playerClass: 'warrior', noPlayer: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      const warrior = sim.addPlayer('warrior', 'Wr') as number;
      const mage = sim.addPlayer('mage', 'Mg') as number;
      const rogue = sim.addPlayer('rogue', 'Rg') as number;
      const paladin = sim.addPlayer('paladin', 'Pl') as number;
      const druid = sim.addPlayer('druid', 'Dr') as number;
      const warlock = sim.addPlayer('warlock', 'Wl') as number;
      const eWarrior = sim.entities.get(warrior) as AnyEntity;
      const eMage = sim.entities.get(mage) as AnyEntity;
      const eRogue = sim.entities.get(rogue) as AnyEntity;
      const ePaladin = sim.entities.get(paladin) as AnyEntity;
      const eDruid = sim.entities.get(druid) as AnyEntity;
      const eWarlock = sim.entities.get(warlock) as AnyEntity;
      const cells: Array<[number, AnyEntity]> = [
        [-42, eWarrior],
        [-28, eMage],
        [-14, eRogue],
        [0, ePaladin],
        [14, eDruid],
        [42, eWarlock],
      ];
      for (const pid of [warrior, mage, rogue, paladin, druid, warlock])
        sim.setPlayerLevel(20, pid);
      for (const [x, e] of cells) {
        teleport(sim, e, x, -45);
        beef(e, 50000);
      }
      rec.notes.warriorId = warrior;
      rec.notes.mageId = mage;
      rec.notes.rogueId = rogue;
      rec.notes.paladinId = paladin;
      rec.notes.druidId = druid;
      rec.notes.warlockId = warlock;

      // Spawn an idle hostile dummy adjacent to a caster (north, within melee).
      const dummy = (owner: AnyEntity, level = 8): AnyEntity => {
        const m = spawnMob(sim, 'forest_wolf', level, owner.pos.x, owner.pos.y, owner.pos.z + 3);
        beef(m, 500000);
        m.hostile = true;
        m.aiState = 'idle';
        rec.track(m.id);
        return m;
      };
      const ready = (e: AnyEntity): void => {
        e.gcdRemaining = 0;
        e.resource = e.maxResource;
      };

      // --- warlock FIRST (timed casts in a clean environment) ---
      const mobL = dummy(eWarlock);
      rec.notes.warlockMobId = mobL.id;
      face(eWarlock, mobL);
      sim.targetEntity(mobL.id, warlock);
      ready(eWarlock);
      sim.castAbility('fear', warlock); // 1.5s cast -> incapacitate fear-angle rng.range(-PI,PI)
      rec.tick(32); // finish fear
      rec.snapshot('warlock-fear');
      ready(eWarlock);
      sim.castAbility('summon_imp', warlock); // 5s cast -> summonDemon -> ctx.summonPet
      rec.tick(101); // finish summon
      rec.snapshot('warlock-summon');

      // --- warrior: sunder_armor (sunder miss rng.chance + threat) ---
      const mobW = dummy(eWarrior);
      face(eWarrior, mobW);
      sim.targetEntity(mobW.id, warrior);
      ready(eWarrior);
      sim.castAbility('sunder_armor', warrior);
      rec.snapshot('warrior-sunder');

      // --- mage: arcane_explosion (aoeDamage per-target rng.range over 2 mobs) ---
      const mobM1 = spawnMob(sim, 'forest_wolf', 8, eMage.pos.x + 2, eMage.pos.y, eMage.pos.z + 1);
      const mobM2 = spawnMob(sim, 'forest_wolf', 8, eMage.pos.x - 2, eMage.pos.y, eMage.pos.z + 2);
      for (const m of [mobM1, mobM2]) {
        beef(m, 500000);
        m.hostile = true;
        m.aiState = 'idle';
        rec.track(m.id);
      }
      rec.notes.aoeMobIds = [mobM1.id, mobM2.id];
      ready(eMage);
      sim.castAbility('arcane_explosion', mage);
      rec.snapshot('mage-arcane-explosion');

      // --- rogue: sinister_strike (weaponStrike awardCombo) then finishers ---
      const mobR = dummy(eRogue);
      face(eRogue, mobR);
      sim.targetEntity(mobR.id, rogue);
      ready(eRogue);
      sim.castAbility('sinister_strike', rogue); // weaponStrike -> meleeSwing + awardCombo latch
      ready(eRogue);
      eRogue.comboPoints = 3;
      eRogue.comboUntil = sim.time + 30; // character-bound pool, kept alive through ready()
      sim.castAbility('eviscerate', rogue); // finisherDamage range-then-chance + combo reset
      ready(eRogue);
      eRogue.comboPoints = 2;
      eRogue.comboUntil = sim.time + 30;
      sim.castAbility('kidney_shot', rogue); // finisherStun + combo-spend reset
      rec.snapshot('rogue-combo-finishers');

      // --- paladin: seal -> judgement (range-then-chance) -> consecration (groundAoE) ---
      const mobP = dummy(ePaladin);
      face(ePaladin, mobP);
      sim.targetEntity(mobP.id, paladin);
      ready(ePaladin);
      sim.castAbility('seal_of_righteousness', paladin); // imbue (sets the Seal)
      ready(ePaladin);
      sim.castAbility('judgement', paladin); // judgement: rng.range then rng.chance
      ready(ePaladin);
      sim.castAbility('consecration', paladin); // groundAoE: on-cast pulse + groundAoEs.push
      rec.snapshot('paladin-judge-consecrate');

      // --- druid: moonfire (directDamage range-then-chance + dot) -> forms -> hot ---
      const mobD = dummy(eDruid);
      face(eDruid, mobD);
      sim.targetEntity(mobD.id, druid);
      ready(eDruid);
      sim.castAbility('moonfire', druid); // directDamage (range then chance) + dot
      ready(eDruid);
      sim.castAbility('bear_form', druid); // selfBuff form + recalc
      ready(eDruid);
      sim.castAbility('cat_form', druid); // form switch (exclusive: strips bear)
      ready(eDruid);
      eDruid.hp = Math.max(1, eDruid.maxHp - 1000);
      sim.targetEntity(druid, druid); // self-target the friendly hot
      sim.castAbility('rejuvenation', druid); // hot
      rec.snapshot('druid-moonfire-forms');
    },
  };
}

// Player auto-attack + the melee/ranged white-hit table (C5). Drives the
// updatePlayerAutoAttack tick driver across several swing intervals for five
// builds at once: a warrior meleeing a spiked-hide boar (thorns reflect tail) with
// Heroic Strike queued (queuedOnSwing spend + bonus, cooldown 0), a rogue plain
// melee, a hunter in melee with Raptor Strike queued (queuedOnSwing + on-next-swing
// cooldown set, cd 6), a hunter at range firing Auto Shot (physical, armor-mitigated,
// 8yd dead zone), and a mage wanding (arcane, no armor, no dead zone). Targets are
// re-pinned to their lane each round so the ranged dead-zone vs wand branches stay
// exercised, and the rogue's auto-attack is stopped at the end (stopAutoAttack entry).
function c5AutoAttack(): Scenario {
  return {
    name: 'c5_auto_attack',
    coverage: [
      'player auto-attack driver updatePlayerAutoAttack (swingTimer cadence, facing/range gates)',
      'meleeSwing white-hit table: single rng.next() miss/dodge + crit + armor mitigation',
      'queuedOnSwing heroic_strike spend + bonus (warrior, cooldown 0)',
      'queuedOnSwing raptor_strike spend + bonus + on-next-swing cooldown set (hunter, cooldown 6)',
      'overpowerUntil window set on a melee dodge',
      'spiked-hide reflect tail of meleeSwing (wild_boar Bristled Hide)',
      'rangedSwing Auto Shot (hunter, physical, armor-mitigated, 8yd dead zone)',
      'rangedSwing Wand (mage, arcane, no armor, no dead zone)',
      'stopAutoAttack public entry',
    ],
    sampleEvery: 5,
    build: () => new Sim({ seed: 1019, playerClass: 'warrior', noPlayer: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      const warrior = sim.addPlayer('warrior', 'Wr') as number;
      const rogue = sim.addPlayer('rogue', 'Rg') as number;
      const hunterM = sim.addPlayer('hunter', 'Hm') as number;
      const hunterR = sim.addPlayer('hunter', 'Hr') as number;
      const mage = sim.addPlayer('mage', 'Mg') as number;
      const ids = [warrior, rogue, hunterM, hunterR, mage];
      for (const pid of ids) sim.setPlayerLevel(15, pid);
      const eWarrior = sim.entities.get(warrior) as AnyEntity;
      const eRogue = sim.entities.get(rogue) as AnyEntity;
      const eHunterM = sim.entities.get(hunterM) as AnyEntity;
      const eHunterR = sim.entities.get(hunterR) as AnyEntity;
      const eMage = sim.entities.get(mage) as AnyEntity;
      const lanes: Array<[AnyEntity, number]> = [
        [eWarrior, -60],
        [eRogue, -30],
        [eHunterM, 0],
        [eHunterR, 30],
        [eMage, 60],
      ];
      for (const [e, x] of lanes) {
        teleport(sim, e, x, -45);
        beef(e, 80000);
      }

      const spawnTarget = (owner: AnyEntity, key: string, dz: number, level: number): AnyEntity => {
        const m = spawnMob(sim, key, level, owner.pos.x, owner.pos.y, owner.pos.z + dz);
        beef(m, 500000);
        m.hostile = true;
        m.aiState = 'idle';
        rec.track(m.id);
        return m;
      };
      // dz 1.5 = melee; dz 20 = hunter Auto Shot band (> 8yd dead zone, <= 35);
      // dz 15 = wand band (no dead zone). wild_boar carries the spiked-hide thorns.
      const mobWarrior = spawnTarget(eWarrior, 'wild_boar', 1.5, 3);
      const mobRogue = spawnTarget(eRogue, 'forest_wolf', 1.5, 6);
      const mobHunterM = spawnTarget(eHunterM, 'forest_wolf', 1.5, 6);
      const mobHunterR = spawnTarget(eHunterR, 'forest_wolf', 20, 8);
      const mobMage = spawnTarget(eMage, 'forest_wolf', 15, 8);
      const pairs: Array<[number, AnyEntity, AnyEntity, number]> = [
        [warrior, eWarrior, mobWarrior, 1.5],
        [rogue, eRogue, mobRogue, 1.5],
        [hunterM, eHunterM, mobHunterM, 1.5],
        [hunterR, eHunterR, mobHunterR, 20],
        [mage, eMage, mobMage, 15],
      ];
      for (const [pid, e, m] of pairs) {
        face(e, m);
        sim.targetEntity(m.id, pid);
      }
      for (const pid of ids) sim.startAutoAttack(pid);

      for (let round = 0; round < 12; round++) {
        // Re-pin each target to its lane distance + re-face so the ranged dead-zone
        // (Auto Shot) vs no-dead-zone (Wand) branches stay deterministically exercised.
        for (const [, e, m, dz] of pairs) {
          teleport(sim, m, e.pos.x, e.pos.z + dz);
          face(e, m);
        }
        eWarrior.resource = eWarrior.maxResource;
        eHunterM.resource = eHunterM.maxResource;
        // Queue on-next-swing abilities (the guard avoids the cast-toggle that a
        // re-cast while already queued would trigger).
        if (eWarrior.gcdRemaining <= 0 && !eWarrior.castingAbility && !eWarrior.queuedOnSwing) {
          sim.castAbility('heroic_strike', warrior);
        }
        if (eHunterM.gcdRemaining <= 0 && !eHunterM.castingAbility && !eHunterM.queuedOnSwing) {
          sim.castAbility('raptor_strike', hunterM);
        }
        rec.tick(10);
      }
      rec.snapshot('swings');
      sim.stopAutoAttack(rogue); // public stop entry
      rec.tick(6);
      rec.snapshot('after-stop');
    },
  };
}

// World Market (L2): the Merchant's auction house. Two players stand at the
// Merchant; the seller lists a stack (escrow pulls it from their bags), the
// browse filter narrows then clears, the buyer buys it (coin leaves the buyer,
// goods enter their bags, the seller's proceeds = floor(price*(1-MARKET_CUT))
// wait in their collection), the seller lists then reclaims a second stack
// (escrow returns to bags), a third stack is forced past its expiry so the
// once-a-second updateMarket sweep returns it to the collection, and finally the
// seller collects (gold + the expired item move to bags). The market draws NO
// rng — its behavior is pinned entirely through PlayerMeta (copper/inventory) and
// the emitted event stream.
function marketRoundTrip(): Scenario {
  return {
    name: 'market_round_trip',
    coverage: [
      'World Market: marketList escrow (ctx.removeItem pulls the stack from bags)',
      'marketSearch browse filter (narrow to a substring, then clear)',
      'marketBuy cross-player sale: buyer copper - price + addItem; seller proceeds = floor(price*(1-MARKET_CUT))',
      'marketCancel reclaim escrow to bags',
      'updateMarket once-a-second expiry sweep (% 20): expired listing -> seller collection',
      'marketCollect: gold + expired items move to bags, collection cleared',
    ],
    build: () => new Sim({ seed: 1019, playerClass: 'warrior', noPlayer: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      const seller = sim.addPlayer('warrior', 'Seller');
      const buyer = sim.addPlayer('mage', 'Buyer');
      const merchant = [...sim.entities.values()].find(
        (e: AnyEntity) => e.templateId === 'the_merchant',
      ) as AnyEntity;
      // Stand both at the Merchant so the proximity gate passes (nearMerchant is
      // a dist2d check, so matching x/z is enough).
      teleport(sim, sim.entities.get(seller) as AnyEntity, merchant.pos.x, merchant.pos.z);
      teleport(sim, sim.entities.get(buyer) as AnyEntity, merchant.pos.x, merchant.pos.z);
      sim.addItem('wolf_fang', 4, seller);
      sim.players.get(buyer)!.copper = 5000;
      rec.notes.seller = seller;
      rec.notes.buyer = buyer;
      rec.snapshot('market-setup');

      // 1) list a stack of 2 -> escrow pulls them from the seller's bags.
      sim.marketList('wolf_fang', 2, 300, seller);
      rec.snapshot('listed');

      // 2) browse filter narrows to the wolf_fang listing, then clears.
      sim.marketSearch(
        { search: 'wolf', itemType: 'all', subtype: 'all', rarity: 'all', page: 0 },
        seller,
      );
      rec.snapshot('searched');
      sim.marketSearch(
        { search: '', itemType: 'all', subtype: 'all', rarity: 'all', page: 0 },
        seller,
      );
      rec.snapshot('search-cleared');

      // 3) the buyer buys it: coin leaves the buyer, goods enter their bags, the
      // seller's proceeds (less the 5% cut) wait in their collection.
      const sale = sim.marketListings.find((l) => !l.house && l.sellerName === 'Seller')!;
      sim.marketBuy(sale.id, buyer);
      rec.snapshot('bought');

      // 4) list a second stack then reclaim it -> the escrow returns to the bags.
      sim.marketList('wolf_fang', 1, 150, seller);
      const reclaim = sim.marketListings.find((l) => !l.house && l.sellerName === 'Seller')!;
      sim.marketCancel(reclaim.id, seller);
      rec.snapshot('cancelled');

      // 5) list a third stack, force it past due, then run the once-a-second
      // sweep (updateMarket fires at tickCount % 20 === 0) -> returns to collection.
      sim.marketList('wolf_fang', 1, 200, seller);
      const expiring = sim.marketListings.find((l) => !l.house && l.sellerName === 'Seller')!;
      expiring.expiresAt = sim.time - 1;
      rec.tick(20);
      rec.snapshot('expired');

      // 6) collect everything waiting: the sale gold + the expired item -> bags.
      sim.marketCollect(seller);
      rec.snapshot('collected');
    },
  };
}

// Inventory + vendor (W2): the player-facing items/vendor command surface that is
// still inline on Sim today and the W2 slice extracts into src/sim/items.ts behind
// SimContext. Drives buyItem, equipItem (an empty-slot equip then a same-slot SWAP
// that returns the old piece to the bags via addItemSilent + recalcPlayerStats),
// unequipItem (piece back to bags + recalc), useItem (food/drink sit, potion heal +
// cooldown, elixir aura), discardItem, sellItem (vendorInRange gate + recordVendorBuyback
// + meta.copper payout), sellAllJunk (bulk gray sweep + per-stack buyback record), and
// buyBackItem (meta.copper spend + addItemSilent + onInventoryChangedForQuests). Pins
// copper / inventory / equipment / vendorBuyback in samplePlayerMeta so the W2 move stays
// byte-identical. None of these commands draw rng, so the draw-order log must be UNCHANGED
// across the move.
function inventoryVendor(): Scenario {
  return {
    name: 'inventory_vendor',
    coverage: [
      'buyItem: meta.copper - buyValue*stackSize + addItem stack at trader_wilkes (vendor proximity gate)',
      'equipItem empty-slot equip + recalcPlayerStats',
      'equipItem same-slot SWAP: old piece returned to bags via addItemSilent + recalc',
      'unequipItem: piece back to bags, slot emptied, recalc',
      'useItem food/drink (sit + eating/drinking slot), potion (heal + cooldown), elixir (applyAura)',
      'discardItem: removeItem the discarded count',
      'sellItem: vendorInRange gate + recordVendorBuyback + meta.copper payout',
      'sellAllJunk: bulk gray sweep, per-stack buyback record, one summary line',
      'buyBackItem: meta.copper spend + addItemSilent + onInventoryChangedForQuests',
    ],
    build: () => new Sim({ seed: 5150, playerClass: 'warrior', noPlayer: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      const buyer = sim.addPlayer('warrior', 'Buyer');
      const meta = sim.players.get(buyer) as any;
      const p = sim.entities.get(buyer) as AnyEntity;
      const wilkes = [...sim.entities.values()].find(
        (e: AnyEntity) => e.templateId === 'trader_wilkes',
      ) as AnyEntity;
      // Stand at the vendor so the buyItem proximity + vendorInRange gates pass.
      teleport(sim, p, wilkes.pos.x + 2, wilkes.pos.z);
      meta.copper = 1000;
      rec.notes.buyer = buyer;
      rec.snapshot('iv-setup');

      // 1) buy a food, a drink, and a potion from the merchant (copper - buyValue each).
      sim.buyItem(wilkes.id, 'baked_bread', buyer);
      sim.buyItem(wilkes.id, 'spring_water', buyer);
      sim.buyItem(wilkes.id, 'minor_healing_potion', buyer);
      rec.snapshot('bought');

      // 2) equip a helmet into the empty slot, then a second helmet to force a SWAP
      //    (the old piece returns to the bags via addItemSilent) + recalcPlayerStats.
      sim.addItem('cryptbone_helm', 1, buyer);
      sim.addItem('roadwardens_helm', 1, buyer);
      sim.equipItem('cryptbone_helm', buyer);
      rec.snapshot('equipped');
      sim.equipItem('roadwardens_helm', buyer);
      rec.snapshot('equip-swapped');

      // 3) unequip the helmet back to the bags (recalc).
      sim.unequipItem('helmet', buyer);
      rec.snapshot('unequipped');

      // 4) consume: food + drink (sit + slot), a potion (heal + cooldown), an elixir (aura).
      sim.useItem('baked_bread', buyer);
      sim.useItem('spring_water', buyer);
      rec.snapshot('consumed');
      p.hp = p.maxHp - 50;
      sim.useItem('minor_healing_potion', buyer);
      rec.snapshot('quaffed-potion');
      sim.addItem('elixir_of_the_bear', 1, buyer);
      sim.useItem('elixir_of_the_bear', buyer);
      rec.snapshot('quaffed-elixir');

      // 5) discard one of a gray stack.
      sim.addItem('wolf_fang', 3, buyer);
      sim.discardItem('wolf_fang', 1, buyer);
      rec.snapshot('discarded');

      // 6) sell one gray item to the vendor (copper payout + buyback record).
      sim.sellItem('wolf_fang', 1, buyer);
      rec.snapshot('sold');

      // 7) bulk-sell the remaining gray (sellAllJunk: one summary line + per-stack buyback).
      sim.addItem('bandit_bandana', 1, buyer);
      sim.sellAllJunk(buyer);
      rec.snapshot('sold-junk');

      // 8) buy one back (copper spend + addItemSilent + onInventoryChangedForQuests).
      sim.buyBackItem('wolf_fang', buyer);
      rec.snapshot('bought-back');
    },
  };
}

// Personal bank: the per-character deposit box. A player stands at a
// bursar and moves a stack in and out through the pooled deposit/withdraw commands,
// then buys a slot expansion. Exercises every state transition the bank owns:
//  - bankDeposit partial (a fraction of a fungible stack leaves the bags);
//  - bankDeposit whole (the rest of the stack, merging into the bank slot);
//  - bankWithdraw partial then whole (the mirror, gated by bag capacity);
//  - bankBuySlots (copper - table price, purchasedSlots + 6).
// The bank draws NO rng (it is pure pooled-list math), so the draw-order digest must
// stay byte-identical; its behavior is pinned entirely through PlayerMeta (copper +
// inventory + bank) and the emitted event stream. Modeled on market_round_trip.
function bankRoundTrip(): Scenario {
  return {
    name: 'bank_round_trip',
    coverage: [
      'bankDeposit partial: a fraction of a fungible stack moves bags -> bank',
      'bankDeposit whole: the remaining stack merges into the bank slot',
      'bankWithdraw partial then whole: bank -> bags, gated by bag capacity',
      'bankBuySlots: meta.copper - BANK_EXPANSION_PRICES[0] + purchasedSlots + 6',
      'banker-proximity gate (nearBanker) satisfied by standing at a bursar',
    ],
    build: () => new Sim({ seed: 1024, playerClass: 'warrior', noPlayer: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      const pid = sim.addPlayer('warrior', 'Vaultkeeper');
      const meta = sim.players.get(pid) as any;
      // Stand at a bursar so the nearBanker gate passes (dist2d check, matching x/z
      // is enough). bankerIds is the Sim anchor list seeded by the ctor.
      const banker = sim.entities.get(sim.bankerIds[0]) as AnyEntity;
      teleport(sim, sim.entities.get(pid) as AnyEntity, banker.pos.x, banker.pos.z);
      sim.addItem('wolf_fang', 5, pid);
      meta.copper = 1000;
      rec.notes.pid = pid;
      rec.snapshot('bank-setup');

      // 1) deposit a partial count: 2 of the 5-stack leaves the bags for the bank.
      const depIdx = meta.inventory.findIndex((s: any) => s.itemId === 'wolf_fang');
      sim.bankDeposit(depIdx, 2, pid);
      rec.snapshot('deposited-partial');

      // 2) deposit the whole remaining stack (3): merges into the bank's wolf_fang slot.
      const depIdx2 = meta.inventory.findIndex((s: any) => s.itemId === 'wolf_fang');
      sim.bankDeposit(depIdx2, undefined, pid);
      rec.snapshot('deposited-whole');

      // 3) withdraw a partial count (1) back into the bags.
      sim.bankWithdraw(0, 1, pid);
      rec.snapshot('withdrew-partial');

      // 4) withdraw the whole remaining bank stack (4) back into the bags.
      sim.bankWithdraw(0, undefined, pid);
      rec.snapshot('withdrew-whole');

      // 5) buy the first slot expansion: copper - 500, purchasedSlots 0 -> 6.
      sim.bankBuySlots(pid);
      rec.snapshot('bought-slots');
      rec.tick(2);
    },
  };
}

// XP / prestige (G1b): the residual XP-shaping surface C1 left on Sim. Parks a
// warrior inside an inn footprint to accrue rested XP (updateRested + isResting),
// spends it on a kill-flagged award (the grantXp rested double-up), dings the
// level, jumps to the cap and overflows one prestige bar into lifetimeXp
// (accrueLifetimeXp, C1), then prestiges once (accept) and once below threshold
// (reject). Pins the moved rested/prestige mutations in samplePlayerMeta
// (restedXp / xp / lifetimeXp / prestigeRank) so the G1b move stays byte-identical.
function g1bXpPrestige(): Scenario {
  return {
    name: 'g1b_xp_prestige',
    coverage: [
      'rested-XP accrual inside an inn footprint (updateRested + isResting, G1b)',
      'rested double-up on a kill award (grantXp restedBonus consumption, C1)',
      'a level-up ding (grantXp level loop, C1)',
      'max-level overflow -> lifetimeXp / virtualLevelUp (accrueLifetimeXp, C1)',
      'cosmetic prestige accept + below-threshold reject (prestige, G1b)',
    ],
    build: () => new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      const meta = sim.meta(sim.playerId) as any;
      const p = sim.player as AnyEntity;

      // 1. Rested accrual: park inside an inn footprint, out of combat, and tick.
      //    updateRested fires each regen-phase tick while isResting(p) is true,
      //    accruing a positive (sub-unit) pool off DT.
      const innB = PROPS.buildings.find((b: any) => b.kind === 'inn')!;
      teleport(sim, p, innB.x, innB.z);
      rec.tick(60);
      rec.notes.restedAfterAccrual = meta.restedXp;
      rec.snapshot('rested-accrued');

      // 2. Seed a full pool (as rested_xp.test.ts does) so a kill-flagged award
      //    fires the grantXp rested double-up: 80 base + 80 bonus, pool 1000 -> 920.
      meta.restedXp = 1000;
      sim.grantXp(80, meta, { fromKill: true });
      rec.notes.restedAfterConsume = meta.restedXp;
      rec.snapshot('rested-consumed');

      // 3. A non-kill (quest-style) award that dings the level (rested untouched).
      sim.grantXp(xpForLevel(p.level) + 50, meta);
      rec.snapshot('ding');

      // 4. Jump to the cap and earn one prestige bar of post-cap XP -> the award
      //    overflows into lifetimeXp (the bar stays 0) and fires virtualLevelUp.
      sim.setPlayerLevel(MAX_LEVEL);
      sim.grantXp(PRESTIGE_XP_PER_RANK, meta);
      rec.snapshot('overflow');

      // 5. Prestige: the first call succeeds (one bar earned), the second is
      //    refused (no post-cap XP left for a second rank) and mutates nothing.
      rec.notes.prestigeAccepted = sim.prestige();
      rec.snapshot('prestige-accept');
      rec.notes.prestigeRejected = sim.prestige();
      rec.snapshot('prestige-reject');
    },
  };
}

// Player-to-player trade (G2): tradeRequest/tradeAccept open a shared session,
// tradeSetOffer validates the offer against the bags, tradeConfirm performs the
// atomic items+copper swap. A cancel path and an out-of-range drift auto-cancel
// (updateTradesAndInvites) round out the trade surface. No rng in the trade path;
// the single tick() advances the world for the drift sweep.
function playerTrade(): Scenario {
  return {
    name: 'player_trade',
    coverage: [
      'tradeRequest + tradeAccept open a shared session (both pids point at it)',
      'tradeSetOffer validates items against bags; tradeConfirm swaps items + copper atomically',
      'tradeCancel closes an open session with both sides notified',
      'updateTradesAndInvites drift cancel when the traders walk out of range',
    ],
    build: () => new Sim({ seed: 1021, playerClass: 'warrior', noPlayer: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      const a = sim.addPlayer('warrior', 'Ayla');
      const b = sim.addPlayer('mage', 'Borin');
      teleport(sim, sim.entities.get(a) as AnyEntity, 0, -40);
      teleport(sim, sim.entities.get(b) as AnyEntity, 3, -40);
      sim.addItem('wolf_fang', 3, a);
      sim.addItem('baked_bread', 2, b);
      sim.players.get(a)!.copper = 100;
      sim.players.get(b)!.copper = 50;
      rec.notes.a = a;
      rec.notes.b = b;
      rec.snapshot('trade-setup');

      // 1) atomic swap: A gives 2 wolf_fang + 30 copper, B gives 1 baked_bread + 10 copper.
      sim.tradeRequest(b, a);
      sim.tradeAccept(b);
      sim.tradeSetOffer([{ itemId: 'wolf_fang', count: 2 }], 30, a);
      sim.tradeSetOffer([{ itemId: 'baked_bread', count: 1 }], 10, b);
      sim.tradeConfirm(a);
      sim.tradeConfirm(b);
      rec.snapshot('swapped');

      // 2) cancel path: open another session, A confirms, B cancels it (no swap).
      sim.tradeRequest(b, a);
      sim.tradeAccept(b);
      sim.tradeSetOffer([{ itemId: 'wolf_fang', count: 1 }], 0, a);
      sim.tradeConfirm(a);
      sim.tradeCancel(b);
      rec.snapshot('cancelled');

      // 3) drift auto-cancel: open a session, walk B out of range, then let the
      // end-of-tick updateTradesAndInvites sweep cancel it.
      sim.tradeRequest(b, a);
      sim.tradeAccept(b);
      rec.snapshot('drift-open');
      teleport(sim, sim.entities.get(b) as AnyEntity, 40, -40);
      rec.tick(1);
      rec.snapshot('drift-cancelled');
    },
  };
}

// Player social chat (G2): the chat() router on Sim dispatches to the extracted
// chat helpers in src/sim/social/chat.ts (whisper resolution, channel membership,
// broadcastEmote, the chatAllowed token bucket). Exercises say/yell range
// delivery, party + general + opt-in (world/lfg) channels, a /w + /r whisper
// round-trip, /me and predefined emotes, /inspect + /help readouts, an overhead
// playEmote, and the anti-spam throttle. Chat draws no shared rng.
function chatSocial(): Scenario {
  return {
    name: 'chat_social',
    coverage: [
      'say/yell range delivery + party/general/world/lfg channel routing',
      'whisper /w + /r round-trip via resolveWhisperTarget (exact-then-unambiguous-CI)',
      '/me + predefined /wave emotes via broadcastEmote + findPlayerByName; playEmote bubble',
      'handleChannelMembership /join opt-in channels; chatAllowed token-bucket throttle',
    ],
    build: () => new Sim({ seed: 1023, playerClass: 'warrior', noPlayer: true }),
    drive(rec: Recorder) {
      const sim = rec.sim as AnySim;
      const a = sim.addPlayer('warrior', 'Aleph');
      const b = sim.addPlayer('mage', 'Bet');
      const c = sim.addPlayer('rogue', 'Gimel');
      teleport(sim, sim.entities.get(a) as AnyEntity, 0, -40);
      teleport(sim, sim.entities.get(b) as AnyEntity, 3, -40);
      teleport(sim, sim.entities.get(c) as AnyEntity, 6, -40);
      sim.partyInvite(b, a);
      sim.partyAccept(b);
      rec.notes.a = a;
      rec.notes.b = b;
      rec.notes.c = c;
      rec.snapshot('chat-setup');

      // a (<= 8-message burst): opt-in join, channel + say/yell + party sends, a
      // whisper to Bet (sets Bet.lastWhisperFrom), and a freeform /me emote.
      sim.chat('/join world', a);
      sim.chat('/world hello world', a);
      sim.chat('/s hi there', a);
      sim.chat('/y HELLO CAMP', a);
      sim.chat('/p ready check', a);
      sim.chat('/w Bet psst', a);
      sim.chat('/me waves to the crowd', a);
      rec.snapshot('a-chats');

      // b (<= 8-message burst): join world+lfg, an lfg send, general, the /r reply
      // (resolves to Aleph), a predefined /wave at Aleph, and an /inspect readout.
      sim.chat('/join world', b);
      sim.chat('/join lfg', b);
      sim.chat('/lfg need a healer', b);
      sim.chat('/general anyone there', b);
      sim.chat('/r got your whisper', b);
      sim.chat('/wave Aleph', b);
      sim.chat('/inspect Aleph', b);
      rec.snapshot('b-chats');

      sim.chat('/help', a);
      sim.playEmote('salute', a);
      rec.snapshot('readout-emote');

      // c: token-bucket throttle — the first 8 messages pass, later ones are throttled.
      for (let i = 0; i < 10; i++) sim.chat(`/s spam ${i}`, c);
      rec.snapshot('throttled');
    },
  };
}

export const SCENARIOS: Scenario[] = [
  soloWarrior(),
  soloMage(),
  soloRogue(),
  affixMob(),
  mobSwingAffixes(),
  hunterPet(),
  warlockPet(),
  petAi(),
  petCommands(),
  paladinConsecration(),
  arena1v1(),
  fiesta(),
  fiestaPowerups(),
  duelToWinner(),
  arena2v2Wipe(),
  delveLockpick(),
  delveLockpickFail(),
  drownedLitany(),
  partyLoot(),
  partyRaid(),
  l1LootDistribution(),
  entityRoster(),
  delveDeath(),
  fiestaMidcastKill(),
  multiClassFrenzy(),
  mobTargeting(),
  delveCompanion(),
  questKillCredit(),
  questCollectTurnIn(),
  questLinkAbandon(),
  talentsProgression(),
  multiClassHeal(),
  mobLocomotion(),
  delveProgression(),
  dungeonInstances(),
  dungeonRaidLockout(),
  nythraxisFullPull(),
  c3AuraRunner(),
  c4aCastingLifecycle(),
  mobLifecycle(),
  targetingMarkers(),
  c4bEffectDispatch(),
  c5AutoAttack(),
  marketRoundTrip(),
  inventoryVendor(),
  bankRoundTrip(),
  g1bXpPrestige(),
  playerTrade(),
  chatSocial(),
];
