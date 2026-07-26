import { describe, expect, it, vi } from 'vitest';
import { visualKeyFor } from '../src/render/characters/manifest';
import { FURY_ENTITY_ID } from '../src/sim/content/pvp_honor';
import { delveModuleZOffset, isDelvePos, MOBS } from '../src/sim/data';
import { updateDoorTriggers } from '../src/sim/instances/dungeons';
import { runMobSwingAffixes } from '../src/sim/mob/mob_swing';
import { mobTemplateOf } from '../src/sim/mob/mob_template';
import { Sim } from '../src/sim/sim';
import { VALE_CUP_BRAM_ID } from '../src/sim/social/vale_cup';
import {
  isSourceCavePos,
  SOURCE_CAVE_DOOR_ID,
  SOURCE_CAVE_DOOR_POS,
  SOURCE_CAVE_DUNGEON_ID,
  SOURCE_CAVE_ENCIRCLE_RADIUS,
  SOURCE_CAVE_MOB_BANTER_LINES,
  SOURCE_CAVE_MOB_CUSTOM_ATTRIBUTES,
  SOURCE_CAVE_PLACEHOLDER_ROSTER,
  SOURCE_CAVE_REBOOT_SAFE_RADIUS,
  SOURCE_CAVE_REBOOT_TEMPLATE,
  SOURCE_CAVE_SLOT_COUNT,
  SOURCE_CAVE_WELL_BANTER_LINES,
  sourceCaveMobCustomAttributesForLogin,
  sourceCaveMobProfileForMergedPrs,
  sourceCaveMobProfileForTier,
  sourceCaveOrigin,
  sourceCaveTierWeaponForLogin,
} from '../src/sim/source_cave';
import type { SourceCaveRosterEntry } from '../src/sim/source_cave/types';
import { releasePlayerSpirit } from '../src/sim/spirit';
import {
  type Aura,
  type Entity,
  INSTANCE_EMPTY_TIMEOUT,
  INTERACT_RANGE,
  type MobTemplate,
  STATIC_WORLD_SERVICE_ENTITY_ID_MIN,
} from '../src/sim/types';
import { localizeSimAuraName } from '../src/ui/sim_i18n';

// biome-ignore lint/suspicious/noExplicitAny: tests reach ctx / private helpers.
type AnySim = Sim & any;

function makeSim(roster?: SourceCaveRosterEntry[], seed = 1234): AnySim {
  return new Sim({
    seed,
    playerClass: 'warrior',
    noPlayer: true,
    sourceCaveRoster: roster,
  }) as AnySim;
}

function teleport(sim: AnySim, e: Entity, x: number, z: number): void {
  e.pos = { x, y: e.pos.y, z };
  e.prevPos = { ...e.pos };
  sim.rebucket(e);
}

function claimedCave(sim: AnySim) {
  return sim.instances.find(
    (i: { dungeonId: string; partyKey: string | null }) =>
      i.dungeonId === SOURCE_CAVE_DUNGEON_ID && i.partyKey !== null,
  );
}

// createMob's Source Cave formulas for the copied archetype (hpBase 64,
// hpPerLevel 23, dmgBase 12, dmgPerLevel 2.7), with explicit tier multipliers.
function expectedMaxHp(level: number, hpMult: number): number {
  return Math.round((64 + 23 * (level - 1)) * hpMult);
}

function expectedWeapon(level: number, dmgMult: number): { min: number; max: number } {
  const dmg = (12 + 2.7 * (level - 1)) * dmgMult;
  return {
    min: Math.round(dmg * 0.8),
    max: Math.round(dmg * 1.25),
  };
}

interface ExpectedTierSpawn {
  level: number;
  elite: boolean;
  boss: boolean;
  hpMult: number;
  dmgMult: number;
  scale: number;
  visualKey?: string;
  color?: number;
  mainhandItemId?: string;
  attackSpeed?: number;
}

describe('source cave: runtime dungeon registration', () => {
  it('every Sim builds the cave from the placeholder roster by default', () => {
    const sim = makeSim();
    expect(sim.sourceCave).not.toBeNull();
    expect(sim.sourceCave.spec.mobs.length).toBe(SOURCE_CAVE_PLACEHOLDER_ROSTER.length);
    // one synthesized template per placed mob, index-aligned.
    expect(sim.sourceCave.templates.length).toBe(sim.sourceCave.spec.mobs.length);
  });

  it('spawns the reserved-id overworld door without shifting the id sequence', () => {
    const sim = makeSim();
    const door = sim.entities.get(SOURCE_CAVE_DOOR_ID);
    expect(door).toBeDefined();
    expect(door.templateId).toBe('dungeon_door');
    expect(door.dungeonId).toBe(SOURCE_CAVE_DUNGEON_ID);
    // nextId is nowhere near the reserved id (would take decades of uptime to reach).
    expect(sim.nextId).toBeLessThan(SOURCE_CAVE_DOOR_ID);
  });

  // Regression pin for the collision that shipped once: SOURCE_CAVE_DOOR_ID was
  // 1_000_000_001, which the PvP honor NPC also claims (FURY_ENTITY_ID). The ctor
  // spawns the door under a reserved id, so a clash means one of the two entities
  // simply never appears. Comparing the CONSTANTS catches that at its source, with
  // no world construction and no play test: reintroduce any overlap and this reds.
  it('keeps every reserved singleton entity id distinct and below the service band', () => {
    const reserved = {
      VALE_CUP_BRAM_ID,
      FURY_ENTITY_ID,
      SOURCE_CAVE_DOOR_ID,
    };
    const ids = Object.values(reserved);
    expect(new Set(ids).size, `reserved singleton ids collide: ${JSON.stringify(reserved)}`).toBe(
      ids.length,
    );
    // The static world-service namespace (noticeboards) starts above this band; a
    // singleton id that drifted into it would collide with an authored service id.
    for (const [name, id] of Object.entries(reserved)) {
      expect(id, `${name} must stay below the static world-service band`).toBeLessThan(
        STATIC_WORLD_SERVICE_ENTITY_ID_MIN,
      );
    }
  });

  it('spawns the door at the configured overworld entrance, nudged onto land', () => {
    const sim = makeSim();
    const door = sim.entities.get(SOURCE_CAVE_DOOR_ID);
    // findSafePos nudges onto walkable land (search radius up to ~18u, sim.ts), so
    // pin "close to the requested spot", not exact equality.
    const dx = door.pos.x - SOURCE_CAVE_DOOR_POS.x;
    const dz = door.pos.z - SOURCE_CAVE_DOOR_POS.z;
    expect(Math.hypot(dx, dz)).toBeLessThan(20);
  });

  it('appends an unclaimed slot pool tagged with the runtime dungeon id', () => {
    const sim = makeSim();
    const slots = sim.instances.filter(
      (i: { dungeonId: string }) => i.dungeonId === SOURCE_CAVE_DUNGEON_ID,
    );
    expect(slots.length).toBe(SOURCE_CAVE_SLOT_COUNT);
    expect(slots.every((s: { partyKey: string | null }) => s.partyKey === null)).toBe(true);
  });
});

