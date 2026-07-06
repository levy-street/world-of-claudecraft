import { describe, expect, it } from 'vitest';
import { MIRROR_LAYOUT } from '../src/sim/content/mirror_world';
import {
  ITEMS,
  MOBS,
  NPCS,
  PAD_LOCKED_ALL,
  PORTAL_PADS,
  QUESTS,
  WORLD_MAX_Z,
  ZONES,
  zoneAt,
} from '../src/sim/data';
import { PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { Sim } from '../src/sim/sim';
import { groundHeight, terrainHeight, WATER_LEVEL } from '../src/sim/world';

const SEED = 42;
const L = MIRROR_LAYOUT;

function makeSim() {
  return new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
}

// Test idiom from tests/CLAUDE.md: set pos, snap y to terrain, copy prevPos.
function teleport(sim: Sim, pid: number, x: number, z: number): void {
  const p = sim.entities.get(pid);
  if (!p) throw new Error('no player entity');
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = terrainHeight(x, z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
}

describe('Mirror World zone data', () => {
  it('is the 4th zone band and extends the world north', () => {
    expect(ZONES).toHaveLength(4);
    expect(ZONES[3].id).toBe('mirror_world');
    expect(zoneAt(1080).id).toBe('mirror_world');
    expect(zoneAt(890).id).toBe('thornpeak_heights');
    expect(WORLD_MAX_Z).toBe(1260);
  });

  it('pairs every travelable pad with a dest outside any pad trigger radius', () => {
    for (const pad of PORTAL_PADS) {
      if (PAD_LOCKED_ALL.has(pad.id)) continue; // sealed to all: its dest never fires
      for (const other of PORTAL_PADS) {
        const d = Math.hypot(pad.dest.x - other.pos.x, pad.dest.z - other.pos.z);
        expect(d, `${pad.id} dest lands inside ${other.id} trigger`).toBeGreaterThan(3);
      }
    }
  });
});

describe('the trench seal', () => {
  it('has no walkable step across the zone-3 seam (portal is the only way)', () => {
    const step = 0.5;
    for (let x = -175; x <= 175; x += 5) {
      let steepest = 0;
      for (let z = 875; z <= 925; z += step) {
        const rise = terrainHeight(x, z + step, SEED) - terrainHeight(x, z, SEED);
        steepest = Math.max(steepest, rise / step);
      }
      expect(steepest, `climbable column at x=${x}`).toBeGreaterThan(PLAYER_MAX_CLIMB_SLOPE);
    }
  });

  it('cannot be jump-hopped: spamming jump into the seal never crosses it', () => {
    // The seam terrain is steeper than the climb limit (test above), but a
    // player used to ratchet across it by spamming space — the slope-wall check
    // ran only while grounded, so each jump carried horizontal velocity uphill.
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true });
    const p = sim.player;
    // stand in Thornpeak Heights just south of the seal, facing north (+z).
    p.pos.x = 0;
    p.pos.z = 862;
    p.pos.y = terrainHeight(0, 862, sim.cfg.seed);
    p.prevPos = { ...p.pos };
    p.facing = 0; // (sin 0, cos 0) = +z, toward the Mirror World
    let maxZ = p.pos.z;
    for (let i = 0; i < 20 * 15; i++) {
      sim.moveInput.forward = true;
      sim.moveInput.jump = true;
      sim.tick();
      maxZ = Math.max(maxZ, p.pos.z);
    }
    // advanced north to the unclimbable face (movement works) but the seal
    // crest (z~900) and the vale beyond are never reached by jump-hopping.
    expect(maxZ, 'player advanced north toward the seal').toBeGreaterThan(866);
    expect(maxZ, 'jump-hopping must not near the seal crest').toBeLessThan(895);
    expect(p.pos.z, 'player ends up south of the seal, not in the vale').toBeLessThan(895);
  });
});

