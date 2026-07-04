# Emberdeep Foundry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Emberdeep Foundry, a fully themed 5-player endgame dungeon (levels 18 to 20) in Thornpeak Heights, per the approved spec at `docs/superpowers/specs/2026-07-04-emberdeep-foundry-design.md`.

**Architecture:** One self-contained content module (`src/sim/content/foundry.ts`) merged by `src/sim/data.ts`, a new `FOUNDRY_LAYOUT` in `src/sim/dungeon_layout.ts` whose collision derives from `layoutColliders()`, and a new `foundry` renderer interior variant with an ember torch palette and magma channel strips reusing the temple water shader retinted. Zero changes to the instance system (`src/sim/instances/dungeons.ts`), which is data-driven off `DUNGEON_DEFS`.

**Tech Stack:** TypeScript strict ESM, Vitest, Three.js r165 (renderer only). Test idioms follow `tests/temple.test.ts`.

**Branch:** `feature/emberdeep-foundry` (already created off `origin/release/v0.21.0`).

**Spec deviation (approved rationale):** the spec says instance index 4, but indexes 4 and 5 are already taken by the Nythraxis raid wings (`src/sim/content/dungeons.ts:620` and `:656`). The Foundry uses **index 6** (instance origin x = 900 + 6\*600 = 4500). Task 1 fixes the spec line.

**House rules that apply to every task:** no em dashes, en dashes, or emojis anywhere (code, comments, commit messages). 2-space indent, single quotes, trailing commas (Biome). Never run whole-repo Biome writes; format only touched files with `npx @biomejs/biome check --write <file>`. All balance numbers below are extrapolated from existing 18-20 content (Gravewyrm Sanctum elites, the temple bosses, the shipped T1 epics in `src/sim/content/zone3.ts:2403-2449`); do not re-invent them.

---

### Task 1: Fix the spec's instance index

**Files:**
- Modify: `docs/superpowers/specs/2026-07-04-emberdeep-foundry-design.md`

- [ ] **Step 1: Correct index 4 to index 6**

In the spec, replace the line:

```
- DUNGEON_DEFS entry: index 4 (next free instance x-band), doorPos near
```

with:

```
- DUNGEON_DEFS entry: index 6 (next free instance x-band; 4 and 5 are the
  Nythraxis raid wings), doorPos near
```

- [ ] **Step 2: Correct the chain length**

The authored chain is 7 quests (a parallel sigils branch joined the 6): in the spec's "Loot and quests" section, change "Quest chain: 6 quests." to "Quest chain: 7 quests (two parallel mid-chain branches)."

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-07-04-emberdeep-foundry-design.md
git commit -m "docs(design): foundry index is 6 and the quest chain is 7 quests"
```

---

### Task 2: Interior layout, colliders, and the interior type union

**Files:**
- Modify: `src/sim/dungeon_layout.ts` (append after `TEMPLE_LAYOUT`, before `ARENA_LAYOUT`)
- Modify: `src/sim/colliders.ts:262` area (collider registration)
- Modify: `src/sim/types.ts:1303` (interior union)
- Test: `tests/foundry.test.ts` (new file, first describe block)

- [ ] **Step 1: Write the failing layout test**

Create `tests/foundry.test.ts`:

```ts
// The Emberdeep Foundry, the relit forge of the mountain clans under the
// southwest crags of Thornpeak Heights. Verifies the dungeon is registered at
// its own instance band, enterable with its full spawn set, that the boss
// mechanics fire, the new 'foundry' interior collides, and the quest chain +
// boss loot table hang together. Mirrors tests/temple.test.ts.
import { describe, expect, it } from 'vitest';
import { FOUNDRY_LAYOUT, layoutColliders } from '../src/sim/dungeon_layout';