describe('source cave: entry, claim and spawns', () => {
  it('entering claims a slot and spawns exactly the roster with names, levels, elite and positions', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Alice');
    sim.setPlayerLevel(20, pid);
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);

    const inst = claimedCave(sim);
    expect(inst).toBeDefined();
    const spec = sim.sourceCave.spec;
    expect(inst.mobIds.length).toBe(spec.mobs.length);
    expect(inst.exitId).not.toBeNull();

    const origin = sourceCaveOrigin(inst.slot);
    const spawned = new Map<string, Entity>();
    for (const id of inst.mobIds) {
      const e = sim.entities.get(id) as Entity;
      spawned.set(e.templateId, e);
    }
    expect(spawned.size).toBe(spec.mobs.length);

    for (const mob of spec.mobs) {
      // The login stays anchored in the template id; the display name yields to
      // a SOURCE_CAVE_MOB_CUSTOM_ATTRIBUTES override when one exists.
      const e = spawned.get(`source_cave_${mob.login}`);
      expect(e, `mob ${mob.login} spawned`).toBeDefined();
      if (!e) continue;
      expect(e.name).toBe(sourceCaveMobCustomAttributesForLogin(mob.login)?.name ?? mob.login);
      expect(e.level).toBe(mob.level);
      // The identity/power split (templates.ts): body, tint and the HELD weapon
      // come from the contributor's own merged-PR rung, while level, HP, damage,
      // scale and the swing cadence come from the assigned combat role. On a
      // roster larger than the combat budget the two genuinely differ.
      const identity = sourceCaveMobProfileForMergedPrs(mob.mergedPrs, mob.boss);
      const combat = mob.combatTier
        ? sourceCaveMobProfileForTier(mob.combatTier, mob.boss)
        : identity;
      expect(e.maxHp).toBe(expectedMaxHp(mob.level, combat.hpMult));
      // Armed tiers re-pace the swing at constant dps: damage scales by the
      // weapon's speed over the archetype's 2.3 (templates.ts).
      const combatWeapon = sourceCaveTierWeaponForLogin(combat.key, mob.login);
      const pace = (combatWeapon?.attackSpeed ?? 2.3) / 2.3;
      expect(e.weapon.min).toBe(expectedWeapon(mob.level, combat.dmgMult * pace).min);
      expect(e.weapon.max).toBe(expectedWeapon(mob.level, combat.dmgMult * pace).max);
      expect(e.weapon.speed).toBe(combatWeapon?.attackSpeed ?? 2.3);
      expect(e.mainhandItemId).toBe(
        sourceCaveMobCustomAttributesForLogin(mob.login)?.mainhandItemId ??
          sourceCaveTierWeaponForLogin(identity.key, mob.login)?.itemId ??
          null,
      );
      expect(e.scale).toBe(combat.scale);
      expect(e.visualKey).toBe(identity.visualKey ?? null);
      // World position = instance origin + delve module z-offset + module-local (x, z).
      const zBase = delveModuleZOffset(spec.modules, mob.moduleIndex);
      expect(e.pos.x).toBe(origin.x + mob.x);
      expect(e.pos.z).toBe(origin.z + zBase + mob.z);
      // Spawned inside the reserved cave x-band.
      expect(isSourceCavePos(e.pos.x)).toBe(true);
    }
  });

  it('maps every contributor tier to distinct Source Cave stats and base visuals', () => {
    const roster: SourceCaveRosterEntry[] = [
      { login: 'world', mergedPrs: 70, rank: 1 },
      { login: 'architect', mergedPrs: 30, rank: 2 },
      { login: 'runesmith', mergedPrs: 15, rank: 3 },
      { login: 'artificer', mergedPrs: 5, rank: 4 },
      { login: 'tinkerer', mergedPrs: 1, rank: 5 },
      { login: 'unranked', mergedPrs: 0, rank: 6 },
    ];
    const sim = makeSim(roster);
    const pid = sim.addPlayer('warrior', 'Alice');
    sim.setPlayerLevel(20, pid);
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);

    // Every rung wears a pipeline-generated dev body. The armed tiers carry a
    // per-mob mainhand (wire `mh`, render-only): architects the Commit Blade,
    // runesmiths a login-hash split between the Bug Squasher (2.6, heavy) and
    // the Keystroke (2.2, fast) re-paced at constant dps; the dev_* rigs stay
    // unarmed. Multipliers are the raid-tier tuning (tier_profiles.ts).
    const expected = new Map<string, ExpectedTierSpawn>([
      [
        'unranked',
        {
          level: 19,
          elite: false,
          boss: false,
          hpMult: 2.25,
          dmgMult: 0.7,
          scale: 1,
          visualKey: 'dev_noob',
        },
      ],
      [
        'tinkerer',
        {
          level: 19,
          elite: false,
          boss: false,
          hpMult: 2.05,
          dmgMult: 0.8,
          scale: 1.05,
          visualKey: 'dev_noob',
        },
      ],
      [
        'artificer',
        {
          level: 19,
          elite: false,
          boss: false,
          hpMult: 2.55,
          dmgMult: 0.9,
          scale: 1.1,
          visualKey: 'dev_gamer',
        },
      ],
      [
        'runesmith',
        {
          level: 20,
          elite: true,
          boss: false,
          hpMult: 3.5,
          // The 'runesmith' login hashes onto the Bug Squasher: dmg re-paced
          // by 2.6/2.3 at constant dps.
          dmgMult: 1.45 * (2.6 / 2.3),
          scale: 1.15,
          visualKey: 'hacker_druid',
          mainhandItemId: 'bug_squasher',
          attackSpeed: 2.6,
        },
      ],
      [
        'architect',
        {
          level: 20,
          elite: true,
          boss: false,
          hpMult: 5.65,
          dmgMult: 1.75,
          scale: 1.3,
          visualKey: 'coder_hunter',
          mainhandItemId: 'commit_blade',
          attackSpeed: 2.3,
        },
      ],
      [
        'world',
        {
          level: 20,
          elite: true,
          boss: true,
          hpMult: 8.45 * 3.2,
          dmgMult: 2.3 * 2.6,
          scale: 1.7 + 0.15,
          visualKey: 'dev_hacker',
          color: 0xf0c454,
        },
      ],
    ]);

    const inst = claimedCave(sim);
    const spawned = new Map<string, Entity>();
    for (const id of inst.mobIds) {
      const e = sim.entities.get(id) as Entity;
      spawned.set(e.templateId.replace('source_cave_', ''), e);
    }

    for (const [login, attrs] of expected) {
      const specMob = sim.sourceCave.spec.mobs.find((m: { login: string }) => m.login === login);
      expect(specMob).toMatchObject({
        level: attrs.level,
        elite: attrs.elite,
        boss: attrs.boss,
      });
      const e = spawned.get(login);
      expect(e, `${login} spawned`).toBeDefined();
      if (!e) continue;
      expect(e.level).toBe(attrs.level);
      expect(e.maxHp).toBe(expectedMaxHp(attrs.level, attrs.hpMult));
      expect(e.weapon.min).toBe(expectedWeapon(attrs.level, attrs.dmgMult).min);
      expect(e.weapon.max).toBe(expectedWeapon(attrs.level, attrs.dmgMult).max);
      expect(e.weapon.speed).toBe(attrs.attackSpeed ?? 2.3);
      expect(e.scale).toBe(attrs.scale);
      expect(e.visualKey).toBe(attrs.visualKey ?? null);
      expect(e.mainhandItemId).toBe(attrs.mainhandItemId ?? null);
      if (attrs.color !== undefined) expect(e.color).toBe(attrs.color);
    }
  });

  it('spawns exactly one boss around the centre button, and it is present in the world', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Alice');
    sim.setPlayerLevel(20, pid);
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
    const spec = sim.sourceCave.spec;

    const bosses = spec.mobs.filter((m: { boss: boolean }) => m.boss);
    expect(bosses.length).toBe(1);
    const boss = bosses[0];
    // The centre dais is reserved for the reboot button, so the boss joins the ring.
    expect(boss.moduleIndex).toBe(0);
    expect(Math.hypot(boss.x, boss.z)).toBeGreaterThan(0);
    // Its synthesized template carries the boss flag, and the mob is in the world.
    const bossTemplate = sim.sourceCave.templates.find((t: { boss?: boolean }) => t.boss === true);
    expect(bossTemplate.id).toBe(`source_cave_${boss.login}`);
    const inst = claimedCave(sim);
    const spawnedNames = inst.mobIds.map((id: number) => sim.entities.get(id).name);
    expect(spawnedNames).toContain(boss.login);
  });

  it('places the player inside the cave and lands on flat delve-band ground', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Alice');
    sim.setPlayerLevel(20, pid);
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
    const p = sim.entities.get(pid) as Entity;
    expect(isSourceCavePos(p.pos.x)).toBe(true);
    expect(p.pos.y).toBe(0); // dungeon/delve floor
  });

  it('applies custom display attributes keyed by GitHub login', () => {
    SOURCE_CAVE_MOB_CUSTOM_ATTRIBUTES.alpha = {
      name: 'Archivist Alpha',
      visualKey: 'player_mage',
      skin: 2,
      color: 0x8a4cff,
      scale: 1.42,
      mainhandItemId: 'gravecaller_staff',
    };
    try {
      const sim = makeSim([{ login: 'Alpha', mergedPrs: 90, rank: 1 }]);
      const pid = sim.addPlayer('warrior', 'Alice');
      sim.setPlayerLevel(20, pid);
      sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);

      const inst = claimedCave(sim);
      expect(inst).toBeDefined();
      const e = sim.entities.get(inst.mobIds[0]) as Entity;
      expect(e.templateId).toBe('source_cave_Alpha');
      expect(e.name).toBe('Archivist Alpha');
      expect(e.visualKey).toBe('player_mage');
      expect(e.skin).toBe(2);
      expect(e.color).toBe(0x8a4cff);
      expect(e.scale).toBe(1.42);
      expect(e.mainhandItemId).toBe('gravecaller_staff');
      expect(visualKeyFor(e)).toBe('player_mage');
    } finally {
      delete SOURCE_CAVE_MOB_CUSTOM_ATTRIBUTES.alpha;
    }
  });
});