describe('the domed country', () => {
  it('shapes the vale: town, court, lake, canyon, and an unclimbable rim', () => {
    // authored landmarks hold their heights
    expect(terrainHeight(-8, 1022, SEED)).toBeCloseTo(8, 0); // the town rise
    expect(terrainHeight(-8, 1055, SEED)).toBeCloseTo(9, 0); // the Mirror Court
    expect(terrainHeight(0, 962, SEED)).toBeCloseTo(22, 0); // the Overlook
    expect(terrainHeight(-52, 950, SEED)).toBeCloseTo(30, 0); // Stargazer's Ledge
    // the arrival stair is the one walkable way down the south wall
    const stair = (z0: number, z1: number) => {
      let steepest = 0;
      for (let z = z0; z < z1; z += 1) {
        steepest = Math.max(
          steepest,
          Math.abs(terrainHeight(0, z + 1, SEED) - terrainHeight(0, z, SEED)),
        );
      }
      return steepest;
    };
    expect(stair(966, 1008)).toBeLessThan(PLAYER_MAX_CLIMB_SLOPE);
    // the rim is sheer everywhere it matters: sample outward crossings
    const crossings: [number, number, number, number][] = [
      [0, 1200, 0, 1250], // north
      [120, 1085, 165, 1085], // east
      [-120, 1085, -165, 1085], // west
      [60, 970, 95, 935], // southeast shoulder
    ];
    for (const [x0, z0, x1, z1] of crossings) {
      let steepest = 0;
      const steps = 40;
      for (let i = 0; i < steps; i++) {
        const ax = x0 + ((x1 - x0) * i) / steps;
        const az = z0 + ((z1 - z0) * i) / steps;
        const bx = x0 + ((x1 - x0) * (i + 1)) / steps;
        const bz = z0 + ((z1 - z0) * (i + 1)) / steps;
        const run = Math.hypot(bx - ax, bz - az) || 1;
        steepest = Math.max(
          steepest,
          Math.abs(terrainHeight(bx, bz, SEED) - terrainHeight(ax, az, SEED)) / run,
        );
      }
      expect(steepest, `rim crossing ${x0},${z0}`).toBeGreaterThan(PLAYER_MAX_CLIMB_SLOPE);
    }
  });

  it('carves the Mirrormere: swimmable middle, wadeable shore, dry banks', () => {
    const L = MIRROR_LAYOUT;
    expect(terrainHeight(L.lake.x, L.lake.z, SEED)).toBeLessThan(WATER_LEVEL - 0.8); // swims
    expect(terrainHeight(L.lake.x, L.lake.z - L.lake.r - 6, SEED)).toBeGreaterThan(
      WATER_LEVEL + 0.5,
    ); // the south bank is dry where the road runs
  });
});

describe('the black canyon', () => {
  it('keeps the canyon floor walkable between sheer walls', () => {
    const L = MIRROR_LAYOUT;
    // along the floor: gentle
    let steepest = 0;
    for (let i = 0; i < L.canyon.points.length - 1; i++) {
      const a = L.canyon.points[i];
      const b = L.canyon.points[i + 1];
      const steps = 16;
      for (let j = 0; j < steps; j++) {
        const ax = a.x + ((b.x - a.x) * j) / steps;
        const az = a.z + ((b.z - a.z) * j) / steps;
        const bx = a.x + ((b.x - a.x) * (j + 1)) / steps;
        const bz = a.z + ((b.z - a.z) * (j + 1)) / steps;
        const run = Math.hypot(bx - ax, bz - az) || 1;
        steepest = Math.max(
          steepest,
          Math.abs(terrainHeight(bx, bz, SEED) - terrainHeight(ax, az, SEED)) / run,
        );
      }
    }
    expect(steepest).toBeLessThan(PLAYER_MAX_CLIMB_SLOPE);
  });

  it('walls the canyon so the only way through is along it', () => {
    // crossing the canyon sideways at its midpoint climbs the rim
    let steepest = 0;
    const steps = 30;
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps;
      const t1 = (i + 1) / steps;
      const ax = 126 + (150 - 126) * t0;
      const az = 1204 + (1180 - 1204) * t0;
      const bx = 126 + (150 - 126) * t1;
      const bz = 1204 + (1180 - 1204) * t1;
      const run = Math.hypot(bx - ax, bz - az) || 1;
      steepest = Math.max(
        steepest,
        Math.abs(terrainHeight(bx, bz, SEED) - terrainHeight(ax, az, SEED)) / run,
      );
    }
    expect(steepest).toBeGreaterThan(PLAYER_MAX_CLIMB_SLOPE);
  });
});