describe('Emberdeep Foundry layout', () => {
  it('is a three-chamber gauntlet on the standard shell', () => {
    expect(FOUNDRY_LAYOUT.zMin).toBe(-19);
    expect(FOUNDRY_LAYOUT.zMax).toBe(132);
    // two chamber-waist stubs: assembly hall -> casting halls -> forge heart
    const stubZs = [...new Set(FOUNDRY_LAYOUT.stubs.map((s) => s.z))].sort((a, b) => a - b);
    expect(stubZs).toEqual([48, 96]);
    // every stub leaves the 10u centre passage (|x| <= 5) open
    for (const s of FOUNDRY_LAYOUT.stubs) expect(Math.abs(s.x) - s.hw).toBeGreaterThanOrEqual(5);
    // the boss dais is inside the forge heart and walkable (no collider for it)
    expect(FOUNDRY_LAYOUT.dais.z).toBeGreaterThan(96);
    const colliders = layoutColliders(FOUNDRY_LAYOUT);
    const daisHit = colliders.some(
      (c) => c.type === 'circle' && Math.hypot(c.x - 0, c.z - FOUNDRY_LAYOUT.dais.z) < 2,
    );
    expect(daisHit).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/foundry.test.ts`
Expected: FAIL with `FOUNDRY_LAYOUT` not exported.

- [ ] **Step 3: Add FOUNDRY_LAYOUT to src/sim/dungeon_layout.ts**

Insert after the `TEMPLE_LAYOUT` block (after line 165), before `ARENA_LAYOUT`:

```ts
// The Emberdeep Foundry (interior 'foundry'): a three-chamber forge gauntlet.
// An assembly hall, then the casting halls behind a chamber-waist stub at z 48
// (Kilnmaster Vorr holds the far end), then the forge heart behind a second
// stub at z 96 with the Slagheart Colossus on the great anvil dais. Side walls
// at |x|=23 like the crypt so the KayKit wall modules fit unchanged; wall-side
// slots carry dormant crucibles (rendered with magma channel strips alongside).
export const FOUNDRY_LAYOUT: DungeonLayout = (() => {
  const pillars: GridPoint[] = [];
  for (const z of [10, 25, 40, 60, 75, 90, 110]) {
    for (const x of [-14, 14]) pillars.push({ x, z });
  }
  const stubs: WallStub[] = [];
  for (const sx of [-14, 14]) {
    stubs.push({ x: sx, z: 48, hw: 9, hd: 4 }); // assembly hall -> casting halls
    stubs.push({ x: sx, z: 96, hw: 9, hd: 4 }); // casting halls -> forge heart
  }
  return {
    zMin: -19,
    zMax: 132,
    sideWallZ: 56.5,
    sideWallHd: 76.5,
    pillars,
    tombs: grid(16, 82, 22, [-19, 19]), // dormant crucibles hugging the walls
    stubs,
    dais: { x: 0, z: 116, r: 10.5 },
  };
})();
```

- [ ] **Step 4: Register the collision set in src/sim/colliders.ts**

At the import from `./dungeon_layout` (line 22 area), add `FOUNDRY_LAYOUT` to the import list. Then next to line 262:

```ts
const FOUNDRY_COLLIDERS: Collider[] = layoutColliders(FOUNDRY_LAYOUT);
```

And add to `INTERIOR_COLLIDERS` (line 267):

```ts
const INTERIOR_COLLIDERS: Record<string, Collider[]> = {
  crypt: CRYPT_COLLIDERS,
  sanctum: SANCTUM_COLLIDERS,
  temple: TEMPLE_COLLIDERS,
  nythraxis: NYTHRAXIS_COLLIDERS,
  foundry: FOUNDRY_COLLIDERS,
};
```

- [ ] **Step 5: Extend the interior union in src/sim/types.ts**

Line 1303, change:

```ts
  interior: 'crypt' | 'sanctum' | 'temple' | 'nythraxis'; // renderer + collider interior builder key
```

to:

```ts
  interior: 'crypt' | 'sanctum' | 'temple' | 'nythraxis' | 'foundry'; // renderer + collider interior builder key
```

(Do NOT touch the second `interior:` union at types.ts:2462; that one is the delve module union.)

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/foundry.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 7: Commit**

```bash
npx @biomejs/biome check --write src/sim/dungeon_layout.ts src/sim/colliders.ts tests/foundry.test.ts
git add src/sim/dungeon_layout.ts src/sim/colliders.ts src/sim/types.ts tests/foundry.test.ts
git commit -m "feat(dungeons): Emberdeep Foundry three-chamber interior layout and colliders"
```

---

### Task 3: The content module (mobs, NPC, quests, items, camps, spawn list, dungeon def)

**Files:**
- Create: `src/sim/content/foundry.ts`
- Test: `tests/foundry.test.ts` (extend)

This is the big one; it is pure data, modeled line-for-line on `src/sim/content/temple.ts`. Balance anchors: instance elites mirror the temple's elite curves shifted to 18-20 (hpBase 58-70, hpPerLevel 22-25, dmgBase 12-13); Vorr mirrors Choirmother Selthe (+~15%); the Colossus mirrors Ysolei (+~10%); epic stats mirror the T1 epics at `zone3.ts:2403-2449` scaled chest-to-head (~0.85x armor).

- [ ] **Step 1: Write the failing registration test**

Append to `tests/foundry.test.ts` (add the imports to the existing import block):

```ts
import { Sim } from '../src/sim/sim';
import { dist2d } from '../src/sim/types';
import { DUNGEONS, DUNGEON_LIST, ITEMS, MOBS, NPCS, QUESTS, instanceOrigin } from '../src/sim/data';
import { isBlocked } from '../src/sim/colliders';
import { groundHeight } from '../src/sim/world';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos.x = x; e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

function nearestMob(sim: Sim, templateId: string, from: { x: number; z: number }) {
  let best: any = null, bestD = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead || e.templateId !== templateId) continue;
    const d = Math.hypot(e.pos.x - from.x, e.pos.z - from.z);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

describe('Emberdeep Foundry', () => {
  it('is registered as an endgame dungeon at its own instance band', () => {
    const f = DUNGEONS.emberdeep_foundry;
    expect(f).toBeTruthy();
    expect(f.index).toBe(6);
    expect(f.interior).toBe('foundry');
    expect(f.suggestedPlayers).toBe(5);
    expect(DUNGEON_LIST.some((d) => d.id === 'emberdeep_foundry')).toBe(true);
    // index-6 origin: x = 900 + 6*600
    expect(instanceOrigin(6, 0).x).toBe(4500);
    // the door sits past Drogmar's War-Camp in the zone southwest
    expect(f.doorPos.x).toBeLessThan(-140);
    expect(f.doorPos.z).toBeGreaterThan(760);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/foundry.test.ts -t 'registered as an endgame'`
Expected: FAIL (`DUNGEONS.emberdeep_foundry` undefined).

- [ ] **Step 3: Create src/sim/content/foundry.ts**

Complete file content:

```ts
// The Emberdeep Foundry, the old forge of the mountain clans, dug under the
// southwest crags of Thornpeak Heights and long cold. The Emberpact cult has
// relit it, and whatever they are forging is why the deep halls glow again.
// Drogmar's ogres did not camp at the doorstep by choice: they were driven out
// of the deep halls (which is why the war-camp squats where it does).
//
// Everything is merged into the flat engine tables by sim/data.ts, exactly the
// way temple.ts is. Levels 18-20: the pre-raid step alongside the Sanctum.

import type {
  CampDef,
  DungeonDef,
  DungeonSpawn,
  GroundObjectDef,
  ItemDef,
  MobTemplate,
  NpcDef,
  PlayerClass,
  QuestDef,
} from '../types';

// Archetype class-locks (match content/items.ts so REWARD_ARCHETYPE hand-offs
// land on an item the whole group can equip).
const WAR: PlayerClass[] = ['warrior', 'paladin', 'shaman'];
const MAG: PlayerClass[] = ['mage', 'priest', 'warlock', 'druid'];
const ROG: PlayerClass[] = ['rogue', 'hunter'];

// The forge door opens in the crag face past Drogmar's War-Camp (-130, 740).
export const FOUNDRY_DOOR_POS = { x: -150, z: 770 };

// ---------------------------------------------------------------------------
// Mobs, overworld (the Emberpact siege line outside the door)
// ---------------------------------------------------------------------------

export const FOUNDRY_MOBS: Record<string, MobTemplate> = {
  emberpact_zealot: {
    id: 'emberpact_zealot',
    name: 'Emberpact Zealot',
    minLevel: 18,
    maxLevel: 19,
    family: 'humanoid',
    hpBase: 84,
    hpPerLevel: 24,
    dmgBase: 12,
    dmgPerLevel: 2.7,
    attackSpeed: 2.0,
    armorPerLevel: 18,
    moveSpeed: 7,
    aggroRadius: 12,
    loot: [
      { copper: 120, chance: 1 },
      { itemId: 'emberpact_sigil', chance: 0.6, questId: 'q_foundry_sigils' },
      { itemId: 'cult_brand', chance: 0.3 },
    ],
    scale: 1.0,
    color: 0xb4552e,
  },
  cinderhound: {
    id: 'cinderhound',
    name: 'Cinderhound',
    minLevel: 18,
    maxLevel: 19,
    family: 'beast',
    hpBase: 78,
    hpPerLevel: 23,
    dmgBase: 12,
    dmgPerLevel: 2.7,
    attackSpeed: 1.8,
    armorPerLevel: 14,
    moveSpeed: 8.5,
    aggroRadius: 13,
    loot: [
      { copper: 100, chance: 1 },
      { itemId: 'slag_heart', chance: 0.55, questId: 'q_foundry_hounds' },
      { itemId: 'ember_grit', chance: 0.35 },
    ],
    scale: 1.1,
    color: 0xc9662f,
    componentTags: ['hide', 'claw'],
  },
  ashmaw_kilnborn: {
    id: 'ashmaw_kilnborn',
    name: 'Ashmaw the Kilnborn',
    minLevel: 19,
    maxLevel: 19,
    family: 'elemental',
    rare: true,
    hpBase: 210,
    hpPerLevel: 30,
    dmgBase: 14,
    dmgPerLevel: 2.9,
    attackSpeed: 2.2,
    armorPerLevel: 24,
    moveSpeed: 7.5,
    aggroRadius: 12,
    loot: [
      { copper: 700, chance: 1 },
      { itemId: 'kilnborn_core', chance: 1, questId: 'q_foundry_ashmaw' },
      { itemId: 'slag_chunk', chance: 1 },
      { itemId: 'ember_grit', chance: 0.5 },
    ],
    scale: 1.25,
    color: 0xe07a30,
  },
};

// ---------------------------------------------------------------------------
// Mobs, instanced (the Emberdeep Foundry, 5-player elite, 18-20)
// ---------------------------------------------------------------------------

export const FOUNDRY_DUNGEON_MOBS: Record<string, MobTemplate> = {
  emberpact_cinderpriest: {
    id: 'emberpact_cinderpriest',
    name: 'Emberpact Cinderpriest',
    minLevel: 18,
    maxLevel: 19,
    family: 'humanoid',
    elite: true,
    hpBase: 60,
    hpPerLevel: 23,
    dmgBase: 12,
    dmgPerLevel: 2.8,
    attackSpeed: 2.0,
    armorPerLevel: 17,
    moveSpeed: 7,
    aggroRadius: 12,
    loot: [
      { copper: 280, chance: 1 },
      { itemId: 'cult_brand', chance: 0.4 },
      { itemId: 'ember_grit', chance: 0.4 },
    ],
    scale: 1.0,
    color: 0xd06a2a,
  },
  emberpact_kiln_acolyte: {
    id: 'emberpact_kiln_acolyte',
    name: 'Emberpact Kiln Acolyte',
    minLevel: 18,
    maxLevel: 19,
    family: 'humanoid',
    elite: true,
    hpBase: 58,
    hpPerLevel: 22,
    dmgBase: 12,
    dmgPerLevel: 2.7,
    attackSpeed: 2.1,
    armorPerLevel: 16,
    moveSpeed: 7,
    aggroRadius: 12,
    loot: [
      { copper: 260, chance: 1 },
      { itemId: 'cult_brand', chance: 0.35 },
      { itemId: 'slag_chunk', chance: 0.3 },
    ],
    scale: 1.0,
    color: 0xb85a30,
  },
  slag_hound: {
    id: 'slag_hound',
    name: 'Slag Hound',
    minLevel: 18,
    maxLevel: 19,
    family: 'beast',
    elite: true,
    hpBase: 60,
    hpPerLevel: 22,
    dmgBase: 12,
    dmgPerLevel: 2.8,
    attackSpeed: 1.8,
    armorPerLevel: 15,
    moveSpeed: 8.5,
    aggroRadius: 13,
    loot: [
      { copper: 240, chance: 1 },
      { itemId: 'slag_chunk', chance: 0.5 },
      { itemId: 'ember_grit', chance: 0.35 },
    ],
    scale: 1.15,
    color: 0x8a4a28,
    componentTags: ['hide', 'claw'],
  },
  ash_revenant: {
    id: 'ash_revenant',
    name: 'Ash Revenant',
    minLevel: 19,
    maxLevel: 20,
    family: 'undead',
    elite: true,
    hpBase: 62,
    hpPerLevel: 23,
    dmgBase: 12,
    dmgPerLevel: 2.8,
    attackSpeed: 2.2,
    armorPerLevel: 18,
    moveSpeed: 6.5,
    aggroRadius: 12,
    loot: [
      { copper: 300, chance: 1 },
      { itemId: 'ember_grit', chance: 0.5 },
      { itemId: 'cult_brand', chance: 0.3 },
    ],
    scale: 1.05,
    color: 0x9a9088,
  },
  emberbound_custodian: {
    id: 'emberbound_custodian',
    name: 'Emberbound Custodian',
    minLevel: 19,
    maxLevel: 20,
    family: 'elemental',
    elite: true,
    hpBase: 68,
    hpPerLevel: 24,
    dmgBase: 13,
    dmgPerLevel: 2.8,
    attackSpeed: 2.3,
    armorPerLevel: 23,
    moveSpeed: 6.5,
    aggroRadius: 12,
    loot: [
      { copper: 320, chance: 1 },
      { itemId: 'slag_chunk', chance: 0.6 },
      { itemId: 'ember_grit', chance: 0.4 },
    ],
    scale: 1.2,
    color: 0xd88a3a,
  },
  forgeguard_sentinel: {
    id: 'forgeguard_sentinel',
    name: 'Forgeguard Sentinel',
    minLevel: 19,
    maxLevel: 20,
    family: 'elemental',
    elite: true,
    hpBase: 70,
    hpPerLevel: 25,
    dmgBase: 13,
    dmgPerLevel: 2.9,
    attackSpeed: 2.4,
    armorPerLevel: 25,
    moveSpeed: 6,
    aggroRadius: 12,
    loot: [
      { copper: 340, chance: 1 },
      { itemId: 'slag_chunk', chance: 0.6 },
      { itemId: 'cult_brand', chance: 0.3 },
    ],
    scale: 1.25,
    color: 0xc27a2e,
  },
  molten_crucible_tender: {
    id: 'molten_crucible_tender',
    name: 'Molten Crucible-Tender',
    minLevel: 19,
    maxLevel: 20,
    family: 'elemental',
    elite: true,
    hpBase: 64,
    hpPerLevel: 23,
    dmgBase: 13,
    dmgPerLevel: 2.9,
    attackSpeed: 2.0,
    armorPerLevel: 19,
    moveSpeed: 7,
    aggroRadius: 12,
    loot: [
      { copper: 320, chance: 1 },
      { itemId: 'ember_grit', chance: 0.5 },
      { itemId: 'slag_chunk', chance: 0.4 },
    ],
    scale: 1.1,
    color: 0xe6923c,
  },
  cinder_wisp: {
    id: 'cinder_wisp',
    name: 'Cinder Wisp',
    minLevel: 19,
    maxLevel: 19,
    family: 'elemental',
    hpBase: 50,
    hpPerLevel: 16,
    dmgBase: 9,
    dmgPerLevel: 2.2,
    attackSpeed: 1.9,
    armorPerLevel: 10,
    moveSpeed: 8,
    aggroRadius: 12,
    loot: [], // summoned by Kilnmaster Vorr, nothing to loot
    scale: 0.85,
    color: 0xffb066,
  },
  kilnmaster_vorr: {
    id: 'kilnmaster_vorr',
    name: 'Kilnmaster Vorr',
    minLevel: 20,
    maxLevel: 20,
    family: 'humanoid',
    elite: true,
    hpBase: 170,
    hpPerLevel: 28,
    dmgBase: 13,
    dmgPerLevel: 2.8,
    attackSpeed: 2.2,
    armorPerLevel: 23,
    moveSpeed: 7,
    aggroRadius: 14,
    summonAdds: { mobId: 'cinder_wisp', count: 2, atHpPct: [0.65, 0.35] },
    enrage: { belowHpPct: 0.3, dmgMult: 1.3, hasteMult: 1.25 },
    loot: [
      { copper: 900, chance: 1 },
      { itemId: 'vorrs_kilnplates', chance: 0.4 },
      { itemId: 'cult_brand', chance: 0.5 },
    ],
    scale: 1.2,
    color: 0xa44a20,
  },
  slagheart_colossus: {
    id: 'slagheart_colossus',
    name: 'The Slagheart Colossus',
    minLevel: 20,
    maxLevel: 20,
    family: 'elemental',
    elite: true,
    boss: true,
    hpBase: 330,
    hpPerLevel: 40,
    dmgBase: 15,
    dmgPerLevel: 3.0,
    attackSpeed: 2.6,
    armorPerLevel: 30,
    moveSpeed: 6.5,
    aggroRadius: 18,
    aoePulse: { min: 26, max: 38, radius: 13, every: 9, name: 'Slag Eruption' },
    enrage: { belowHpPct: 0.25, dmgMult: 1.4, hasteMult: 1.3 },
    loot: [
      { copper: 8000, chance: 1 },
      { itemId: 'slagforged_legguards', chance: 0.5 },
      // exclusive "one of three" epic helms (weights sum to 1.0)
      { itemId: 'forgelord_warhelm', chance: 0.34, rollGroup: 'slagheart_epic' },
      { itemId: 'emberweave_cowl', chance: 0.33, rollGroup: 'slagheart_epic' },
      { itemId: 'slagstalker_hood', chance: 0.33, rollGroup: 'slagheart_epic' },
    ],
    scale: 1.75,
    color: 0xe0802e,
  },
};

// ---------------------------------------------------------------------------
// NPC, Forgewright Brenna keeps the old forge records in Highwatch
// ---------------------------------------------------------------------------

export const FOUNDRY_NPCS: Record<string, NpcDef> = {
  forgewright_brenna: {
    id: 'forgewright_brenna',
    name: 'Brenna Coalwright',
    title: 'Forgewright',
    pos: { x: 20, z: 668 },
    facing: -1.5,
    color: 0xb4642e,
    questIds: [
      'q_foundry_smoke',
      'q_foundry_pickets',
      'q_foundry_hounds',
      'q_foundry_sigils',
      'q_foundry_ashmaw',
      'q_foundry_kilnmaster',
      'q_foundry_slagheart',
    ],
    greeting:
      'Smoke over the southwest crags, $C. My grandmother banked that forge herself and swore it cold. Cold forges do not smoke.',
  },
};

// ---------------------------------------------------------------------------
// Quests, a soloable siege-line lead-up, then a 5-player descent
// ---------------------------------------------------------------------------

export const FOUNDRY_QUESTS: Record<string, QuestDef> = {
  q_foundry_smoke: {
    id: 'q_foundry_smoke',
    name: 'Smoke Over the Crags',
    giverNpcId: 'forgewright_brenna',
    turnInNpcId: 'forgewright_brenna',
    text: "The Emberdeep was OUR forge, $N, before the clans buried it and swore it cold. Now it smokes again, and Drogmar's ogres sit outside it like whipped dogs. Something drove them OUT. Go to the siege line past the war-camp and bring me one of the dispatches the cultists nail to their posts. I would know who relit my grandmother's fire.",
    completionText:
      '"The Emberpact." A cult that prays to a banked coal. And this seal at the bottom, $N: the old forgemark of the Emberdeep itself. They are not squatting in the forge. They are RUNNING it.',
    objectives: [
      { type: 'collect', itemId: 'warcamp_dispatch', count: 1, label: 'Emberpact Dispatch taken' },
    ],
    xpReward: 5200,
    copperReward: 2600,
    itemRewards: {},
    minLevel: 18,
  },
  q_foundry_pickets: {
    id: 'q_foundry_pickets',
    name: 'Thin the Siege Line',
    giverNpcId: 'forgewright_brenna',
    turnInNpcId: 'forgewright_brenna',
    text: 'The Emberpact holds the crag approach with zealot pickets, and while they stand no one reaches the forge door. They drove out ogres, $N. OGRES. Cull ten zealots and the line breaks.',
    completionText:
      'Ten fewer voices praying at the coal. The pickets are thinning, and the door is almost in reach.',
    objectives: [
      { type: 'kill', targetMobId: 'emberpact_zealot', count: 10, label: 'Emberpact Zealot slain' },
    ],
    xpReward: 5400,
    copperReward: 2800,
    itemRewards: {},
    requiresQuest: 'q_foundry_smoke',
  },
  q_foundry_hounds: {
    id: 'q_foundry_hounds',
    name: 'Hounds of the Kiln',
    giverNpcId: 'forgewright_brenna',
    turnInNpcId: 'forgewright_brenna',
    text: 'The cult runs hounds along the crag paths, beasts with slag cooling in their hides. Kill eight, and cut out six of the slag hearts that beat in them. If the forge is hot enough to birth THOSE, it is hotter than my grandmother ever dared run it.',
    completionText:
      'Still warm. $N, a slag heart holds forge-heat for a day at most. The Emberdeep is not just lit. It is roaring.',
    objectives: [
      { type: 'kill', targetMobId: 'cinderhound', count: 8, label: 'Cinderhound put down' },
      { type: 'collect', itemId: 'slag_heart', count: 6, label: 'Slag Heart' },
    ],
    xpReward: 5600,
    copperReward: 3000,
    itemRewards: {},
    requiresQuest: 'q_foundry_pickets',
  },
  q_foundry_sigils: {
    id: 'q_foundry_sigils',
    name: 'The Emberpact Sigils',
    giverNpcId: 'forgewright_brenna',
    turnInNpcId: 'forgewright_brenna',
    text: 'Every zealot on that line carries a fired-clay sigil, their key past the door wards. Bring me six. I can read the firing marks, and the marks will tell me how many crucibles they have running.',
    completionText:
      'Six sigils, six different crucible marks. $N, the Emberdeep has SEVEN crucibles. They are running the full forge, and the seventh mark belongs to the great crucible: the Slagheart.',
    objectives: [
      { type: 'collect', itemId: 'emberpact_sigil', count: 6, label: 'Emberpact Sigil' },
    ],
    xpReward: 5600,
    copperReward: 3000,
    itemRewards: {},
    requiresQuest: 'q_foundry_pickets',
  },
  q_foundry_ashmaw: {
    id: 'q_foundry_ashmaw',
    name: 'Ashmaw the Kilnborn',
    giverNpcId: 'forgewright_brenna',
    turnInNpcId: 'forgewright_brenna',
    text: 'One thing on that line is no cultist and no hound. A shape of cooling slag walks the high path, the first thing the relit forge ever poured, and the pickets follow it like a banner. Kill Ashmaw the Kilnborn and bring me its core, $N. While it walks, the line will always reform.',
    completionText:
      'The core still glows. Poured slag should not LIVE, $N. Whoever tends that forge has learned something the clans buried on purpose.',
    objectives: [
      { type: 'collect', itemId: 'kilnborn_core', count: 1, label: "Ashmaw's Core" },
    ],
    xpReward: 5800,
    copperReward: 3200,
    itemRewards: {
      warrior: 'forgehand_gauntlets',
      mage: 'forgehand_handwraps',
      rogue: 'forgehand_grips',
    },
    requiresQuest: 'q_foundry_hounds',
    minLevel: 19,
  },
  q_foundry_kilnmaster: {
    id: 'q_foundry_kilnmaster',
    name: 'The Kilnmaster',
    giverNpcId: 'forgewright_brenna',
    turnInNpcId: 'forgewright_brenna',
    text: 'The sigils name their master: Kilnmaster Vorr, who found the Emberdeep cold and taught the coal to pray back. He holds the casting halls past the assembly floor. Take companions through the door and end him, $N. This is no errand for a lone blade.',
    completionText:
      'Vorr is ash in his own halls. But the firing marks on his robes... he was not the forgemaster, $N. He was the BELLOWS. Something deeper is still drawing breath.',
    objectives: [
      { type: 'kill', targetMobId: 'kilnmaster_vorr', count: 1, label: 'Kilnmaster Vorr slain' },
    ],
    xpReward: 6000,
    copperReward: 4000,
    itemRewards: {
      warrior: 'emberstep_warboots',
      mage: 'emberstep_slippers',
      rogue: 'emberstep_treads',
    },
    requiresQuest: 'q_foundry_sigils',
    minLevel: 19,
    suggestedPlayers: 5,
  },
  q_foundry_slagheart: {
    id: 'q_foundry_slagheart',
    name: 'The Slagheart Colossus',
    giverNpcId: 'forgewright_brenna',
    turnInNpcId: 'forgewright_brenna',
    text: 'I read the last of the firing marks, $N, and I finally understand what the Emberpact is forging: nothing. The forge is forging ITSELF a body. The great crucible has been pouring one casting for a season, and it stands now on the anvil dais at the forge heart, waiting for its final quench. When it steps off that dais, the mountain loses whatever war comes next. Gather the strongest you can find and shatter the Slagheart Colossus before it wakes fully.',
    completionText:
      'Cold at last, and this time it will STAY cold: I will bank that forge myself, the way my grandmother taught me. The mountain will never know what almost walked out from under it, $N. But I will. And so will you.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'slagheart_colossus',
        count: 1,
        label: 'The Slagheart Colossus shattered',
      },
    ],
    xpReward: 6400,
    copperReward: 15000,
    itemRewards: {
      warrior: 'slagrend_cleaver',
      mage: 'slagfire_scepter',
      rogue: 'slagglass_shiv',
    },
    requiresQuest: 'q_foundry_kilnmaster',
    minLevel: 19,
    suggestedPlayers: 5,
  },
};

export const FOUNDRY_QUEST_ORDER = [
  'q_foundry_smoke',
  'q_foundry_pickets',
  'q_foundry_hounds',
  'q_foundry_sigils',
  'q_foundry_ashmaw',
  'q_foundry_kilnmaster',
  'q_foundry_slagheart',
];

// ---------------------------------------------------------------------------
// World layout, the Emberpact siege line outside the door
// ---------------------------------------------------------------------------

export const FOUNDRY_CAMPS: CampDef[] = [
  { mobId: 'emberpact_zealot', center: { x: -138, z: 762 }, radius: 14, count: 6 },
  { mobId: 'emberpact_zealot', center: { x: -152, z: 784 }, radius: 14, count: 6 },
  { mobId: 'cinderhound', center: { x: -162, z: 758 }, radius: 12, count: 5 },
  { mobId: 'cinderhound', center: { x: -144, z: 776 }, radius: 10, count: 4 },
  { mobId: 'ashmaw_kilnborn', center: { x: -166, z: 788 }, radius: 3, count: 1 },
];

export const FOUNDRY_OBJECTS: GroundObjectDef[] = [
  {
    itemId: 'warcamp_dispatch',
    name: 'Emberpact Picket Post',
    positions: [
      { x: -140, z: 758 },
      { x: -148, z: 766 },
      { x: -156, z: 776 },
      { x: -144, z: 782 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export const FOUNDRY_ITEMS: Record<string, ItemDef> = {
  // --- quest items ---
  warcamp_dispatch: {
    id: 'warcamp_dispatch',
    name: 'Emberpact Dispatch',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_foundry_smoke',
  },
  slag_heart: {
    id: 'slag_heart',
    name: 'Slag Heart',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_foundry_hounds',
  },
  emberpact_sigil: {
    id: 'emberpact_sigil',
    name: 'Emberpact Sigil',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_foundry_sigils',
  },
  kilnborn_core: {
    id: 'kilnborn_core',
    name: "Ashmaw's Core",
    kind: 'quest',
    sellValue: 0,
    questId: 'q_foundry_ashmaw',
  },

  // --- quest blues (rare), endgame band ---
  forgehand_gauntlets: {
    id: 'forgehand_gauntlets',
    name: 'Forgehand Gauntlets',
    kind: 'armor',
    armorType: 'mail',
    slot: 'gloves',
    quality: 'rare',
    stats: { armor: 105, sta: 5, str: 3 },
    sellValue: 1600,
    requiredClass: WAR,
  },
  forgehand_handwraps: {
    id: 'forgehand_handwraps',
    name: 'Forgehand Handwraps',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'gloves',
    quality: 'rare',
    stats: { armor: 40, int: 6, spi: 3 },
    sellValue: 1600,
    requiredClass: MAG,
  },
  forgehand_grips: {
    id: 'forgehand_grips',
    name: 'Forgehand Grips',
    kind: 'armor',
    armorType: 'leather',
    slot: 'gloves',
    quality: 'rare',
    stats: { armor: 72, agi: 7, sta: 2 },
    sellValue: 1600,
    requiredClass: ROG,
  },
  emberstep_warboots: {
    id: 'emberstep_warboots',
    name: 'Emberstep Warboots',
    kind: 'armor',
    armorType: 'mail',
    slot: 'feet',
    quality: 'rare',
    stats: { armor: 100, sta: 5, str: 3 },
    sellValue: 1800,
    requiredClass: WAR,
  },
  emberstep_slippers: {
    id: 'emberstep_slippers',
    name: 'Emberstep Slippers',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'feet',
    quality: 'rare',
    stats: { armor: 38, int: 6, spi: 3 },
    sellValue: 1800,
    requiredClass: MAG,
  },
  emberstep_treads: {
    id: 'emberstep_treads',
    name: 'Emberstep Treads',
    kind: 'armor',
    armorType: 'leather',
    slot: 'feet',
    quality: 'rare',
    stats: { armor: 68, agi: 7, sta: 2 },
    sellValue: 1800,
    requiredClass: ROG,
  },
  slagrend_cleaver: {
    id: 'slagrend_cleaver',
    name: 'Slagrend Cleaver',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 26, max: 42, speed: 2.6 },
    stats: { str: 9, sta: 5 },
    sellValue: 2600,
    requiredClass: WAR,
  },
  slagfire_scepter: {
    id: 'slagfire_scepter',
    name: 'Slagfire Scepter',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 28, max: 46, speed: 3.0 },
    stats: { int: 11, spi: 5 },
    sellValue: 2600,
    requiredClass: MAG,
  },
  slagglass_shiv: {
    id: 'slagglass_shiv',
    name: 'Slagglass Shiv',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 17, max: 27, speed: 1.7, dagger: true },
    stats: { agi: 10, sta: 3 },
    sellValue: 2600,
    requiredClass: ROG,
  },

  // --- dungeon drops ---
  vorrs_kilnplates: {
    id: 'vorrs_kilnplates',
    name: "Vorr's Kilnplates",
    kind: 'armor',
    armorType: 'mail',
    slot: 'chest',
    quality: 'rare',
    stats: { armor: 210, sta: 7, str: 4 },
    sellValue: 2500,
  },
  slagforged_legguards: {
    id: 'slagforged_legguards',
    name: 'Slagforged Legguards',
    kind: 'armor',
    armorType: 'mail',
    slot: 'legs',
    quality: 'rare',
    stats: { armor: 140, sta: 7, spi: 3 },
    sellValue: 2200,
  },
  // pre-raid best: exclusive one-of-three epic helms off the Colossus
  // (budget mirrors the T1 epics in zone3.ts scaled chest-to-head ~0.85x)
  forgelord_warhelm: {
    id: 'forgelord_warhelm',
    name: 'Forgelord Warhelm',
    kind: 'armor',
    armorType: 'mail',
    slot: 'helmet',
    quality: 'epic',
    stats: { armor: 230, str: 7, sta: 9 },
    sellValue: 9000,
    requiredClass: WAR,
  },
  emberweave_cowl: {
    id: 'emberweave_cowl',
    name: 'Emberweave Cowl',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'helmet',
    quality: 'epic',
    stats: { armor: 78, int: 10, spi: 6 },
    sellValue: 9000,
    requiredClass: MAG,
  },
  slagstalker_hood: {
    id: 'slagstalker_hood',
    name: 'Slagstalker Hood',
    kind: 'armor',
    armorType: 'leather',
    slot: 'helmet',
    quality: 'epic',
    stats: { armor: 145, agi: 10, sta: 5 },
    sellValue: 9000,
    requiredClass: ROG,
  },

  // --- junk (gray) ---
  slag_chunk: {
    id: 'slag_chunk',
    name: 'Slag Chunk',
    kind: 'junk',
    quality: 'poor',
    sellValue: 30,
  },
  ember_grit: {
    id: 'ember_grit',
    name: 'Ember Grit',
    kind: 'junk',
    quality: 'poor',
    sellValue: 26,
  },
  cult_brand: {
    id: 'cult_brand',
    name: 'Emberpact Brand',
    kind: 'junk',
    quality: 'poor',
    sellValue: 34,
  },
};

// ---------------------------------------------------------------------------
// The Emberdeep Foundry instance: elite packs across the assembly hall,
// Kilnmaster Vorr holding the far casting halls, then the Slagheart Colossus
// waiting on the anvil dais with two forgeguards.
// ---------------------------------------------------------------------------

const FOUNDRY_SPAWN_LIST: DungeonSpawn[] = [
  // assembly hall (z 0-48)
  { mobId: 'slag_hound', x: -3, z: 14 },
  { mobId: 'slag_hound', x: 3, z: 15 },
  { mobId: 'emberpact_kiln_acolyte', x: -9, z: 28 },
  { mobId: 'emberpact_cinderpriest', x: -5, z: 29 },
  { mobId: 'forgeguard_sentinel', x: 9, z: 40 },
  { mobId: 'slag_hound', x: 5, z: 41 },
  // casting halls (past the waist at z 48)
  { mobId: 'emberbound_custodian', x: -5, z: 56 },
  { mobId: 'emberpact_kiln_acolyte', x: -1, z: 57 },
  { mobId: 'ash_revenant', x: 9, z: 66 },
  { mobId: 'slag_hound', x: -7, z: 67 },
  { mobId: 'emberpact_cinderpriest', x: 6, z: 76 },
  { mobId: 'molten_crucible_tender', x: 0, z: 77 },
  { mobId: 'kilnmaster_vorr', x: -2, z: 86 },
  { mobId: 'emberpact_kiln_acolyte', x: 4, z: 87 },
  // the forge heart (past the waist at z 96)
  { mobId: 'forgeguard_sentinel', x: -6, z: 102 },
  { mobId: 'emberbound_custodian', x: 4, z: 103 },
  { mobId: 'molten_crucible_tender', x: -4, z: 110 },
  { mobId: 'ash_revenant', x: 6, z: 111 },
  { mobId: 'slagheart_colossus', x: 0, z: 116 },
  { mobId: 'forgeguard_sentinel', x: -5, z: 113 },
  { mobId: 'forgeguard_sentinel', x: 5, z: 113 },
];

export const FOUNDRY_DUNGEON_DEFS: Record<string, DungeonDef> = {
  emberdeep_foundry: {
    id: 'emberdeep_foundry',
    name: 'The Emberdeep Foundry',
    index: 6, // instance origin x = 900 + 6*600 = 4500 (4 and 5 are the raid wings)
    doorPos: { ...FOUNDRY_DOOR_POS },
    entry: { x: 0, z: 4 },
    exitOffset: { x: 0, z: -6 },
    spawns: FOUNDRY_SPAWN_LIST,
    interior: 'foundry',
    suggestedPlayers: 5,
    enterText:
      'You step through the forge door. The mountain closes overhead, and the heat of the relit Emberdeep rolls up the passage to meet you.',
    leaveText: 'You step out of the forge door into the cold of the crags.',
  },
};
```

Note: `ZonePropsDef` surface props are deliberately omitted (temple added a camp; the war-camp props already dress this area). If `GroundObjectDef` requires fields beyond `itemId`/`name`/`positions`, mirror `TEMPLE_OBJECTS` exactly.

- [ ] **Step 4: Merge the module in src/sim/data.ts**

Mirror every `TEMPLE_*` merge exactly (grep `TEMPLE_` in `src/sim/data.ts`; hits at lines 48-57, 153, 166-167, 175, 192, 199, 210, 219, 230, 375). Add the parallel `FOUNDRY_*` imports and spreads:

- Import block (next to the temple imports): `FOUNDRY_CAMPS, FOUNDRY_DUNGEON_DEFS, FOUNDRY_DUNGEON_MOBS, FOUNDRY_ITEMS, FOUNDRY_MOBS, FOUNDRY_NPCS, FOUNDRY_OBJECTS, FOUNDRY_QUEST_ORDER, FOUNDRY_QUESTS` from `./content/foundry`.
- Items table (line 153 area): add `FOUNDRY_ITEMS` to the merge.
- Mobs (166): `...FOUNDRY_MOBS, ...FOUNDRY_DUNGEON_MOBS,`
- NPCs (175): `...FOUNDRY_NPCS,`
- Quests (192): `...FOUNDRY_QUESTS,`
- Quest order (199): `...FOUNDRY_QUEST_ORDER,`
- Camps (210): `...FOUNDRY_CAMPS,`
- Ground objects (219): `...FOUNDRY_OBJECTS,`
- Do NOT add a props entry (no `FOUNDRY_PROPS`).
- Dungeons (375): `export const DUNGEONS: Record<string, DungeonDef> = { ...DUNGEON_DEFS, ...TEMPLE_DUNGEON_DEFS, ...FOUNDRY_DUNGEON_DEFS };`

- [ ] **Step 5: Run the registration test to verify it passes**

Run: `npx vitest run tests/foundry.test.ts && npx tsc --noEmit`
Expected: PASS (both describe blocks), tsc clean.

- [ ] **Step 6: Commit**

```bash
npx @biomejs/biome check --write src/sim/content/foundry.ts src/sim/data.ts tests/foundry.test.ts
git add src/sim/content/foundry.ts src/sim/data.ts tests/foundry.test.ts
git commit -m "feat(content): the Emberdeep Foundry endgame dungeon, mobs, quests, and loot"
```

---

### Task 4: Behavior tests (entry, bosses, collision, loot, chain)

**Files:**
- Test: `tests/foundry.test.ts` (extend the `Emberdeep Foundry` describe block)

These tests mirror `tests/temple.test.ts:46-141` and should pass with no further source changes; any failure is a real content bug (fix the data, not the test).

- [ ] **Step 1: Add the entry/exit test**

```ts
  it('is enterable through the forge door with its full spawn set, and exits home', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const door = DUNGEONS.emberdeep_foundry.doorPos;
    teleport(sim, a, door.x, door.z);
    sim.enterDungeon('emberdeep_foundry', a);
    const ea = sim.entities.get(a)!;
    expect(ea.pos.x).toBeGreaterThan(4400); // index-6 band (~4500)
    const slot = sim.instanceSlotAt(ea.pos)!;
    const origin = instanceOrigin(6, slot);

    const colossus = nearestMob(sim, 'slagheart_colossus', origin);
    expect(colossus).toBeTruthy();
    expect(colossus.level).toBe(20);
    expect(nearestMob(sim, 'kilnmaster_vorr', origin)).toBeTruthy();
    expect(nearestMob(sim, 'forgeguard_sentinel', origin)).toBeTruthy();

    sim.leaveDungeon(a);
    expect(dist2d(ea.pos, { x: door.x, y: 0, z: door.z })).toBeLessThan(10);
  });
```

- [ ] **Step 2: Add the boss mechanics tests**

```ts
  it('Kilnmaster Vorr summons Cinder Wisps at hp thresholds and enrages below 30%', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const door = DUNGEONS.emberdeep_foundry.doorPos;
    teleport(sim, a, door.x, door.z);
    sim.enterDungeon('emberdeep_foundry', a);
    const ea = sim.entities.get(a)!;
    const origin = instanceOrigin(6, sim.instanceSlotAt(ea.pos)!);

    const vorr = nearestMob(sim, 'kilnmaster_vorr', origin);
    expect(vorr).toBeTruthy();
    expect(vorr.enraged).toBe(false);
    const wispsNear = () => [...sim.entities.values()].filter(
      (e) => e.kind === 'mob' && !e.dead && e.templateId === 'cinder_wisp'
        && Math.abs(e.pos.x - origin.x) < 120,
    ).length;
    expect(wispsNear()).toBe(0);

    vorr.inCombat = true;
    vorr.hp = Math.floor(vorr.maxHp * 0.65);
    sim.tick();
    expect(wispsNear()).toBe(2); // first wave of 2

    vorr.hp = Math.floor(vorr.maxHp * 0.29);
    sim.tick();
    expect(wispsNear()).toBe(4); // second wave -> 4 total
    expect(vorr.enraged).toBe(true);
  });

  it('the Slagheart Colossus enrages below 25% and carries the Slag Eruption pulse', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const door = DUNGEONS.emberdeep_foundry.doorPos;
    teleport(sim, a, door.x, door.z);
    sim.enterDungeon('emberdeep_foundry', a);
    const ea = sim.entities.get(a)!;
    const origin = instanceOrigin(6, sim.instanceSlotAt(ea.pos)!);

    const colossus = nearestMob(sim, 'slagheart_colossus', origin);
    expect(colossus).toBeTruthy();
    expect(MOBS.slagheart_colossus.aoePulse?.name).toBe('Slag Eruption');
    expect(colossus.enraged).toBe(false);
    colossus.inCombat = true;
    colossus.hp = Math.floor(colossus.maxHp * 0.2);
    sim.tick();
    expect(colossus.enraged).toBe(true);
  });
```

- [ ] **Step 3: Add the collision and loot tests**

```ts
  it('the new foundry interior has solid walls, stubs and pillars but a walkable dais', () => {
    const sim = makeWorld();
    const o = instanceOrigin(6, 0);
    const seed = sim.cfg.seed;
    expect(isBlocked(seed, o.x + 0, o.z + 8)).toBe(false); // open entry aisle
    expect(isBlocked(seed, o.x + 23, o.z + 8)).toBe(true); // side wall at |x|=23
    expect(isBlocked(seed, o.x + 14, o.z + 10)).toBe(true); // colonnade pillar
    expect(isBlocked(seed, o.x + 14, o.z + 48)).toBe(true); // first chamber waist
    expect(isBlocked(seed, o.x + 0, o.z + 48)).toBe(false); // 10u centre passage
    expect(isBlocked(seed, o.x + 14, o.z + 96)).toBe(true); // second chamber waist
    expect(isBlocked(seed, o.x + 0, o.z + 116)).toBe(false); // anvil dais walkable
  });

  it('the Colossus epic drop table is an exclusive one-of-three and resolves to real items', () => {
    const colossus = MOBS.slagheart_colossus;
    const group = colossus.loot.filter((l) => l.rollGroup === 'slagheart_epic');
    expect(group.length).toBe(3);
    const sum = group.reduce((s, l) => s + l.chance, 0);
    expect(sum).toBeCloseTo(1.0, 5);
    for (const l of colossus.loot) {
      if (l.itemId) expect(ITEMS[l.itemId], `loot item ${l.itemId}`).toBeTruthy();
    }
    // pre-raid best: each rollGroup drop is an epic helmet, one per archetype
    for (const l of group) {
      const item = ITEMS[l.itemId!];
      expect(item.quality).toBe('epic');
      expect(item.slot).toBe('helmet');
    }
  });

  it('the Forgewright offers a self-contained chain ending at the 5-player finale', () => {
    const brenna = NPCS.forgewright_brenna;
    expect(brenna).toBeTruthy();
    const chain = [
      'q_foundry_smoke', 'q_foundry_pickets', 'q_foundry_hounds', 'q_foundry_sigils',
      'q_foundry_ashmaw', 'q_foundry_kilnmaster', 'q_foundry_slagheart',
    ];
    for (const q of chain) {
      expect(QUESTS[q], `quest ${q}`).toBeTruthy();
      expect(brenna.questIds).toContain(q);
    }
    expect(QUESTS.q_foundry_pickets.requiresQuest).toBe('q_foundry_smoke');
    expect(QUESTS.q_foundry_hounds.requiresQuest).toBe('q_foundry_pickets');
    expect(QUESTS.q_foundry_sigils.requiresQuest).toBe('q_foundry_pickets');
    expect(QUESTS.q_foundry_ashmaw.requiresQuest).toBe('q_foundry_hounds');
    expect(QUESTS.q_foundry_kilnmaster.requiresQuest).toBe('q_foundry_sigils');
    expect(QUESTS.q_foundry_slagheart.requiresQuest).toBe('q_foundry_kilnmaster');
    expect(QUESTS.q_foundry_slagheart.suggestedPlayers).toBe(5);
    expect(QUESTS.q_foundry_slagheart.objectives[0].targetMobId).toBe('slagheart_colossus');
  });
```

- [ ] **Step 4: Run the whole file plus the guard suites**

Run: `npx vitest run tests/foundry.test.ts tests/dungeons.test.ts tests/temple.test.ts tests/architecture.test.ts`
Expected: all PASS. If a boss-mechanics assertion fails, check the field names against `MobTemplate` in `src/sim/types.ts` (the temple test at `tests/temple.test.ts:67-94` is the working reference for `summonAdds`/`enrage`/`enraged`).

- [ ] **Step 5: Determinism spot-check**

Add one final test to the describe block:

```ts
  it('is deterministic: the same seed spawns the same instance', () => {
    const run = () => {
      const sim = makeWorld();
      const a = sim.addPlayer('warrior', 'Aleph');
      const door = DUNGEONS.emberdeep_foundry.doorPos;
      teleport(sim, a, door.x, door.z);
      sim.enterDungeon('emberdeep_foundry', a);
      for (let i = 0; i < 20 * 5; i++) sim.tick();
      return [...sim.entities.values()]
        .filter((e) => e.kind === 'mob' && e.pos.x > 4400)
        .map((e) => [e.templateId, Math.round(e.pos.x * 100), Math.round(e.pos.z * 100), e.hp]);
    };
    expect(run()).toEqual(run());
  });
```

Run: `npx vitest run tests/foundry.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
npx @biomejs/biome check --write tests/foundry.test.ts
git add tests/foundry.test.ts
git commit -m "test(dungeons): Emberdeep Foundry entry, bosses, collision, loot, and chain"
```

---

### Task 5: Renderer interior variant (ember palette + magma channels)

**Files:**
- Modify: `src/render/dungeon.ts` (union at :61, `TORCH_COLORS` at :112, layout pick at :666, temple-water branch at :690, `variantFor` at :888)

No vitest covers renderer geometry (three.js is out of unit-test scope); verification is `tsc`, the build, and the manual tour in Task 7.

- [ ] **Step 1: Add the variant and palette**

In the `DungeonInteriorVariant` union (line 61), add `| 'foundry'` after `| 'temple'`.

In `TORCH_COLORS` (line 112), add after the `temple` entry:

```ts
  // the Emberdeep Foundry burns hot, forge-ember over basalt (warmer and deeper
  // than the arena's amber braziers, brighter than the delve grave-ember)
  foundry: { flame: 0xffa050, emissive: 0xd54a10, light: 0xff7f36 },
```

In `variantFor` (line 888 area), add alongside the temple line:

```ts
    if (interior === 'foundry') return 'foundry';
```

In the layout pick inside `buildInterior` (line 666), extend the ternary chain with a foundry case that resolves `FOUNDRY_LAYOUT` (add `FOUNDRY_LAYOUT` to the existing `sim/dungeon_layout` import at the top of the file):

```ts
    const layout =
      opts?.layout ??
      (interior === 'sanctum'
        ? SANCTUM_LAYOUT
        : interior === 'temple'
          ? TEMPLE_LAYOUT
          : interior === 'foundry'
            ? FOUNDRY_LAYOUT
            : interior === 'arena'
              ? ARENA_LAYOUT
              : interior === 'nythraxis'
                ? NYTHRAXIS_LAYOUT
                : CRYPT_LAYOUT);
```

- [ ] **Step 2: Retint the temple water shader into magma**

The temple flood water is built by `templeWaterMaterial()` (its GLSL starts at `TEMPLE_WATER_VERT`, line 148). Parameterize its colors, keeping temple output byte-identical:

1. Read `templeWaterMaterial()` and the `TEMPLE_WATER_FRAG` shader. Identify every hardcoded color (the water tint, glow, and fresnel colors appear as `vec3(...)` literals or uniform initial values).
2. Lift those colors into uniforms (or a `palette` argument with the current values as defaults) so `templeWaterMaterial()` with no arguments produces exactly today's material.
3. Add a foundry palette constant next to `MARSH_WALL_TINT` (line 141):

```ts
// The Emberdeep magma channels reuse the temple flood-water shader retinted:
// molten rock in the wall channels instead of moonlit water on the floor.
const FOUNDRY_MAGMA = { deep: 0x7a1e04, shallow: 0xe25a10, glow: 0xffb066 };
```

(Map `deep`/`shallow`/`glow` onto whatever the three lifted colors actually are; name them after their role in the shader, not these placeholders' names.)

- [ ] **Step 3: Place the magma channels**

In `buildInterior`, next to the temple branch (line 690), add:

```ts
    if (variant === 'foundry') {
      this.placeMagmaChannels(group, layout);
    }
```

And add the method (next to `placeFloodwater`):

```ts
  // Two molten channels running the length of the side walls (over the
  // dormant-crucible rows), plus a glow pool under the anvil dais. Reuses the
  // temple water sheet retinted; the channels are cosmetic (no hazard).
  private placeMagmaChannels(group: THREE.Group, layout: DungeonLayout): void {
    const mat = this.templeWaterMaterial(FOUNDRY_MAGMA);
    const length = layout.zMax - layout.zMin - 8;
    for (const sx of [-19.5, 19.5]) {
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(3, length).rotateX(-Math.PI / 2), mat);
      strip.position.set(sx, 0.06, (layout.zMin + layout.zMax) / 2);
      strip.frustumCulled = false;
      group.add(strip);
      this.addTorchGlow(group, sx, layout.sideWallZ, TORCH_COLORS.foundry.light, 0.07, 2.0);
    }
    const pool = new THREE.Mesh(
      new THREE.CircleGeometry(layout.dais.r + 1.5, 24).rotateX(-Math.PI / 2),
      mat,
    );
    pool.position.set(layout.dais.x, 0.06, layout.dais.z);
    pool.frustumCulled = false;
    group.add(pool);
  }
```

Adjust the `templeWaterMaterial(FOUNDRY_MAGMA)` call to whatever signature Step 2 produced, and match `addTorchGlow`'s real signature (`addTorchGlow(group, x, z, color, y?, scale?)`; see call sites at lines 1632 and 1645). If the water material multiplies against scene fog or floor color in a way that reads wrong as magma, tune only the palette constants, not the shader.

- [ ] **Step 4: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean. The `TORCH_COLORS: Record<Variant, TorchColors>` type makes a missing `foundry` entry a compile error, which is the guard for Step 1.

- [ ] **Step 5: Commit**

```bash
npx @biomejs/biome check --write src/render/dungeon.ts
git add src/render/dungeon.ts
git commit -m "feat(render): foundry interior variant, ember torches and magma channels"
```

---

### Task 6: i18n registration and guide regen

**Files:**
- Modify: `src/ui/world_entity_i18n.ts` (the `MOB_IDS`, `NPC_IDS`, `QUEST_IDS`, `DUNGEON_IDS` const lists)
- Regenerate: `src/guide/content.generated.ts` (via `npm run wiki:content`), i18n status artifacts (via `npm run i18n:gen`)

Background: `tEntity` falls back to the English name straight from the sim data tables (`src/ui/entity_i18n.ts:207-217`), so the game renders correctly with zero i18n edits; these id-list registrations are what enrolls the new entities in the translation registry (English-only is correct at PR tier; the maintainer fills locales at release). Do NOT touch `src/ui/i18n.locales/*` or the `merge.ts` entity overlay (that inline-all-locales path is the maintainer's, used once for the temple).

- [ ] **Step 1: Register the ids**

In `src/ui/world_entity_i18n.ts`:

- Append to `MOB_IDS` (keep one id per line, matching the file style): `'emberpact_zealot'`, `'cinderhound'`, `'ashmaw_kilnborn'`, `'emberpact_cinderpriest'`, `'emberpact_kiln_acolyte'`, `'slag_hound'`, `'ash_revenant'`, `'emberbound_custodian'`, `'forgeguard_sentinel'`, `'molten_crucible_tender'`, `'cinder_wisp'`, `'kilnmaster_vorr'`, `'slagheart_colossus'`.
- Append to `NPC_IDS`: `'forgewright_brenna'`.
- Append to `QUEST_IDS` (line 204 area): `'q_foundry_smoke'`, `'q_foundry_pickets'`, `'q_foundry_hounds'`, `'q_foundry_sigils'`, `'q_foundry_ashmaw'`, `'q_foundry_kilnmaster'`, `'q_foundry_slagheart'`.
- Append to `DUNGEON_IDS` (line 207): `'emberdeep_foundry'`.

- [ ] **Step 2: Regenerate and run the i18n guards**

```bash
npm run i18n:gen
npx vitest run tests/localization_fixes.test.ts tests/i18n_completeness.test.ts
```

Expected: PASS. If `i18n_completeness` reds on a wordy value (the M16 rule), it means a new CATALOG key was added somewhere; this task adds none, so investigate rather than filling locales. Commit whatever `i18n:gen` regenerated (resolved tables, `i18n.status.summary.json`, hash) alongside the source change.

- [ ] **Step 3: Regenerate the guide**

```bash
npm run wiki:content
npx vitest run tests/guide.test.ts
```

Expected: `content.generated.ts` changes (the new dungeon, mobs, quests surface in the wiki data) and the guide test passes. If `tests/guide.test.ts` fails on a MISSING STILL for a new creature figure, run `npm run wiki:stills` (needs a headless browser; run `npm run dev` first if it requires the dev server) and commit the new `public/guide-stills/*.webp`. If stills cannot be generated in this environment, note it in the PR body as a follow-up and check whether the guide test failure is soft (skipped) or hard; a hard failure blocks the merge and the stills must be produced.

- [ ] **Step 4: Commit**

```bash
git add src/ui/world_entity_i18n.ts src/guide/content.generated.ts public/guide-stills src/ui/i18n.resolved.generated src/ui/i18n.status.summary.json src/ui/i18n.resolved.sha256
git commit -m "feat(i18n): register Emberdeep Foundry entities and regenerate guide content"
```

(Adjust the `git add` list to what actually changed; never hand-edit any generated file.)

---

### Task 7: Full verification sweep and manual tour

**Files:** none new.

- [ ] **Step 1: The full gate**

```bash
npx tsc --noEmit
npm test
npm run build
npm run ci:changed
```

Expected: all green. `npm test` runs `pretest` (`i18n:gen` + `wiki:content` freshness), the architecture guard, the S3 guard, and the parity suite. If a `tests/parity` golden trace fails, STOP and investigate: the content module must not add rng draws to shared paths (spawning inside a claimed instance draws from the shared stream only on entry, which is player-triggered and legal; a failure here means something else got touched).

- [ ] **Step 2: Manual in-game tour (offline, dev cheats auto-enabled)**

```bash
npm run dev
```

In the browser at http://localhost:5173, enter the world, then in chat:

1. `/dev level 20`
2. `/dev give slagrend_cleaver` and `/dev give forgelord_warhelm` (equip both)
3. `/dev tp -150 770`, verify the Emberpact camps and the picket posts render on the approach, then walk into the forge door.
4. Inside: verify the ember torch palette and magma channels; pull a slag hound pack; check the chamber waists block movement at |x| > 5 while the center passage walks through; verify Vorr summons wisps at 65%; verify the Colossus fight, `Slag Eruption` floating text, and the loot window offers the epic helm roll.
5. `/dev tp 20 668` and check Brenna offers `Smoke Over the Crags`; `/dev quest q_foundry_smoke` fast-forwards it.
6. Walk out the exit portal and confirm you return to the door.

- [ ] **Step 3: QA gate**

Dispatch the repo QA agents before the PR (per the root CLAUDE.md): `qa-checklist` over the full diff, plus `architecture-reviewer` (a `src/sim/` change) and `cross-platform-sync` (new content must mirror identically through `ClientWorld`; no `IWorld` change is expected, which the agent should confirm).

- [ ] **Step 4: Push and open the PR**

```bash
git push -u fork feature/emberdeep-foundry
gh pr create --repo levy-street/world-of-claudecraft --base release/v0.21.0 --head MarchalMaxim:feature/emberdeep-foundry --title "feat(content): the Emberdeep Foundry, an endgame dungeon in Thornpeak Heights" --body "<summarize: what, why, the spec/plan links, test coverage, the index-6 note, and the stills status>"
```

(No emojis in the PR body. The push runs the pre-push QA floor; `src/ui/i18n.status.json` must exist locally, so run `npm run i18n:gen` first if a fresh clone.)