// Cave contributors now bypass the ordinary idle proximity scan while friendly.
// These cases pin that the generic owner-less-mob safety net and both player/pet
// proximity paths cannot wake them before the centre reboot interaction.
describe('source cave: friendly contributor roster', () => {
  it('a player standing beside a contributor does not wake it before reboot', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Alice');
    sim.setPlayerLevel(20, pid);
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
    const p = sim.entities.get(pid) as Entity;
    const inst = claimedCave(sim);
    const spec = sim.sourceCave.spec;

    const nonElite = spec.mobs.find((m: { elite: boolean; boss: boolean }) => !m.elite && !m.boss);
    expect(nonElite, 'placeholder roster has a non-elite, non-boss mob').toBeDefined();
    const mobEntity = inst.mobIds
      .map((id: number) => sim.entities.get(id) as Entity)
      .find((e: Entity) => e.templateId === `source_cave_${nonElite.login}`) as Entity;
    expect(mobEntity).toBeDefined();
    expect(mobEntity.aiState).toBe('idle');
    expect(mobEntity.hostile).toBe(false);

    // Well inside the template's former 12u proximity-aggro radius.
    teleport(sim, p, mobEntity.pos.x + 2, mobEntity.pos.z);

    expect(() => sim.tick()).not.toThrow();
    expect(mobEntity.aiState).toBe('idle');
    expect(mobEntity.aggroTargetId).toBeNull();
    expect(mobEntity.hostile).toBe(false);
  });

  it('an elite cave mob also stays friendly beside a much higher-level player', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Alice');
    sim.setPlayerLevel(60, pid); // gap 40+ would trivial-con a non-elite/boss mob
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
    const p = sim.entities.get(pid) as Entity;
    const inst = claimedCave(sim);
    const spec = sim.sourceCave.spec;

    const elite = spec.mobs.find((m: { elite: boolean; boss: boolean }) => m.elite || m.boss);
    expect(elite, 'placeholder roster has an elite/boss mob').toBeDefined();
    const mobEntity = inst.mobIds
      .map((id: number) => sim.entities.get(id) as Entity)
      .find((e: Entity) => e.templateId === `source_cave_${elite.login}`) as Entity;
    expect(mobEntity).toBeDefined();

    teleport(sim, p, mobEntity.pos.x + 2, mobEntity.pos.z);

    expect(() => sim.tick()).not.toThrow();
    expect(mobEntity.aggroTargetId).toBeNull();
    expect(mobEntity.hostile).toBe(false);
  });

  it('a pet standing beside a contributor cannot pull it before reboot', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warlock', 'Demonist');
    sim.setPlayerLevel(20, pid);
    const p = sim.entities.get(pid) as Entity;
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
    sim.summonPet(p, 'emberkin');
    const pet = sim.petOf(pid) as Entity;
    expect(pet).toBeDefined();

    const inst = claimedCave(sim);
    const spec = sim.sourceCave.spec;
    const nonElite = spec.mobs.find((m: { elite: boolean; boss: boolean }) => !m.elite && !m.boss);
    expect(nonElite, 'placeholder roster has a non-elite, non-boss mob').toBeDefined();
    const mobEntity = inst.mobIds
      .map((id: number) => sim.entities.get(id) as Entity)
      .find((e: Entity) => e.templateId === `source_cave_${nonElite.login}`) as Entity;
    expect(mobEntity).toBeDefined();
    expect(mobEntity.aiState).toBe('idle');

    teleport(sim, pet, mobEntity.pos.x + 2, mobEntity.pos.z);

    expect(() => sim.tick()).not.toThrow();
    expect(mobEntity.aggroTargetId).toBeNull();
    expect(mobEntity.hostile).toBe(false);
  });
});

describe('source cave: friendly idle wander', () => {
  it('friendly contributors amble around their ring seats without dissolving the rings', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Alice');
    sim.setPlayerLevel(20, pid);
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
    const inst = claimedCave(sim);
    const mobs = inst.mobIds.map((id: number) => sim.entities.get(id) as Entity);
    const seats = new Map(mobs.map((m: Entity) => [m.id, { ...m.spawnPos }]));

    // 30 in-game seconds: enough for several wander/pause cycles.
    const moved = new Set<number>();
    let maxLeash = 0;
    for (let i = 0; i < 20 * 30; i++) {
      sim.tick();
      for (const mob of mobs) {
        const seat = seats.get(mob.id) as { x: number; z: number };
        const d = Math.hypot(mob.pos.x - seat.x, mob.pos.z - seat.z);
        if (d > 0.25) moved.add(mob.id);
        if (d > maxLeash) maxLeash = d;
      }
    }

    // They visibly move (this is the point of the wander)...
    expect(moved.size).toBeGreaterThan(mobs.length / 2);
    // ...but never drift beyond the tight leash, so the concentric rings hold
    // (SOURCE_CAVE_WANDER_RADIUS_MAX 3, +1 of moveToward step slack, well under
    // the 6u pairwise placement floor).
    expect(maxLeash).toBeLessThan(4);
    // And the amble never breaks the friendly contract.
    for (const mob of mobs) {
      expect(mob.hostile).toBe(false);
      expect(mob.aiState).toBe('idle');
      expect(mob.aggroTargetId).toBeNull();
    }
  });

  it('the wander is deterministic: same seed and roster reproduce the exact positions', () => {
    // The friendly amble adds ctx.rng draws to the tick loop (wander.ts header),
    // so a draw-order fork here would desync hosts. Run the same world twice and
    // require bit-identical mob positions after many wander/pause cycles.
    const run = () => {
      const sim = makeSim();
      const pid = sim.addPlayer('warrior', 'Alice');
      sim.setPlayerLevel(20, pid);
      sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
      const inst = claimedCave(sim);
      for (let i = 0; i < 20 * 30; i++) sim.tick();
      return inst.mobIds.map((id: number) => {
        const mob = sim.entities.get(id) as Entity;
        return { name: mob.name, x: mob.pos.x, z: mob.pos.z, facing: mob.facing };
      });
    };
    expect(run()).toEqual(run());
  });
});