describe('portal pads', () => {
  it('spawns one pad object per PORTAL_PADS entry', () => {
    const sim = makeSim();
    const pads = [...sim.entities.values()].filter((e) => e.templateId === 'portal_pad');
    expect(pads).toHaveLength(PORTAL_PADS.length);
  });

  it('seals town mirrors behind their tolls, then carries once each is paid', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Diver');
    teleport(sim, pid, 110, 800);
    sim.tick();
    const p = sim.entities.get(pid);
    if (!p) throw new Error('player vanished');
    expect(p.pos.z).toBeCloseTo(958, 0); // the entrance mirror lands on the Overlook
    expect(zoneAt(p.pos.z).id).toBe('mirror_world');
    // locked: walking into the Highwatch mirror at the court bounces
    teleport(sim, pid, -18, 1054);
    sim.tick();
    expect(zoneAt(p.pos.z).id).toBe('mirror_world');
    expect(Math.hypot(p.pos.x + 18, p.pos.z - 1054)).toBeGreaterThan(2); // pushed off the glass
    // the Sable Mirror gate is sealed to everyone, always
    teleport(sim, pid, 158, 1228);
    sim.tick();
    expect(zoneAt(p.pos.z).id).toBe('mirror_world');
    // pay all three tolls and the mirrors carry
    const meta = (sim as any).players.get(pid);
    meta.questsDone.add('q_gargoyle_south');
    meta.questsDone.add('q_gargoyle_west');
    meta.questsDone.add('q_gargoyle_north');
    teleport(sim, pid, -18, 1054);
    sim.tick();
    expect(p.pos.z).toBeCloseTo(652, 0);
    expect(zoneAt(p.pos.z).id).toBe('thornpeak_heights');
    teleport(sim, pid, -8, 1058);
    sim.tick();
    expect(p.pos.z).toBeCloseTo(8, 0);
    expect(zoneAt(p.pos.z).id).toBe('eastbrook_vale');
    teleport(sim, pid, 2, 1054);
    sim.tick();
    expect(p.pos.z).toBeCloseTo(306, 0);
    expect(zoneAt(p.pos.z).id).toBe('mirefen_marsh');
  });

  it("runs the Lumen Lift between the town and Stargazer's Ledge", () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Diver');
    teleport(sim, pid, -24, 1034);
    sim.tick();
    const p = sim.entities.get(pid);
    if (!p) throw new Error('player vanished');
    expect(p.pos.z).toBeCloseTo(954, 0); // up on the ledge
    teleport(sim, pid, -52, 946);
    sim.tick();
    expect(p.pos.z).toBeCloseTo(1030, 0); // back at the town gate
  });
});

describe('the belt beasts', () => {
  it('spawns every camp inside the vale near its district', () => {
    const sim = makeSim();
    const L = MIRROR_LAYOUT;
    const anchors: Record<string, { x: number; z: number; range: number }> = {
      poverty_ghost: { x: 60, z: 1070, range: 26 }, // the lake shores
      spirit_unicorn: { x: 114, z: 1100, range: 16 }, // the Moonmeadow
      hooded_reaper: { x: 100, z: 1150, range: 16 }, // the Sorrowstones
      mirrorbound_sentry: { x: 46, z: 1180, range: 16 }, // the ruin field
      gloomhulk: { x: -72, z: 1142, range: 16 }, // the Gloomcrags
      mistshade_lurker: { x: -84, z: 1088, range: 16 }, // the Darkwood
      gloaming_maw: { x: 74, z: 1114, range: 14 }, // the north inlet
    };
    for (const [id, anchor] of Object.entries(anchors)) {
      const spawned = [...sim.entities.values()].filter(
        (e) => e.kind === 'mob' && e.templateId === id,
      );
      expect(spawned.length, `${id} did not spawn`).toBeGreaterThan(0);
      for (const mob of spawned) {
        const q = Math.hypot(
          (mob.pos.x - L.vale.x) / L.vale.rx,
          (mob.pos.z - L.vale.z) / L.vale.rz,
        );
        expect(q, `${id} left the vale`).toBeLessThan(0.97);
        const d = Math.hypot(mob.pos.x - anchor.x, mob.pos.z - anchor.z);
        expect(d, `${id} strayed from its district`).toBeLessThan(anchor.range);
      }
    }
  });
});

describe("the witch's chain (content wiring)", () => {
  it('defines the recipe quest over real drops and the Echo quest over a real mob', () => {
    const recipe = QUESTS.q_deepdream_recipe;
    expect(recipe).toBeDefined();
    expect(recipe.objectives).toHaveLength(3);
    for (const obj of recipe.objectives) {
      expect(obj.type).toBe('collect');
      if (obj.itemId) expect(ITEMS[obj.itemId], `${obj.itemId} missing`).toBeDefined();
      expect(obj.count).toBe(2);
    }
    const echoQuest = QUESTS.q_face_your_echo;
    expect(echoQuest.requiresQuest).toBe('q_deepdream_recipe');
    expect(echoQuest.objectives[0].targetMobId).toBe('player_echo');
    expect(MOBS.player_echo).toBeDefined();
    // A real drop table now — but rolled by the dream win branch only AFTER
    // q_face_your_echo is done (the first win pays the Mirror Shard instead).
    expect(MOBS.player_echo.loot.length).toBeGreaterThan(0);
    for (const entry of MOBS.player_echo.loot)
      if (entry.itemId) expect(ITEMS[entry.itemId], `${entry.itemId} missing`).toBeDefined();
    // Morwen also gives the follow-up "what the glass wants" quest that traces
    // the Echo's leak back to the black glass at the canyon mouth.
    expect(NPCS.mistwitch_morwen.questIds).toEqual([
      'q_deepdream_recipe',
      'q_face_your_echo',
      'q_what_the_glass_wants',
    ]);
  });

  it('gives the draught and the shard their custom on-use hooks', () => {
    expect(ITEMS.deepdream_draught.use).toEqual({ type: 'slumber' });
    expect(ITEMS.mirror_shard.use).toEqual({ type: 'mirrorShard' });
    // recipe parts drop from the belt spirits
    expect(MOBS.poverty_ghost.loot.some((l) => l.itemId === 'white_sheet')).toBe(true);
    expect(MOBS.spirit_unicorn.loot.some((l) => l.itemId === 'spirit_horn')).toBe(true);
    expect(MOBS.hooded_reaper.loot.some((l) => l.itemId === 'black_hood')).toBe(true);
  });
});

