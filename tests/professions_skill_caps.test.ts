// Professions 2.0 Phase 12c stage 2: enforced per-profession skill caps as
// content data. Every profession record carries maxSkill (crafts and
// enchanting 125, mining/logging/herbalism 100, fishing 200), enforced at all
// four arms: gainCraftSkill (gain time, covering crafting, enchanting, and
// the battlefield trickle), drainGatheringGrants (the gathering drain),
// normalizeCraftSkills (load time crafts), and normalizeGatheringProficiency
// (load time gathering, the legacy professions-key shape included). At cap,
// actions still resolve, proc, and yield: only skill gain stops.
import { describe, expect, it } from 'vitest';
import { GATHER_NODES } from '../src/sim/content/gather_nodes';
import {
  CRAFT_RING,
  craftMaxSkillFor,
  GATHERING_PROFESSIONS,
} from '../src/sim/content/professions';
import { recipeById } from '../src/sim/content/recipes';
import { LAKE } from '../src/sim/data';
import { battlefieldExperienceTrickle } from '../src/sim/professions/battlefield_xp';
import { resolveCraftForRecipe } from '../src/sim/professions/crafting';
import { completeFishing } from '../src/sim/professions/fishing';
import {
  drainGatheringGrants,
  emptyGatheringProficiency,
  nodeMaterialFor,
  normalizeGatheringProficiency,
  queueGatheringGrant,
} from '../src/sim/professions/gathering';
import {
  emptyCraftSkills,
  gainCraftSkill,
  normalizeCraftSkills,
} from '../src/sim/professions/wheel';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import { terrainHeight } from '../src/sim/world';

const NODE = GATHER_NODES[0]; // ore_eastbrook_1, tier 1
const NODE_MATERIAL = nodeMaterialFor(NODE.type, NODE.zoneId);

const mustMeta = (sim: Sim, pid: number): PlayerMeta => {
  const meta = (sim as any).players.get(pid);
  if (!meta) throw new Error(`missing player meta ${pid}`);
  return meta;
};

describe('cap literals as content data (Phase 12c stage 2)', () => {
  it('every craft on the ring, enchanting included, caps at 125', () => {
    for (const craft of CRAFT_RING) expect(craft.maxSkill).toBe(125);
  });

  it('craftMaxSkillFor reads the CRAFT_RING record (pinned for two crafts, enchanting included)', () => {
    expect(craftMaxSkillFor('enchanting')).toBe(125);
    expect(craftMaxSkillFor('weaponcrafting')).toBe(125);
    expect(() => craftMaxSkillFor('not_a_craft')).toThrow();
  });

  it('gathering caps: mining, logging, herbalism at 100; fishing at 200', () => {
    expect(GATHERING_PROFESSIONS.mining.maxSkill).toBe(100);
    expect(GATHERING_PROFESSIONS.logging.maxSkill).toBe(100);
    expect(GATHERING_PROFESSIONS.herbalism.maxSkill).toBe(100);
    expect(GATHERING_PROFESSIONS.fishing.maxSkill).toBe(200);
  });
});

describe('arm 1: gainCraftSkill clamps at the craft cap', () => {
  it('a gain crossing the cap lands exactly at 125, never past it', () => {
    const skills = emptyCraftSkills();
    skills.enchanting = 124.9;
    gainCraftSkill(skills, 'enchanting', 10);
    expect(skills.enchanting).toBe(125);
  });

  it('an under-cap gain is untouched by the clamp', () => {
    const skills = emptyCraftSkills();
    gainCraftSkill(skills, 'cooking', 7);
    expect(skills.cooking).toBe(7);
  });
});

describe('arm 2: the gathering drain clamps at the profession cap', () => {
  it('a queued grant that would cross 100 drains to exactly 100 (mining)', () => {
    const meta: any = {
      pendingGatherGrants: [],
      gatheringProficiency: emptyGatheringProficiency(),
    };
    meta.gatheringProficiency.mining = 98;
    queueGatheringGrant(meta, 'mining', 5);
    drainGatheringGrants(meta);
    expect(meta.gatheringProficiency.mining).toBe(100);
  });

  it('a queued fishing grant that would cross 200 drains to exactly 200', () => {
    const meta: any = {
      pendingGatherGrants: [],
      gatheringProficiency: emptyGatheringProficiency(),
    };
    meta.gatheringProficiency.fishing = 195;
    queueGatheringGrant(meta, 'fishing', 50);
    drainGatheringGrants(meta);
    expect(meta.gatheringProficiency.fishing).toBe(200);
  });
});

describe('arm 3: normalizeCraftSkills clamps an over-cap save DOWN to the craft cap', () => {
  it('a 300-skill save row loads at 125; in-range rows pass through', () => {
    const skills = normalizeCraftSkills({ weaponcrafting: 300, cooking: 60 });
    expect(skills.weaponcrafting).toBe(125);
    expect(skills.cooking).toBe(60);
  });
});