describe('source cave: friendly banter on interaction', () => {
  function nearestMobSetup(sim: AnySim) {
    const pid = sim.addPlayer('warrior', 'Alice');
    sim.setPlayerLevel(20, pid);
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
    const p = sim.entities.get(pid) as Entity;
    const inst = claimedCave(sim);
    const mob = sim.entities.get(inst.mobIds[0]) as Entity;
    teleport(sim, p, mob.pos.x + 2, mob.pos.z);
    p.targetId = null;
    return { pid, p, inst, mob };
  }

  it('interacting with a friendly contributor answers one random line from the list', () => {
    const sim = makeSim();
    const { pid, mob } = nearestMobSetup(sim);
    sim.drainEvents();
    sim.interact(pid);
    type ChatEv = { type: string; channel?: string; text?: string; from?: string; pid?: number };
    const says = (sim.drainEvents() as ChatEv[]).filter(
      (ev) => ev.type === 'chat' && ev.channel === 'say',
    );
    expect(says).toHaveLength(1);
    expect(SOURCE_CAVE_MOB_BANTER_LINES).toContain(says[0].text);
    expect(says[0].from).toBe(mob.name);
    expect(says[0].pid).toBe(pid);
  });

  it('the pick is deterministic (same seed, same line) and varies across interactions', () => {
    const run = (interactions: number) => {
      const sim = makeSim();
      const { pid } = nearestMobSetup(sim);
      sim.drainEvents();
      const lines: string[] = [];
      type ChatEv = { type: string; channel?: string; text?: string };
      for (let i = 0; i < interactions; i++) {
        sim.interact(pid);
        for (const ev of sim.drainEvents() as ChatEv[]) {
          if (ev.type === 'chat' && ev.channel === 'say' && ev.text) lines.push(ev.text);
        }
      }
      return lines;
    };
    expect(run(8)).toEqual(run(8));
    // 8 draws over 7 lines: a stuck rng (always the same line) would fail this.
    expect(new Set(run(8)).size).toBeGreaterThan(1);
  });

  it('targeted interaction banters the TARGETED contributor, not the nearest', () => {
    const sim = makeSim();
    const { pid, p, inst } = nearestMobSetup(sim);
    const other = sim.entities.get(inst.mobIds[1]) as Entity;
    teleport(sim, p, other.pos.x + 2, other.pos.z); // stand next to another mob
    p.targetId = inst.mobIds[0];
    teleport(
      sim,
      p,
      (sim.entities.get(inst.mobIds[0]) as Entity).pos.x + 2,
      (sim.entities.get(inst.mobIds[0]) as Entity).pos.z,
    );
    sim.drainEvents();
    sim.interact(pid);
    type ChatEv = { type: string; channel?: string; from?: string };
    const says = (sim.drainEvents() as ChatEv[]).filter(
      (ev) => ev.type === 'chat' && ev.channel === 'say',
    );
    expect(says).toHaveLength(1);
    expect(says[0].from).toBe((sim.entities.get(inst.mobIds[0]) as Entity).name);
  });

  it('stops bantering once the roster turns hostile (the reboot ends the friendly phase)', () => {
    const sim = makeSim();
    const { pid, p, inst, mob } = nearestMobSetup(sim);
    // Press the button first.
    const buttonId = inst.objectIds.find(
      (id: number) => sim.entities.get(id)?.templateId === SOURCE_CAVE_REBOOT_TEMPLATE,
    );
    const button = sim.entities.get(buttonId) as Entity;
    teleport(sim, p, button.pos.x, button.pos.z - 3);
    sim.interact(pid);
    expect(mob.hostile).toBe(true);

    teleport(sim, p, mob.pos.x + 2, mob.pos.z);
    p.targetId = mob.id;
    sim.drainEvents();
    sim.interact(pid);
    type ChatEv = { type: string; channel?: string };
    const says = (sim.drainEvents() as ChatEv[]).filter(
      (ev) => ev.type === 'chat' && ev.channel === 'say',
    );
    expect(says).toHaveLength(0);
  });
});