describe("the Keeper's Vigil (Nerissa's arc wiring)", () => {
  it('chains Nerissa four-quest vigil, each self-turn-in over real targets', () => {
    const chain = [
      'q_the_failing_radiance',
      'q_what_the_poor_keep',
      'q_the_wardens_names',
      'q_relight_the_lumen_crown',
    ];
    // Nerissa gives exactly her four quests, in arc order.
    expect(NPCS.keeper_nerissa.questIds).toEqual(chain);
    for (let i = 0; i < chain.length; i++) {
      const qd = QUESTS[chain[i]];
      expect(qd, `${chain[i]} missing`).toBeDefined();
      // Vigil quests are handed out and turned in at the same keeper.
      expect(qd.giverNpcId).toBe('keeper_nerissa');
      expect(qd.turnInNpcId).toBe('keeper_nerissa');
      // Each step gates on the previous one — a linear vigil.
      expect(qd.requiresQuest).toBe(i === 0 ? undefined : chain[i - 1]);
      // Every objective resolves to a real mob or a real item.
      for (const obj of qd.objectives) {
        if (obj.type === 'kill')
          expect(MOBS[obj.targetMobId!], `${obj.targetMobId} missing`).toBeDefined();
        if (obj.type === 'collect')
          expect(ITEMS[obj.itemId!], `${obj.itemId} missing`).toBeDefined();
      }
    }
  });

  it('sources every collect objective from a mob that actually drops it', () => {
    // The Wardens' Names collects sigils cut from the canyon reapers...
    expect(QUESTS.q_the_wardens_names.objectives[0]).toMatchObject({
      type: 'collect',
      itemId: 'warden_sigil',
    });
    expect(MOBS.hooded_reaper.loot.some((l) => l.itemId === 'warden_sigil')).toBe(true);
    // ...and Relight the Lumen Crown cuts the drowned spark from the Maw.
    const relight = QUESTS.q_relight_the_lumen_crown.objectives;
    expect(relight.some((o) => o.type === 'collect' && o.itemId === 'drowned_lumen')).toBe(true);
    expect(relight.some((o) => o.type === 'kill' && o.targetMobId === 'gloaming_maw')).toBe(true);
    expect(MOBS.gloaming_maw.loot.some((l) => l.itemId === 'drowned_lumen')).toBe(true);
    // Both quest items exist and are quest-bound (no vendor path).
    for (const id of ['warden_sigil', 'drowned_lumen']) {
      expect(ITEMS[id], `${id} missing`).toBeDefined();
      expect(ITEMS[id].kind).toBe('quest');
    }
  });

  it("traces the Echo's leak: Morwen's follow-up gates on the Echo and points at the canyon", () => {
    const glass = QUESTS.q_what_the_glass_wants;
    expect(glass).toBeDefined();
    // Morwen hands out the follow-up, gated behind facing your Echo.
    expect(glass.giverNpcId).toBe('mistwitch_morwen');
    expect(glass.turnInNpcId).toBe('mistwitch_morwen');
    expect(glass.requiresQuest).toBe('q_face_your_echo');
    // It is a pure kill objective over a real canyon-mouth mob (NPCs grant no
    // kill credit — this must target a mob, not a warden statue).
    expect(glass.objectives.every((o) => o.type === 'kill')).toBe(true);
    for (const obj of glass.objectives)
      expect(MOBS[obj.targetMobId!], `${obj.targetMobId} missing`).toBeDefined();
  });
});