describe('arm 4: normalizeGatheringProficiency clamps an over-cap save DOWN to the profession cap', () => {
  it('mining 300 loads at 100, fishing 300 at 200', () => {
    expect(normalizeGatheringProficiency({ mining: 300, fishing: 300 })).toEqual({
      mining: 100,
      logging: 0,
      herbalism: 0,
      fishing: 200,
    });
  });

  it('a sim-level load from a legacy professions-key-only CharacterState clamps the same way', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    const state = (sim as any).serializeCharacter(sim.playerId);
    // A pre-rename save carries only the legacy `professions` key; the sim.ts
    // call site feeds it through the same normalize (gatheringProficiency ??
    // professions), so the clamp covers this shape too.
    delete state.gatheringProficiency;
    state.professions = { mining: 300, logging: 0, herbalism: 0, fishing: 300 };

    const sim2 = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim2.addPlayer('warrior', 'LegacyOvercap', { state });
    expect(mustMeta(sim2, pid).gatheringProficiency).toEqual({
      mining: 100,
      logging: 0,
      herbalism: 0,
      fishing: 200,
    });
  });
});

describe('at cap, actions still work: only skill gain stops', () => {
  it('a craft at skill 125 still resolves granted and the masterwork proc path is still reachable', () => {
    // The professions_masterwork.test.ts fixture recipe: skillReq 0, uncommon
    // def with a stats profile, bump tier 2 inside the pre-attunement rare
    // ceiling, so the proc effect gate stays open on a fresh character.
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    const pid = sim.playerId;
    const meta = mustMeta(sim, pid);
    meta.craftSkills.tailoring = 125;
    const recipe = recipeById('recipe_eastbrook_ritual_vestments')!;

    let masterworks = 0;
    for (let i = 0; i < 200 && masterworks === 0; i++) {
      for (let j = 0; j < 3; j++) sim.addItem('linen_scrap', 1, pid);
      sim.addItem('spider_leg', 1, pid);
      // Harness-only throttle reset: #1301's rolling window caps successful
      // crafts per minute, which is not what this pin is about.
      meta.craftThrottle.count = 0;
      const result = resolveCraftForRecipe((sim as any).ctx, pid, recipe);
      expect(result.ok).toBe(true);
      if (result.masterwork) masterworks++;
    }
    // The proc path stayed reachable at cap (about an 11 percent chance per
    // craft at this skill: deterministic at this seed).
    expect(masterworks).toBeGreaterThan(0);
    expect(sim.countItem(recipe.resultItemId, pid)).toBeGreaterThan(0);
    // Skill never moved off the cap.
    expect(meta.craftSkills.tailoring).toBe(125);
  });

  it('a harvest at mining 100 still yields the node material; proficiency stays at cap', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Capped');
    const meta = mustMeta(sim, pid);
    meta.gatheringProficiency.mining = 100;
    const p = (sim as any).entities.get(pid);
    p.pos.x = NODE.pos.x;
    p.pos.z = NODE.pos.z;
    p.pos.y = terrainHeight(NODE.pos.x, NODE.pos.z, sim.cfg.seed);
    p.prevPos = { ...p.pos };

    expect(sim.harvestNode(NODE.id, pid)).toBe(true);
    // Complete the gather cast synchronously (the gathering_rhythm idiom).
    p.castingAbility = null;
    p.castRemaining = 0;
    sim.ctx.completeGatherCast(p, meta);

    expect(sim.countItem(NODE_MATERIAL.itemId, pid)).toBeGreaterThan(0);
    drainGatheringGrants(meta);
    expect(meta.gatheringProficiency.mining).toBe(100);
  });

  it('a landed catch at fishing 200 still grants the item; proficiency stays at cap', () => {
    const sim = new Sim({ seed: 4242, playerClass: 'warrior', autoEquip: true });
    const meta = mustMeta(sim, sim.playerId);
    meta.gatheringProficiency.fishing = 200;
    // South shore of the vale lake, facing the water (the fishing-suite idiom).
    const pz = LAKE.z - LAKE.radius - 2;
    const p = sim.player;
    p.pos.x = LAKE.x;
    p.pos.z = pz;
    p.pos.y = terrainHeight(LAKE.x, pz, sim.cfg.seed);
    p.prevPos = { ...p.pos };
    p.facing = Math.atan2(0, LAKE.z - pz);

    // The table has an empty-hook row, so cast until one catch lands
    // (deterministic at this seed).
    const bagBefore = meta.inventory.length;
    let landed = false;
    for (let i = 0; i < 10 && !landed; i++) {
      completeFishing(sim.ctx, p, meta);
      landed = meta.inventory.length > bagBefore;
    }
    expect(landed).toBe(true);
    drainGatheringGrants(meta);
    expect(meta.gatheringProficiency.fishing).toBe(200);
  });

  it('the battlefield trickle at cap grants nothing: skill stays 125', () => {
    const skills = emptyCraftSkills();
    skills.alchemy = 125;
    battlefieldExperienceTrickle(skills, {
      itemId: 'minor_healing_potion', // recipe_minor_healing_potion -> alchemy
      instance: { signer: 'Aria', rolled: { quality: 'rare' } },
      observerName: 'Aria',
      observerActiveArchetype: 'alchemy',
    });
    expect(skills.alchemy).toBe(125);
  });

  it('the battlefield trickle just under cap clamps to exactly 125', () => {
    const skills = emptyCraftSkills();
    skills.alchemy = 124.9;
    battlefieldExperienceTrickle(skills, {
      itemId: 'minor_healing_potion',
      instance: { signer: 'Aria', rolled: { quality: 'rare' } },
      observerName: 'Aria',
      observerActiveArchetype: 'alchemy',
    });
    expect(skills.alchemy).toBe(125);
  });
});