describe('source cave: reboot button', () => {
  it('spawns the button on the centre dais with every contributor around it', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Alice');
    sim.setPlayerLevel(20, pid);
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
    const inst = claimedCave(sim);
    const button = inst.objectIds
      .map((id: number) => sim.entities.get(id) as Entity | undefined)
      .find((e: Entity | undefined) => e?.templateId === SOURCE_CAVE_REBOOT_TEMPLATE);
    expect(button).toBeDefined();
    if (!button) throw new Error('Source Cave reboot button was not spawned');
    const origin = sourceCaveOrigin(inst.slot);
    const zBase = delveModuleZOffset(sim.sourceCave.spec.modules, 0);
    expect(button.pos.x).toBe(origin.x + sim.sourceCave.spec.chestPos.x);
    expect(button.pos.z).toBe(origin.z + zBase + sim.sourceCave.spec.chestPos.z);
    for (const mobId of inst.mobIds) {
      const mob = sim.entities.get(mobId) as Entity;
      expect(mob.hostile).toBe(false);
      expect(Math.hypot(mob.pos.x - button.pos.x, mob.pos.z - button.pos.z)).toBeGreaterThan(0);
    }
  });

  it('pressing it makes the roster hostile, then advances only the first deterministic wave', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Alice');
    sim.setPlayerLevel(20, pid);
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
    const p = sim.entities.get(pid) as Entity;
    const inst = claimedCave(sim);
    const buttonId = inst.objectIds.find(
      (id: number) => sim.entities.get(id)?.templateId === SOURCE_CAVE_REBOOT_TEMPLATE,
    );
    const button = sim.entities.get(buttonId) as Entity;
    const nearestMob = inst.mobIds
      .map((id: number) => sim.entities.get(id) as Entity)
      .sort(
        (a: Entity, b: Entity) =>
          Math.hypot(a.pos.x - button.pos.x, a.pos.z - button.pos.z) -
          Math.hypot(b.pos.x - button.pos.x, b.pos.z - button.pos.z),
      )[0];
    const dx = nearestMob.pos.x - button.pos.x;
    const dz = nearestMob.pos.z - button.pos.z;
    const length = Math.hypot(dx, dz);
    const approachDistance = INTERACT_RANGE - 0.5;
    teleport(
      sim,
      p,
      button.pos.x + (dx / length) * approachDistance,
      button.pos.z + (dz / length) * approachDistance,
    );
    p.targetId = null;

    sim.interact(pid);

    // The pressed button stays on the dais as an inert prop: still an entity,
    // still slot-tracked (freeInstance despawns it), but no longer interactable.
    expect(sim.entities.has(button.id)).toBe(true);
    expect(inst.objectIds).toContain(button.id);
    expect(button.lootable).toBe(false);
    for (const mobId of inst.mobIds) {
      const mob = sim.entities.get(mobId) as Entity;
      expect(mob.hostile).toBe(true);
      expect(mob.aiState).toBe('idle');
      expect(mob.inCombat).toBe(false);
      expect(mob.aggroTargetId).toBeNull();
    }

    const events = sim.tick();
    const bossSpec = sim.sourceCave.spec.mobs.find((mob: { boss: boolean }) => mob.boss);
    const boss = inst.mobIds
      .map((id: number) => sim.entities.get(id) as Entity)
      .find((mob: Entity) => mob.templateId === `source_cave_${bossSpec.login}`) as Entity;
    const rebootYells = events.filter(
      (event: { type: string; channel?: string; text?: string; fromPid?: number }) =>
        event.type === 'chat' && event.channel === 'yell' && event.text === 'What have you done?!',
    );
    expect(rebootYells).toHaveLength(1);
    expect(rebootYells[0]).toMatchObject({ fromPid: boss.id, from: boss.name });

    for (let i = 0; i < 80; i++) sim.tick();
    for (const mobId of inst.mobIds) {
      const mob = sim.entities.get(mobId) as Entity;
      if (inst.sourceCaveEncounter.activeMobIds.has(mobId)) {
        expect(['chase', 'attack']).toContain(mob.aiState);
        expect(mob.aggroTargetId).toBe(pid);
      } else {
        expect(mob.aiState).toBe('idle');
        expect(mob.aggroTargetId).toBeNull();
        // Dormant cohorts no longer hold their home ring seat: they march onto
        // the encirclement ring around the seal (the button sits at its centre).
        // Four seconds in at normal speed they are en route or arrived, so their
        // distance to the ring must have shrunk from the spawn seat's.
        const toRing = (x: number, z: number) =>
          Math.abs(Math.hypot(x - button.pos.x, z - button.pos.z) - SOURCE_CAVE_ENCIRCLE_RADIUS);
        const ringErr = toRing(mob.pos.x, mob.pos.z);
        const spawnRingErr = toRing(mob.spawnPos.x, mob.spawnPos.z);
        expect(ringErr).toBeLessThan(Math.max(1, spawnRingErr));
      }
    }

    const dormantWave = inst.sourceCaveEncounter.waves.find(
      (wave: number[], index: number) =>
        !inst.sourceCaveEncounter.activatedWaves.has(index) && wave.length > 0,
    );
    const dormant = sim.entities.get(dormantWave[0]) as Entity;
    sim.dealDamage(p, dormant, 1, false, 'physical', null, 'hit');
    expect(
      dormantWave.every((id: number) => {
        const mob = sim.entities.get(id) as Entity;
        return (mob.aiState === 'chase' || mob.aiState === 'attack') && mob.aggroTargetId === pid;
      }),
    ).toBe(true);
  });

  it('the two strongest non-boss contributors react in a staggered chorus after the boss', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Alice');
    sim.setPlayerLevel(20, pid);
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
    const p = sim.entities.get(pid) as Entity;
    const inst = claimedCave(sim);
    const buttonId = inst.objectIds.find(
      (id: number) => sim.entities.get(id)?.templateId === SOURCE_CAVE_REBOOT_TEMPLATE,
    );
    const button = sim.entities.get(buttonId) as Entity;
    teleport(sim, p, button.pos.x, button.pos.z - 3);
    p.targetId = null;
    sim.interact(pid);

    // spec.mobs is ordered strongest non-boss first (spec.ts outputOrder), so
    // [0]/[1] are the reactors; the boss spoke immediately on the press. Chat
    // events carry the display name, which yields to a custom-attributes
    // override when one exists.
    const spec = sim.sourceCave.spec;
    const reactorNames = [spec.mobs[0], spec.mobs[1]].map(
      (m) => sourceCaveMobCustomAttributesForLogin(m.login)?.name ?? m.login,
    );
    expect(spec.mobs[0].boss || spec.mobs[1].boss).toBe(false);

    type ChatEv = { type: string; channel?: string; text?: string; from?: string };
    const yells: ChatEv[] = [];
    // 4 in-game seconds cover both staggered delays (1.4s / 2.8s).
    for (let i = 0; i < 20 * 4; i++) {
      for (const ev of sim.tick() as ChatEv[]) {
        if (ev.type === 'chat' && ev.channel === 'yell') yells.push(ev);
      }
    }
    const whatsGoingOn = yells.filter((ev) => ev.text === "Hey, what's going on?");
    const serverDown = yells.filter((ev) => ev.text === 'Guys, the server is down!');
    expect(whatsGoingOn).toHaveLength(1);
    expect(whatsGoingOn[0].from).toBe(reactorNames[0]);
    expect(serverDown).toHaveLength(1);
    expect(serverDown[0].from).toBe(reactorNames[1]);
  });

  it('a reactor killed before its line fires stays silent (the delayed-yell guard)', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Alice');
    sim.setPlayerLevel(20, pid);
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
    const p = sim.entities.get(pid) as Entity;
    const inst = claimedCave(sim);
    const buttonId = inst.objectIds.find(
      (id: number) => sim.entities.get(id)?.templateId === SOURCE_CAVE_REBOOT_TEMPLATE,
    );
    const button = sim.entities.get(buttonId) as Entity;
    teleport(sim, p, button.pos.x, button.pos.z - 3);
    p.targetId = null;
    sim.interact(pid);

    // Kill the SECOND reactor (the +2.8s "server is down" speaker) right after
    // the press, before its delayed line fires.
    const spec = sim.sourceCave.spec;
    const reactor = inst.mobIds
      .map((id: number) => sim.entities.get(id) as Entity)
      .find((e: Entity) => e.templateId === `source_cave_${spec.mobs[1].login}`) as Entity;
    reactor.dead = true;
    reactor.hp = 0;

    type ChatEv = { type: string; channel?: string; text?: string };
    const yells: ChatEv[] = [];
    for (let i = 0; i < 20 * 4; i++) {
      for (const ev of sim.tick() as ChatEv[]) {
        if (ev.type === 'chat' && ev.channel === 'yell') yells.push(ev);
      }
    }
    // The living first reactor still speaks; the dead one is dropped by the guard.
    expect(yells.some((ev) => ev.text === "Hey, what's going on?")).toBe(true);
    expect(yells.some((ev) => ev.text === 'Guys, the server is down!')).toBe(false);
  });

  it('keeps a full ten-player raid safe while it musters around the button', () => {
    const sim = makeSim();
    const leader = sim.addPlayer('warrior', 'Leader');
    const members = Array.from({ length: 9 }, (_, i) => sim.addPlayer('priest', `Raid${i + 1}`));
    const raid = [leader, ...members];
    for (const pid of raid) sim.setPlayerLevel(20, pid);

    for (const pid of members.slice(0, 4)) {
      sim.partyInvite(pid, leader);
      sim.partyAccept(pid);
    }
    sim.convertPartyToRaid(leader);
    for (const pid of members.slice(4)) {
      sim.partyInvite(pid, leader);
      sim.partyAccept(pid);
    }
    expect(sim.partyOf(leader)).toMatchObject({ raid: true, members: raid });

    for (const pid of raid) sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
    const key = sim.ctx.instanceKeyFor(leader);
    const claimedInstances = sim.instances.filter(
      (i: { dungeonId: string; partyKey: string | null }) =>
        i.dungeonId === SOURCE_CAVE_DUNGEON_ID && i.partyKey === key,
    );
    expect(claimedInstances).toHaveLength(1);
    const inst = claimedInstances[0];
    const buttonId = inst.objectIds.find(
      (id: number) => sim.entities.get(id)?.templateId === SOURCE_CAVE_REBOOT_TEMPLATE,
    );
    const button = sim.entities.get(buttonId) as Entity;

    const musterRadius = 5;
    for (let i = 0; i < raid.length; i++) {
      const player = sim.entities.get(raid[i]) as Entity;
      const radius = i === 0 ? INTERACT_RANGE - 0.5 : musterRadius;
      const angle = (i / raid.length) * Math.PI * 2;
      teleport(
        sim,
        player,
        button.pos.x + Math.cos(angle) * radius,
        button.pos.z + Math.sin(angle) * radius,
      );
      player.targetId = null;
    }

    sim.interact(leader);
    for (let i = 0; i < 80; i++) sim.tick();

    expect(inst.mobIds.every((id: number) => sim.entities.get(id)?.hostile)).toBe(true);
    expect(inst.sourceCaveEncounter.activatedWaves).toEqual(new Set([0]));
    expect(inst.sourceCaveEncounter.activeMobIds.size).toBe(
      inst.sourceCaveEncounter.waves[0].length,
    );
    expect(
      inst.mobIds.every((id: number) => {
        const mob = sim.entities.get(id) as Entity;
        return inst.sourceCaveEncounter.activeMobIds.has(id)
          ? mob.aiState === 'chase' || mob.aiState === 'attack'
          : mob.aiState === 'idle' && mob.aggroTargetId === null && !mob.inCombat;
      }),
    ).toBe(true);
    expect(musterRadius).toBeLessThan(SOURCE_CAVE_REBOOT_SAFE_RADIUS);
  });

  it('an aggressive pet does not auto-pull the surrounding roster while its owner is at the button', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warlock', 'Demonist');
    sim.setPlayerLevel(20, pid);
    const player = sim.entities.get(pid) as Entity;
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
    sim.summonPet(player, 'emberkin');
    sim.setPetMode('aggressive', pid);
    const pet = sim.petOf(pid) as Entity;
    const inst = claimedCave(sim);
    const buttonId = inst.objectIds.find(
      (id: number) => sim.entities.get(id)?.templateId === SOURCE_CAVE_REBOOT_TEMPLATE,
    );
    const button = sim.entities.get(buttonId) as Entity;
    teleport(sim, player, button.pos.x, button.pos.z);
    teleport(sim, pet, button.pos.x, button.pos.z);

    sim.interact(pid);
    sim.tick();

    expect(pet.aggroTargetId).toBeNull();
    expect(inst.mobIds.every((id: number) => sim.entities.get(id)?.aggroTargetId === null)).toBe(
      true,
    );
  });

  it('activates only the claimed instance that owns the pressed button', () => {
    const sim = makeSim();
    const alice = sim.addPlayer('warrior', 'Alice');
    const bob = sim.addPlayer('warrior', 'Bob');
    sim.setPlayerLevel(20, alice);
    sim.setPlayerLevel(20, bob);
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, alice);
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, bob);
    const aliceKey = sim.ctx.instanceKeyFor(alice);
    const bobKey = sim.ctx.instanceKeyFor(bob);
    const aliceInst = sim.instances.find(
      (i: { dungeonId: string; partyKey: string | null }) =>
        i.dungeonId === SOURCE_CAVE_DUNGEON_ID && i.partyKey === aliceKey,
    );
    const bobInst = sim.instances.find(
      (i: { dungeonId: string; partyKey: string | null }) =>
        i.dungeonId === SOURCE_CAVE_DUNGEON_ID && i.partyKey === bobKey,
    );
    const buttonId = aliceInst.objectIds.find(
      (id: number) => sim.entities.get(id)?.templateId === SOURCE_CAVE_REBOOT_TEMPLATE,
    );
    const button = sim.entities.get(buttonId) as Entity;
    const player = sim.entities.get(alice) as Entity;
    teleport(sim, player, button.pos.x, button.pos.z);
    player.targetId = null;

    sim.interact(alice);

    expect(aliceInst.mobIds.every((id: number) => sim.entities.get(id)?.hostile)).toBe(true);
    expect(bobInst.mobIds.every((id: number) => !sim.entities.get(id)?.hostile)).toBe(true);
    expect(
      bobInst.objectIds.some(
        (id: number) => sim.entities.get(id)?.templateId === SOURCE_CAVE_REBOOT_TEMPLATE,
      ),
    ).toBe(true);
  });
});