describe('the Deepdream chain', () => {
  const WITCH = { x: -112, z: 1164 };

  function primedSim(cls: 'warrior' | 'warlock' = 'warrior') {
    const sim = makeSim();
    const pid = sim.addPlayer(cls, 'Dreamer');
    sim.setPlayerLevel(16);
    teleport(sim, pid, WITCH.x, WITCH.z);
    sim.tick();
    return { sim, pid };
  }

  // Adopt the nearest wild mob as the dreamer's pet (the tame-result shape the
  // pet suites use), so hunter-style "you brought a beast" dreams are testable.
  function adoptPet(sim: Sim, pid: number) {
    for (const e of sim.entities.values()) {
      if (e.kind === 'mob' && !e.dead && e.ownerId === null && !e.templateId.startsWith('rare_')) {
        e.ownerId = pid;
        e.hostile = false;
        e.petMode = 'defensive';
        e.hp = e.maxHp;
        return e;
      }
    }
    throw new Error('no wild mob to adopt');
  }

  function giveParts(sim: Sim, pid: number) {
    sim.addItem('white_sheet', 2, pid);
    sim.addItem('spirit_horn', 2, pid);
    sim.addItem('black_hood', 2, pid);
  }

  function drinkAndArrive(sim: Sim, pid: number) {
    sim.useItem('deepdream_draught', pid);
    for (let i = 0; i < 61 && (sim.entities.get(pid)?.pos.x ?? 0) < 7000; i++) sim.tick();
    const p = sim.entities.get(pid);
    if (!p) throw new Error('player vanished');
    expect(p.pos.x).toBeGreaterThan(7000);
    const echoPid = (sim as any).dreamRuns.get(pid)?.echoId as number | null | undefined;
    if (echoPid === null || echoPid === undefined) throw new Error('no echo spawned');
    const echo = sim.entities.get(echoPid);
    if (!echo || echo.dead) throw new Error('echo entity missing');
    return { p, echo, echoPid };
  }

  it('refuses to brew before the recipe quest and brews repeatably after', () => {
    const { sim, pid } = primedSim();
    giveParts(sim, pid);
    sim.brewDraught(pid);
    expect(sim.countItem('deepdream_draught', pid)).toBe(0); // not attuned yet
    (sim as any).players.get(pid).questsDone.add('q_deepdream_recipe');
    sim.brewDraught(pid);
    expect(sim.countItem('deepdream_draught', pid)).toBe(1);
    expect(sim.countItem('white_sheet', pid)).toBe(0); // parts consumed
    giveParts(sim, pid);
    sim.brewDraught(pid);
    expect(sim.countItem('deepdream_draught', pid)).toBe(2); // repeatable forever
  });

  it('clones the dreamer into the Echo, drops the shard once, and wakes home', () => {
    const { sim, pid } = primedSim();
    const meta = (sim as any).players.get(pid);
    meta.questsDone.add('q_deepdream_recipe');
    sim.acceptQuest('q_face_your_echo', pid);
    giveParts(sim, pid);
    sim.brewDraught(pid);
    const { p, echo, echoPid } = drinkAndArrive(sim, pid);
    // the Echo is a full bot-player clone wearing the dreamer's name and sheet
    expect(echo.kind).toBe('player');
    expect(echo.name).toBe(p.name);
    expect(echo.templateId).toBe(p.templateId); // same class
    expect(echo.level).toBe(p.level);
    expect(echo.maxHp).toBe(p.maxHp);
    expect(echo.weapon).toEqual(p.weapon);
    expect(echo.attackPower).toBe(p.attackPower);
    expect(echo.stats.armor).toBe(p.stats.armor);
    // the whole ability kit mirrors (same known ids, ranks included)
    const kit = (id: number) =>
      ((sim as any).players.get(id).known as { def: { id: string } }[]).map((k) => k.def.id);
    expect(kit(echoPid)).toEqual(kit(pid));
    // mutually lethal inside the dream, and flagged red for every host
    expect(echo.hostile).toBe(true);
    expect(sim.isHostileTo(p, echo)).toBe(true);
    expect(sim.isHostileTo(echo, p)).toBe(true);
    // strike it down → the once-ever shard + quest credit + the trip home
    (sim as any).dealDamage(p, echo, echo.hp, false, 'physical', null, 'hit');
    for (let i = 0; i < 90 && sim.entities.get(pid)!.pos.x > 7000; i++) sim.tick();
    expect(sim.countItem('mirror_shard', pid)).toBe(1);
    expect(meta.mirrorShardWon).toBe(true);
    expect(meta.questLog.get('q_face_your_echo')?.state).toBe('ready');
    expect(p.pos.x).toBeCloseTo(WITCH.x, 0);
    expect(p.pos.z).toBeCloseTo(WITCH.z, 0);
    // a second dream never drops a second shard
    giveParts(sim, pid);
    sim.brewDraught(pid);
    const second = drinkAndArrive(sim, pid);
    (sim as any).dealDamage(p, second.echo, second.echo.hp, false, 'physical', null, 'hit');
    for (let i = 0; i < 90 && sim.entities.get(pid)!.pos.x > 7000; i++) sim.tick();
    expect(sim.countItem('mirror_shard', pid)).toBe(1);
  });

  it('fights back with the mirrored kit (the dreamer bleeds without scripted hits)', () => {
    const { sim, pid } = primedSim();
    const meta = (sim as any).players.get(pid);
    meta.questsDone.add('q_deepdream_recipe');
    giveParts(sim, pid);
    sim.brewDraught(pid);
    const { p } = drinkAndArrive(sim, pid);
    // hands off: the Echo closes, swings, and casts on its own cadence
    for (let i = 0; i < 20 * 8 && !p.dead; i++) sim.tick();
    expect(p.hp).toBeLessThan(p.maxHp);
  });

  it('a summoner Echo always fields its demon, even when the dreamer has none out', () => {
    const { sim, pid } = primedSim('warlock');
    const meta = (sim as any).players.get(pid);
    meta.questsDone.add('q_deepdream_recipe');
    giveParts(sim, pid);
    sim.brewDraught(pid);
    expect(sim.petOf(pid, true)).toBeNull(); // nothing at the dreamer's heel
    const { echoPid } = drinkAndArrive(sim, pid);
    const echoPet = sim.petOf(echoPid, true);
    if (!echoPet) throw new Error('summoner echo fielded no demon');
    // it fields the strongest demon the dreamer's own kit can summon
    let strongest: string | null = null;
    for (const k of (sim as any).players.get(pid).known as { def: { effects: any[] } }[]) {
      for (const ef of k.def.effects) if (ef.type === 'summonDemon') strongest = ef.mobId;
    }
    expect(strongest).not.toBeNull();
    expect(echoPet.templateId).toBe(strongest);
    expect(echoPet.dead).toBe(false);
  });

  it("mirrors the dreamer's own pet and walks it in and out of the dream", () => {
    const { sim, pid } = primedSim();
    const meta = (sim as any).players.get(pid);
    meta.questsDone.add('q_deepdream_recipe');
    const myPet = adoptPet(sim, pid);
    giveParts(sim, pid);
    sim.brewDraught(pid);
    const { p, echo, echoPid } = drinkAndArrive(sim, pid);
    // the dreamer's beast came along instead of pathing at a dead end
    expect(myPet.pos.x).toBeGreaterThan(7000);
    // ...and the Echo fields an exact counterpart, answering to the same name
    const echoPet = sim.petOf(echoPid, true);
    if (!echoPet) throw new Error('echo fielded no counterpart pet');
    expect(echoPet.templateId).toBe(myPet.templateId);
    expect(echoPet.name).toBe(myPet.name);
    expect(sim.isHostileTo(p, echoPet)).toBe(true); // fair game via its owner
    // win and wake: the counterpart despawns with its owner, ours walks out
    (sim as any).dealDamage(p, echo, echo.hp, false, 'physical', null, 'hit');
    for (let i = 0; i < 90 && sim.entities.get(pid)!.pos.x > 7000; i++) sim.tick();
    expect(sim.entities.has(echoPid)).toBe(false);
    expect(sim.entities.has(echoPet.id)).toBe(false);
    expect(myPet.pos.x).toBeLessThan(7000); // back at the waking-world heel
    expect(myPet.ownerId).toBe(pid);
  });

  it('wakes a slain dreamer at home with no corpse run', () => {
    const { sim, pid } = primedSim();
    const meta = (sim as any).players.get(pid);
    meta.questsDone.add('q_deepdream_recipe');
    giveParts(sim, pid);
    sim.brewDraught(pid);
    const { p, echo } = drinkAndArrive(sim, pid);
    (sim as any).dealDamage(echo, p, p.hp, false, 'physical', null, 'hit');
    expect(p.dead).toBe(true);
    for (let i = 0; i < 80 && sim.entities.get(pid)!.pos.x > 7000; i++) sim.tick();
    expect(p.dead).toBe(false); // woke, not graveyarded
    expect(p.pos.x).toBeCloseTo(WITCH.x, 0);
    expect(sim.countItem('mirror_shard', pid)).toBe(0);
  });

  it('grants a permanent primary stat when the shard is consumed', () => {
    const { sim, pid } = primedSim();
    const meta = (sim as any).players.get(pid);
    const p = sim.entities.get(pid);
    if (!p) throw new Error('player vanished');
    sim.addItem('mirror_shard', 1, pid);
    const before = p.stats.str;
    sim.useItem('mirror_shard', pid);
    expect(p.stats.str).toBe(before + 3); // warrior archetype → strength
    expect(sim.countItem('mirror_shard', pid)).toBe(0);
    expect(meta.permanentStats.str).toBe(3);
    const state = sim.serializeCharacter(pid);
    expect(state?.permanentStats?.str).toBe(3);
  });

  it('persists the waking-world spot, never the shadow realm', () => {
    const { sim, pid } = primedSim();
    const meta = (sim as any).players.get(pid);
    meta.questsDone.add('q_deepdream_recipe');
    giveParts(sim, pid);
    sim.brewDraught(pid);
    drinkAndArrive(sim, pid);
    const state = sim.serializeCharacter(pid);
    expect(state?.pos.x).toBeCloseTo(WITCH.x, 0);
    expect(state?.pos.z).toBeCloseTo(WITCH.z, 0);
  });
});

describe('determinism', () => {
  it('replays the portal round trip identically', () => {
    const run = () => {
      const sim = makeSim();
      const pid = sim.addPlayer('warrior', 'Diver');
      teleport(sim, pid, 110, 800);
      for (let i = 0; i < 60; i++) sim.tick();
      const p = sim.entities.get(pid);
      if (!p) throw new Error('player vanished');
      return { x: p.pos.x, z: p.pos.z, entities: sim.entities.size };
    };
    expect(run()).toEqual(run());
  });
});

describe('the mirror guardians (gargoyles)', () => {
  function sentinels(sim: Sim) {
    return [...sim.entities.values()].filter(
      (e) => e.kind === 'npc' && e.templateId.startsWith('gargoyle_sentinel'),
    );
  }

  it('stations a sentinel beside each of the three town mirrors', () => {
    const sim = makeSim();
    const gs = sentinels(sim);
    expect(gs).toHaveLength(3);
    const mirrors = [
      { x: -18, z: 1054 },
      { x: -8, z: 1058 },
      { x: 2, z: 1054 },
    ];
    for (const g of gs) {
      // each statue stands in the niche beside its mirror across the court crescent
      const near = mirrors.some((m) => Math.hypot(g.pos.x - m.x, g.pos.z - m.z) < 9);
      expect(near, `${g.templateId} is not posted at a mirror`).toBe(true);
    }
  });

  it('a bow stirs the statue: its toll-quest opens and the mirror unlocks at turn-in', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Curtsey');
    teleport(sim, pid, -18, 1058);
    sim.tick();
    // hidden until the courtesy
    expect(sim.questState('q_gargoyle_south', pid)).toBe('unavailable');
    sim.bowToGargoyle(pid);
    expect(
      sim.bowedGargoyles.has('gargoyle_sentinel_south') ||
        (sim as any).players.get(pid).bowedGargoyles.has('gargoyle_sentinel_south'),
    ).toBe(true);
    expect(sim.questState('q_gargoyle_south', pid)).toBe('available');
    // the courtesy is a real bow — the emote fires in the same beat
    expect(sim.entities.get(pid)?.overheadEmoteId).toBe('bow');
    expect(sentinels(sim)).toHaveLength(3);
    // run the toll: kill credit, turn-in, and the mirror unseals with an event
    sim.acceptQuest('q_gargoyle_south', pid);
    const meta = (sim as any).players.get(pid);
    const qp = meta.questLog.get('q_gargoyle_south');
    qp.counts[0] = 6;
    qp.state = 'ready';
    (sim as any).drainEvents();
    sim.turnInQuest('q_gargoyle_south', pid);
    const evs = (sim as any).drainEvents() as { type: string; padId?: string }[];
    expect(meta.questsDone.has('q_gargoyle_south')).toBe(true);
    expect(evs.some((e) => e.type === 'mirrorUnlocked' && e.padId === 'mirrorgate_return')).toBe(
      true,
    );
    // and the mirror now carries
    teleport(sim, pid, -18, 1054);
    sim.tick();
    const p = sim.entities.get(pid);
    expect(p?.pos.z ?? 0).toBeCloseTo(652, 0);
  });

  it('wakes into a hostile level-99 boss with the full kit, statue gone', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Challenger');
    teleport(sim, pid, -18, 1058);
    sim.tick();
    sim.wakeGargoyle(pid);
    expect(sentinels(sim)).toHaveLength(2); // the south statue stepped down
    const boss = [...sim.entities.values()].find(
      (e) => e.kind === 'mob' && e.templateId === 'gargoyle_awakened',
    );
    if (!boss) throw new Error('no awakened gargoyle');
    expect(boss.level).toBe(99);
    expect(boss.hostile).toBe(true);
    expect(boss.aggroTargetId).toBe(pid); // it opens on the challenger
    // the kit is scripted, not just run-and-swing
    expect(MOBS.gargoyle_awakened.stomp).toBeDefined();
    expect(MOBS.gargoyle_awakened.aoePulse).toBeDefined();
    expect(MOBS.gargoyle_awakened.terrify).toBeDefined();
    expect(MOBS.gargoyle_awakened.stoneskin).toBeDefined();
    expect(MOBS.gargoyle_awakened.enrage).toBeDefined();
  });

  it('returns to its plinth after the boss dies', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Challenger');
    teleport(sim, pid, -18, 1058);
    sim.tick();
    sim.wakeGargoyle(pid);
    const boss = [...sim.entities.values()].find(
      (e) => e.kind === 'mob' && e.templateId === 'gargoyle_awakened',
    );
    if (!boss) throw new Error('no awakened gargoyle');
    (sim as any).dealDamage(
      sim.entities.get(pid),
      boss,
      boss.hp + 10,
      false,
      'physical',
      null,
      'hit',
      true,
    );
    expect(boss.dead).toBe(true);
    sim.tick(); // updateGargoyles arms the respawn window
    const st = [...(sim as any).awakenedGargoyles.values()][0] as { respawnAt: number | null };
    expect(st.respawnAt).not.toBeNull();
    expect((st.respawnAt ?? 0) - (sim as any).time).toBeGreaterThan(55);
    // fast-forward the window instead of grinding 1200 wall ticks
    (st as any).respawnAt = (sim as any).time + 0.3;
    for (let i = 0; i < 12; i++) sim.tick();
    expect(sentinels(sim)).toHaveLength(3); // the statue is back
    expect((sim as any).awakenedGargoyles.size).toBe(0);
  });
});