describe('source cave: door trigger and exit portal (end to end)', () => {
  it('the well requires interacting through its banter gate (no walk-in teleport)', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Alice');
    sim.setPlayerLevel(20, pid);
    const p = sim.entities.get(pid) as Entity;
    const door = sim.entities.get(SOURCE_CAVE_DOOR_ID) as Entity;

    teleport(sim, p, door.pos.x, door.pos.z);
    updateDoorTriggers(sim.ctx, p);
    expect(isSourceCavePos(p.pos.x)).toBe(false);
  });

  it('interacting past the banter gate enters, walking onto the exit leaves', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Alice');
    sim.setPlayerLevel(20, pid);
    const p = sim.entities.get(pid) as Entity;
    const door = sim.entities.get(SOURCE_CAVE_DOOR_ID) as Entity;
    teleport(sim, p, door.pos.x, door.pos.z);

    // 10 banter lines, then the interaction past the last one opens the well.
    for (let i = 0; i <= SOURCE_CAVE_WELL_BANTER_LINES.length; i++) sim.interact(pid);
    expect(isSourceCavePos(p.pos.x)).toBe(true);
    const inst = claimedCave(sim);
    expect(inst).toBeDefined();

    // Walk onto the exit portal: back to the overworld door (the interior exit
    // is unaffected by the well's banter gate).
    const exit = sim.entities.get(inst.exitId) as Entity;
    teleport(sim, p, exit.pos.x, exit.pos.z);
    updateDoorTriggers(sim.ctx, p);
    expect(isSourceCavePos(p.pos.x)).toBe(false);
  });
});

describe('source cave: colliders from the delve module path', () => {
  it('resolveMove keeps a cave mover inside the module side walls', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Alice');
    sim.setPlayerLevel(20, pid);
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
    const p = sim.entities.get(pid) as Entity;
    const inst = claimedCave(sim);
    const origin = sourceCaveOrigin(inst.slot);

    // Try to walk far past the side wall (module-local |x| = 85, outer face ~86).
    const resolved = sim.resolveMove(p.pos.x, p.pos.z, origin.x + 200, p.pos.z, 0.5, p, false);
    expect(resolved.x).toBeLessThan(origin.x + 87);
  });
});

describe('source cave: death uses the dungeon model, not the delve no-op', () => {
  it('a player killed in the cave releases as a ghost to the overworld (no soft-lock)', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Alice');
    sim.setPlayerLevel(20, pid);
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
    const p = sim.entities.get(pid) as Entity;
    expect(isSourceCavePos(p.pos.x)).toBe(true);

    p.dead = true; // simulate a mob kill inside the cave
    releasePlayerSpirit(sim.ctx, pid);

    // The cave is a dungeon, not a delve: releaseSpiritInDelve would no-op here (no
    // DelveRun) and leave the corpse stuck dead-and-immobile. Instead the ghost run
    // fires: the spirit is released out to an overworld graveyard.
    expect(p.ghost).toBe(true);
    expect(isSourceCavePos(p.pos.x)).toBe(false);
    expect(isDelvePos(p.pos.x)).toBe(false);

    // And a ghost can walk back into the cave to corpse-run (entry allows ghosts).
    const door = sim.entities.get(SOURCE_CAVE_DOOR_ID) as Entity;
    teleport(sim, p, door.pos.x, door.pos.z);
    updateDoorTriggers(sim.ctx, p);
    expect(isSourceCavePos(p.pos.x)).toBe(true);
    // Its corpse lies in this same copy, so the interior corpse run continues.
    expect(p.ghost).toBe(true);
  });

  it('a ghost interacting with the well re-enters (no banter, no dead-gate refusal)', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Alice');
    sim.setPlayerLevel(20, pid);
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
    const p = sim.entities.get(pid) as Entity;
    p.dead = true; // simulate a mob kill inside the cave
    releasePlayerSpirit(sim.ctx, pid);
    expect(p.ghost).toBe(true);

    // The ghost stands at CLICK range from the well, outside the 2u walk-in
    // trigger, and presses interact with the well targeted: the discoverable
    // way back in must work, not answer "You can't do that while dead."
    const door = sim.entities.get(SOURCE_CAVE_DOOR_ID) as Entity;
    teleport(sim, p, door.pos.x, door.pos.z + 3);
    p.targetId = door.id;
    sim.interact(pid);
    expect(isSourceCavePos(p.pos.x)).toBe(true);
    expect(p.ghost).toBe(true); // corpse in this copy: the interior corpse run continues
  });

  it('an untargeted ghost interact near the well also re-enters', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Alice');
    sim.setPlayerLevel(20, pid);
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
    const p = sim.entities.get(pid) as Entity;
    p.dead = true; // simulate a mob kill inside the cave
    releasePlayerSpirit(sim.ctx, pid);

    const door = sim.entities.get(SOURCE_CAVE_DOOR_ID) as Entity;
    teleport(sim, p, door.pos.x, door.pos.z + 3);
    p.targetId = null;
    sim.interact(pid);
    expect(isSourceCavePos(p.pos.x)).toBe(true);
  });

  it('a ghost whose corpse is in a stale freed copy is revived at the entry instead', () => {
    const sim = makeSim();
    const alice = sim.addPlayer('warrior', 'Alice');
    const bob = sim.addPlayer('warrior', 'Bob');
    sim.setPlayerLevel(20, alice);
    sim.setPlayerLevel(20, bob);
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, alice);
    const pa = sim.entities.get(alice) as Entity;
    const claimedSlot = claimedCave(sim).slot;

    pa.dead = true; // simulate a mob kill inside the cave
    releasePlayerSpirit(sim.ctx, alice);
    expect(pa.corpsePos).not.toBeNull();

    // The copy sits empty during the disconnect and is freed after the timeout.
    for (let i = 0; i < 20 * (INSTANCE_EMPTY_TIMEOUT + 5); i++) sim.tick();
    expect(claimedCave(sim)).toBeUndefined();

    // Another group claims the freed slot, so Alice's re-entry lands in a
    // different copy while her corpse coordinates point at Bob's.
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, bob);
    expect(claimedCave(sim).slot).toBe(claimedSlot);

    const door = sim.entities.get(SOURCE_CAVE_DOOR_ID) as Entity;
    teleport(sim, pa, door.pos.x, door.pos.z);
    updateDoorTriggers(sim.ctx, pa);

    // Her corpse is unreachable, so re-entry resurrects her at the entry the way
    // every static dungeon does, instead of stranding a corpseless ghost inside.
    expect(isSourceCavePos(pa.pos.x)).toBe(true);
    expect(pa.dead).toBe(false);
    expect(pa.ghost).toBe(false);
    expect(pa.corpsePos).toBeNull();
    expect(pa.hp).toBeGreaterThan(0);
  });

  it('a ghost inside the cave walks out through the exit portal (no soft-lock)', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Alice');
    sim.setPlayerLevel(20, pid);
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
    const p = sim.entities.get(pid) as Entity;

    p.dead = true; // simulate a mob kill inside the cave
    releasePlayerSpirit(sim.ctx, pid);
    const door = sim.entities.get(SOURCE_CAVE_DOOR_ID) as Entity;
    teleport(sim, p, door.pos.x, door.pos.z);
    updateDoorTriggers(sim.ctx, p);
    expect(isSourceCavePos(p.pos.x)).toBe(true);

    // The cave is the one dungeon a ghost exists INSIDE of (entry does not
    // resurrect, the corpse run ends at the body). If its corpse is gone (a
    // freed copy after a disconnect), the exit portal must still let it out.
    p.corpsePos = null;
    const inst = claimedCave(sim);
    const exit = sim.entities.get(inst.exitId) as Entity;
    teleport(sim, p, exit.pos.x, exit.pos.z);
    updateDoorTriggers(sim.ctx, p);
    expect(isSourceCavePos(p.pos.x)).toBe(false);
    expect(p.ghost).toBe(true); // still a ghost: the overworld Spirit Healer is the way back
  });
});

describe('source cave: determinism and roster injection', () => {
  it('same seed and roster produce an identical cave and identical spawns', () => {
    const a = makeSim(undefined, 777);
    const b = makeSim(undefined, 777);
    expect(a.sourceCave.spec).toEqual(b.sourceCave.spec);

    const pa = a.addPlayer('warrior', 'A');
    const pb = b.addPlayer('warrior', 'B');
    a.setPlayerLevel(20, pa);
    b.setPlayerLevel(20, pb);
    a.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pa);
    b.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pb);

    const snap = (sim: AnySim) => {
      const inst = claimedCave(sim);
      return inst.mobIds
        .map((id: number) => {
          const e = sim.entities.get(id) as Entity;
          return { name: e.name, level: e.level, maxHp: e.maxHp, x: e.pos.x, z: e.pos.z };
        })
        .sort((x: { name: string }, y: { name: string }) => (x.name < y.name ? -1 : 1));
    };
    expect(snap(a)).toEqual(snap(b));
  });

  it('a custom roster injected via SimConfig overrides the placeholder', () => {
    const custom: SourceCaveRosterEntry[] = [
      { login: 'alpha', mergedPrs: 90, rank: 1 },
      { login: 'bravo', mergedPrs: 8, rank: 2 },
      { login: 'charlie', mergedPrs: 0, rank: 3 },
    ];
    const sim = makeSim(custom, 55);
    const logins = sim.sourceCave.spec.mobs.map((m: { login: string }) => m.login).sort();
    expect(logins).toEqual(['alpha', 'bravo', 'charlie']);
    // The cave is always the single arena room, regardless of roster size.
    expect(sim.sourceCave.spec.modules.length).toBe(1);

    const pid = sim.addPlayer('warrior', 'Alice');
    sim.setPlayerLevel(20, pid);
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
    const inst = claimedCave(sim);
    const names = inst.mobIds.map((id: number) => (sim.entities.get(id) as Entity).name).sort();
    expect(names).toEqual(['alpha', 'bravo', 'charlie']);
  });
});

describe('source cave: mob model by dev tier', () => {
  // One contributor per DEV_TIER_DEFS rung (thresholds 1/5/15/30/70), plus a
  // zero-merged-PR contributor (devTier index 0, no rung).
  const TIER_ROSTER: SourceCaveRosterEntry[] = [
    { login: 'tinkerer', mergedPrs: 1, rank: 6 },
    { login: 'artificer', mergedPrs: 5, rank: 5 },
    { login: 'runesmith', mergedPrs: 15, rank: 4 },
    { login: 'architect', mergedPrs: 30, rank: 3 },
    { login: 'worldwright', mergedPrs: 70, rank: 1 },
    { login: 'newcomer', mergedPrs: 0, rank: 7 },
  ];

  function spawnTierRoster(): { sim: AnySim; mobs: Map<string, Entity> } {
    const sim = makeSim(TIER_ROSTER, 777);
    const pid = sim.addPlayer('warrior', 'Alice');
    sim.setPlayerLevel(20, pid);
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
    const inst = claimedCave(sim);
    const mobs = new Map<string, Entity>();
    for (const id of inst.mobIds) {
      const e = sim.entities.get(id) as Entity;
      mobs.set(e.name, e);
    }
    return { sim, mobs };
  }

  it('picks a generated dev body per rung: noob, gamer, druid, hunter, hacker', () => {
    // Every rung wears a pipeline-generated dev body (manifest.ts). The armed
    // rigs (hacker_druid, coder_hunter) render the per-mob mainhand (wire `mh`)
    // through their weapon slot, with the VisualDef attach as the anchor and
    // fallback; the dev_* rigs are unarmed by design.
    const { mobs } = spawnTierRoster();
    expect(mobs.get('tinkerer')?.visualKey).toBe('dev_noob');
    expect(mobs.get('artificer')?.visualKey).toBe('dev_gamer');
    expect(mobs.get('runesmith')?.visualKey).toBe('hacker_druid');
    expect(mobs.get('architect')?.visualKey).toBe('coder_hunter');
    expect(mobs.get('worldwright')?.visualKey).toBe('dev_hacker');
  });

  it('a contributor below the first rung still gets a dev body (never the bandit fallback)', () => {
    const { mobs } = spawnTierRoster();
    expect(mobs.get('newcomer')?.visualKey).toBe('dev_noob');
  });

  it('visualKeyFor resolves the override for every rung, matching the entity field', () => {
    const { mobs } = spawnTierRoster();
    for (const login of [
      'tinkerer',
      'artificer',
      'runesmith',
      'architect',
      'worldwright',
      'newcomer',
    ]) {
      const e = mobs.get(login) as Entity;
      expect(visualKeyFor(e)).toBe(e.visualKey);
    }
  });

  it('arms only the weapon tiers: commit blade on architects, the runesmith hash split', () => {
    const { mobs } = spawnTierRoster();
    // Unarmed rungs stay null (their dev_* rigs have no weapon slot).
    for (const login of ['worldwright', 'artificer', 'tinkerer', 'newcomer']) {
      expect(mobs.get(login)?.mainhandItemId, login).toBe(null);
    }
    expect(mobs.get('architect')?.mainhandItemId).toBe('commit_blade');
    // The 'runesmith' login hashes onto the hammer bucket; the split itself is
    // pinned over the real roster below.
    expect(mobs.get('runesmith')?.mainhandItemId).toBe('bug_squasher');
  });

  it('splits the real runesmith cohort between both weapons, stable per login', () => {
    // The live roster carries seven contributors at the runesmith rung; the
    // login hash fans them across BOTH weapons (a one-weapon cohort would mean
    // the split regressed to a constant), and re-paces each swing at constant dps.
    const runesmiths = SOURCE_CAVE_PLACEHOLDER_ROSTER.filter(
      (r: SourceCaveRosterEntry) => r.mergedPrs >= 15 && r.mergedPrs < 30,
    );
    expect(runesmiths.length).toBe(7);
    const byWeapon = new Map<string, string[]>();
    for (const r of runesmiths) {
      const weapon = sourceCaveTierWeaponForLogin('runesmith', r.login);
      expect(weapon, r.login).not.toBeNull();
      if (!weapon) continue;
      byWeapon.set(weapon.itemId, [...(byWeapon.get(weapon.itemId) ?? []), r.login]);
      // Same login, same weapon on every call (no rng in the assignment).
      expect(sourceCaveTierWeaponForLogin('runesmith', r.login)).toEqual(weapon);
    }
    expect([...byWeapon.keys()].sort()).toEqual(['bug_squasher', 'mech_keyboard']);
    // The current roster splits 3/3; a roster change may shift this, both
    // buckets staying populated is the contract.
    for (const logins of byWeapon.values()) expect(logins.length).toBeGreaterThan(0);
    // The re-paced swing speeds ride the assignment.
    expect(sourceCaveTierWeaponForLogin('runesmith', 'gndk')).toEqual({
      itemId: 'mech_keyboard',
      attackSpeed: 2.2,
    });
    expect(sourceCaveTierWeaponForLogin('runesmith', 'patrick261')).toEqual({
      itemId: 'bug_squasher',
      attackSpeed: 2.6,
    });
  });

  it('the worldwright rung still reads distinctly: golden tint, larger scale, its own rig', () => {
    const { mobs } = spawnTierRoster();
    const architect = mobs.get('architect') as Entity;
    const worldwright = mobs.get('worldwright') as Entity;
    expect(worldwright.visualKey).not.toBe(architect.visualKey);
    expect(worldwright.color).not.toBe(architect.color);
    expect(worldwright.scale).toBeGreaterThan(architect.scale);
  });
});