describe('echo rewards', () => {
  const WITCH = { x: -112, z: 1164 };

  function dreamOnce(cls: 'warrior' | 'warlock' = 'warrior') {
    const sim = makeSim();
    const pid = sim.addPlayer(cls, 'Dreamer');
    sim.setPlayerLevel(16);
    teleport(sim, pid, WITCH.x, WITCH.z);
    sim.tick();
    const meta = (sim as any).players.get(pid);
    meta.questsDone.add('q_deepdream_recipe');
    sim.addItem('deepdream_draught', 1, pid);
    sim.useItem('deepdream_draught', pid);
    for (let i = 0; i < 61 && (sim.entities.get(pid)?.pos.x ?? 0) < 7000; i++) sim.tick();
    const p = sim.entities.get(pid);
    if (!p) throw new Error('player vanished');
    const echoPid = (sim as any).dreamRuns.get(pid)?.echoId as number | null;
    if (echoPid === null || echoPid === undefined) throw new Error('no echo');
    const echo = sim.entities.get(echoPid);
    if (!echo) throw new Error('echo missing');
    return { sim, pid, p, echo, meta };
  }

  it('pays regular kill XP for every win, quest or no quest', () => {
    const { sim, pid, p, echo, meta } = dreamOnce();
    const xpBefore = meta.xp;
    (sim as any).dealDamage(p, echo, echo.hp + 10, false, 'physical', null, 'hit', true);
    sim.tick(); // the win branch fires
    expect(meta.xp).toBeGreaterThan(xpBefore); // an even-level kill is never free
  });

  it('rolls normal drops only once the Echo quest is done', () => {
    // quest NOT done: the first-ever win pays the shard and nothing else
    const first = dreamOnce();
    const copperBefore = first.meta.copper;
    (first.sim as any).dealDamage(
      first.p,
      first.echo,
      first.echo.hp + 10,
      false,
      'physical',
      null,
      'hit',
      true,
    );
    first.sim.tick();
    expect(first.meta.copper).toBe(copperBefore); // no purse from the mirror
    expect(first.sim.countItem('mirror_shard', first.pid)).toBe(1);

    // quest done: the echo drops like a normal humanoid of the band
    const second = dreamOnce();
    second.meta.questsDone.add('q_face_your_echo');
    second.meta.mirrorShardWon = true; // not the first rodeo
    const copperStart = second.meta.copper;
    (second.sim as any).dealDamage(
      second.p,
      second.echo,
      second.echo.hp + 10,
      false,
      'physical',
      null,
      'hit',
      true,
    );
    second.sim.tick();
    expect(second.meta.copper).toBeGreaterThan(copperStart); // the guaranteed purse roll
    expect(second.sim.countItem('mirror_shard', second.pid)).toBe(0); // shard stays once-ever
  });
});