describe('source cave: tier combat affixes resolve through mobTemplateOf', () => {
  // One contributor per armed rung plus a swarm-tier control; rank 1 is the boss.
  const AFFIX_ROSTER: SourceCaveRosterEntry[] = [
    { login: 'boss', mergedPrs: 90, rank: 1 },
    { login: 'archie', mergedPrs: 30, rank: 2 },
    { login: 'runa', mergedPrs: 15, rank: 3 },
    { login: 'arti', mergedPrs: 5, rank: 4 },
    { login: 'tink', mergedPrs: 1, rank: 5 },
  ];

  function spawnAffixRoster(): { sim: AnySim; mobs: Map<string, Entity>; pid: number } {
    const sim = makeSim(AFFIX_ROSTER, 4242);
    const pid = sim.addPlayer('warrior', 'Alice');
    sim.setPlayerLevel(20, pid);
    sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, pid);
    const inst = claimedCave(sim);
    const mobs = new Map<string, Entity>();
    for (const id of inst.mobIds) {
      const e = sim.entities.get(id) as Entity;
      mobs.set(e.name, e);
    }
    return { sim, mobs, pid };
  }

  it('assigns one swing mechanic per rung, cited names, none on the swarm tier', () => {
    const { sim } = spawnAffixRoster();
    const byLogin = new Map<string, MobTemplate>(
      sim.sourceCave.templates.map((t: MobTemplate) => [t.id.replace('source_cave_', ''), t]),
    );
    expect(byLogin.get('arti')?.bleed?.name).toBe('Merge Conflict');
    expect(byLogin.get('runa')?.arcaneRot?.name).toBe('Tech Debt');
    expect(byLogin.get('runa')?.arcaneRot?.school).toBe('arcane');
    expect(byLogin.get('archie')?.cleave).toEqual({
      radius: 6,
      mult: 0.45,
      name: 'Sweeping Refactor',
    });
    expect(byLogin.get('boss')?.rampage?.name).toBe('Feature Creep');
    // Enrage is the BOSS bump, not a worldwright rung property.
    expect(byLogin.get('boss')?.enrage).toEqual({
      belowHpPct: 0.25,
      dmgMult: 1.45,
      hasteMult: 1.25,
    });
    const tink = byLogin.get('tink') as MobTemplate;
    expect(tink.bleed).toBeUndefined();
    expect(tink.arcaneRot).toBeUndefined();
    expect(tink.cleave).toBeUndefined();
    expect(tink.rampage).toBeUndefined();
    expect(tink.enrage).toBeUndefined();
  });

  it('normalizes Tech Debt proc frequency across both runesmith weapon speeds', () => {
    const sim = makeSim(
      [
        { login: 'boss', mergedPrs: 90, rank: 1 },
        { login: 'gndk', mergedPrs: 15, rank: 2 },
        { login: 'patrick261', mergedPrs: 15, rank: 3 },
      ],
      4242,
    );
    const byLogin = new Map<string, MobTemplate>(
      sim.sourceCave.templates.map((template: MobTemplate) => [
        template.id.replace('source_cave_', ''),
        template,
      ]),
    );
    const fast = byLogin.get('gndk');
    const slow = byLogin.get('patrick261');
    if (!fast?.arcaneRot || !slow?.arcaneRot) throw new Error('runesmith rot missing');
    expect(fast.attackSpeed).toBe(2.2);
    expect(slow.attackSpeed).toBe(2.6);
    expect(fast.arcaneRot.chance / fast.attackSpeed).toBeCloseTo(
      slow.arcaneRot.chance / slow.attackSpeed,
      12,
    );
  });

  it('a landed artificer swing applies the Merge Conflict bleed through the live cascade', () => {
    const { sim, mobs, pid } = spawnAffixRoster();
    const arti = mobs.get('arti') as Entity;
    const player = sim.entities.get(pid) as Entity;
    arti.hostile = true; // dormant contributors flip hostile at reboot
    vi.spyOn(sim.ctx.rng, 'chance').mockReturnValue(true);
    runMobSwingAffixes(sim.ctx, arti, player, { dealt: 10, crit: false, rawDmg: 10 });
    vi.restoreAllMocks();
    const bleed = player.auras.find((a: Aura) => a.name === 'Merge Conflict');
    expect(bleed).toBeDefined();
    expect(bleed?.kind).toBe('dot');
  });

  it('a landed runesmith swing applies the arcane Tech Debt rot', () => {
    const { sim, mobs, pid } = spawnAffixRoster();
    const runa = mobs.get('runa') as Entity;
    const player = sim.entities.get(pid) as Entity;
    runa.hostile = true;
    vi.spyOn(sim.ctx.rng, 'chance').mockReturnValue(true);
    runMobSwingAffixes(sim.ctx, runa, player, { dealt: 10, crit: false, rawDmg: 10 });
    vi.restoreAllMocks();
    const rot = player.auras.find((a: Aura) => a.name === 'Tech Debt');
    expect(rot).toBeDefined();
    expect(rot?.school).toBe('arcane');
  });

  it('an architect cleave splashes the second player stacked on the primary target', () => {
    const { sim, mobs, pid } = spawnAffixRoster();
    const archie = mobs.get('archie') as Entity;
    const primary = sim.entities.get(pid) as Entity;
    const otherPid = sim.addPlayer('priest', 'Bob');
    sim.setPlayerLevel(20, otherPid);
    const other = sim.entities.get(otherPid) as Entity;
    teleport(sim, other, primary.pos.x + 2, primary.pos.z);
    archie.hostile = true;
    const hpBefore = other.hp;
    runMobSwingAffixes(sim.ctx, archie, primary, { dealt: 80, crit: false, rawDmg: 100 });
    expect(other.hp).toBeLessThan(hpBefore);
  });

  it('the boss enrages below 25% hp: flag set, faster swings', () => {
    const { sim, mobs } = spawnAffixRoster();
    const boss = mobs.get('boss') as Entity;
    // The rank-1 contributor is the boss (template flag; entities do not copy it).
    expect(sim.sourceCave.templates.find((t: MobTemplate) => t.id === boss.templateId)?.boss).toBe(
      true,
    );
    boss.hp = Math.floor(boss.maxHp * 0.2);
    (sim as unknown as { updateBossMechanics(m: Entity): void }).updateBossMechanics(boss);
    expect(boss.enraged).toBe(true);
    // hasteMult 1.25 divides the swing interval (sim.swingIntervalMult reads the
    // synthetic template through mobTemplateOf).
    expect(sim.swingIntervalMult(boss)).toBeCloseTo(1 / 1.25, 10);
  });

  it('both DoT names are registered aura names (localized frames, not raw English)', () => {
    expect(localizeSimAuraName('Merge Conflict')).not.toBeNull();
    expect(localizeSimAuraName('Tech Debt')).not.toBeNull();
  });

  it('mobTemplateOf: exact MOBS object identity for regular mobs, cave fallback for synthetics', () => {
    const { sim, mobs } = spawnAffixRoster();
    // A regular mob resolves to the very MOBS table object (no wrapper, no
    // copy), which is what keeps every non-cave combat path byte-identical.
    const regular = [...sim.entities.values()].find(
      (e: Entity) => e.kind === 'mob' && MOBS[e.templateId],
    ) as Entity;
    expect(mobTemplateOf(sim.ctx, regular)).toBe(MOBS[regular.templateId]);
    // A cave mob resolves through the runtime fallback to its synthetic template.
    const runa = mobs.get('runa') as Entity;
    expect(MOBS[runa.templateId]).toBeUndefined();
    expect(mobTemplateOf(sim.ctx, runa)).toBe(
      sim.sourceCave.templates.find((t: MobTemplate) => t.id === runa.templateId),
    );
  });
});