describe('echo combat behavior', () => {
  it('buffs up before engaging and works its whole kit, not just swings', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Dreamer');
    sim.setPlayerLevel(16);
    teleport(sim, pid, -112, 1164);
    sim.tick();
    const meta = (sim as any).players.get(pid);
    meta.questsDone.add('q_deepdream_recipe');
    sim.addItem('deepdream_draught', 1, pid);
    sim.useItem('deepdream_draught', pid);
    for (let i = 0; i < 61 && (sim.entities.get(pid)?.pos.x ?? 0) < 7000; i++) sim.tick();
    const echoPid = (sim as any).dreamRuns.get(pid)?.echoId as number;
    const echo = sim.entities.get(echoPid);
    if (!echo) throw new Error('no echo');
    // give the mirror room to open its ritual and rotation — a rage mirror
    // must swing its way up to the shout's cost first (~15s)
    for (let i = 0; i < 20 * 25 && !sim.entities.get(pid)?.dead; i++) sim.tick();
    // the opening ritual raised at least one self-buff (Battle Shout et al.)
    const buffed = echo.auras.some((a) => a.kind === 'buff_ap');
    // and the dreamer carries evidence of real abilities: a bleed/dot or debuff
    const p = sim.entities.get(pid);
    const marked =
      (p?.auras.length ?? 0) > 0 || (p?.dead ?? false) || (p?.hp ?? 1) < (p?.maxHp ?? 1);
    expect(buffed, 'echo never raised its shout').toBe(true);
    expect(marked).toBe(true);
  });
});
