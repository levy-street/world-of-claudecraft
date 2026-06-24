// Characterization + spec tests for moving Brother Aldric (the raid turn-in
// actor) from a friendly *mob* to a proper, dynamically-spawned *NPC*.
//
// Why this file exists: the encounter spawns `brother_aldric_raid` as a mob with
// `hostile=false` and hand-assigned `questIds`. That leaks: the online client
// only reconstructs questIds for `kind==='npc'` (src/net/online.ts) and only
// opens the gossip/turn-in dialog for `kind==='npc'` (src/game/interactions.ts),
// so players cannot hand in "Scourge's End" at the raid Aldric.
//
// These tests pin both the regression surface (turn-in authority, dialogue,
// movement, cleanup, determinism — must STAY green) and the target behavior
// (Aldric is an NPC, registered-but-not-auto-placed, reconstructed on the wire —
// RED until the feature lands). Sections tagged [SPEC] assert the post-change
// contract; [GUARD] sections must remain green across the change.

import { describe, expect, it } from 'vitest';
import { handlePickedEntity, hoverCursorKind, isAttackableEntity } from '../src/game/interactions';
import { ClientWorld } from '../src/net/online';
import { DUNGEONS, instanceOrigin, NPCS, QUESTS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

const ALDRIC_ID = 'brother_aldric_raid';
const FINAL_QUEST = 'q_nythraxis_scourges_end';
const BOSS_ID = 'nythraxis_scourge_of_thornpeak';

// --- harness (mirrors tests/nythraxis_raid.test.ts) -------------------------

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

function attune(sim: Sim, pid: number) {
  sim.players.get(pid)?.questsDone.add('q_nythraxis_bound_guardian');
}

function formRaid(sim: Sim, leaderPid: number) {
  while ((sim.partyOf(leaderPid)?.members.length ?? 1) < 5) {
    const pid = sim.addPlayer('priest', `RaidFill${sim.players.size}`);
    sim.partyInvite(pid, leaderPid);
    sim.partyAccept(pid);
  }
  sim.convertPartyToRaid(leaderPid);
}

function enterRaid(sim: Sim, pid: number) {
  attune(sim, pid);
  formRaid(sim, pid);
  sim.enterDungeon('nythraxis_boss_arena', pid);
  const p = sim.entities.get(pid)!;
  return instanceOrigin(DUNGEONS.nythraxis_boss_arena.index, sim.instanceSlotAt(p.pos)!);
}

function boss(sim: Sim): Entity {
  const found = [...sim.entities.values()].find((e) => e.templateId === BOSS_ID && !e.dead);
  expect(found, 'Nythraxis should spawn on raid entry').toBeTruthy();
  return found!;
}

// Kind-agnostic on purpose: must locate Aldric whether he is a mob (today) or an
// NPC (after the change).
function aldric(sim: Sim): Entity | undefined {
  return [...sim.entities.values()].find((e) => e.templateId === ALDRIC_ID && !e.dead);
}

function phaseOneState(): NonNullable<Entity['nythraxis']> {
  return {
    phase: 1,
    introSpoken: true,
    transitionStarted: false,
    transitionTimer: 0,
    transitionCues: [],
    transitionReleased: false,
    dialogueBusyUntil: 0,
    dialogueToken: 0,
    gravebreakerTimer: 999,
    gravebreakerCasts: 0,
    raiseFallenTimer: 999,
    soulRendTimer: 999,
    soulRendMarks: [],
    soulRendLockout: 0,
    deathlessTimer: 999,
    deathlessCastRemaining: 0,
    deathlessStunRemaining: 0,
    wardChannels: [],
    finalStand: false,
    deathSpoken: false,
  } as NonNullable<Entity['nythraxis']>;
}

// Drive the boss across the phase-1 -> phase-2 threshold, which spawns Aldric.
function spawnAldric(sim: Sim): { b: Entity; tank: Entity; tankPid: number } {
  const tankPid = sim.addPlayer('warrior', 'Tank');
  const origin = enterRaid(sim, tankPid);
  const tank = sim.entities.get(tankPid)!;
  tank.maxHp = 1e7;
  tank.hp = tank.maxHp;
  const b = boss(sim);
  b.moveSpeed = 0;
  b.swingTimer = 999;
  teleport(sim, tankPid, origin.x, origin.z + 20);
  b.inCombat = true;
  b.aiState = 'attack';
  b.aggroTargetId = tank.id;
  b.threat.set(tank.id, 1000);
  b.nythraxis = phaseOneState();
  b.hp = Math.floor(b.maxHp * 0.5); // under the 70% phase-two threshold
  sim.tick();
  return { b, tank, tankPid };
}

// --- [SPEC] NPC registry contract ------------------------------------------

describe('[SPEC] brother_aldric_raid is a registered NPC, not a mob template', () => {
  it('is defined in NPCS with the final quest as a turn-in', () => {
    const def = NPCS[ALDRIC_ID];
    expect(def, 'brother_aldric_raid must be registered in NPCS').toBeTruthy();
    expect(def?.questIds).toContain(FINAL_QUEST);
  });

  it('is flagged dynamic so the world-init loop does not surface-place it', () => {
    // NpcDef gains an optional `dynamic` flag; the encounter spawns Aldric, the
    // world loader must skip him.
    expect((NPCS[ALDRIC_ID] as { dynamic?: boolean } | undefined)?.dynamic).toBe(true);
  });

  it('the final quest still names Aldric as a valid turn-in target', () => {
    const q = QUESTS[FINAL_QUEST] as { turnInNpcId: string; turnInNpcIds?: string[] };
    const ids = q.turnInNpcIds && q.turnInNpcIds.length > 0 ? q.turnInNpcIds : [q.turnInNpcId];
    expect(ids).toContain(ALDRIC_ID);
  });
});

// --- [GUARD] world-init placement ------------------------------------------

describe('[GUARD] dynamic NPCs are not auto-placed, ordinary NPCs are', () => {
  it('does not surface-spawn Aldric at world start', () => {
    const sim = makeWorld();
    const placed = [...sim.entities.values()].filter((e) => e.templateId === ALDRIC_ID);
    expect(placed).toHaveLength(0);
  });

  it('still surface-spawns the ordinary Highwatch Aldric NPC', () => {
    const sim = makeWorld();
    const highwatch = [...sim.entities.values()].find(
      (e) => e.templateId === 'brother_aldric_highwatch',
    );
    expect(highwatch, 'ordinary NPCs must keep auto-spawning').toBeTruthy();
    expect(highwatch?.kind).toBe('npc');
  });
});

// --- [SPEC] dynamic spawn shape --------------------------------------------

describe('[SPEC] the encounter spawns Aldric as an NPC entity', () => {
  it('spawns a kind=npc, non-hostile, level-20 Aldric carrying the final quest', () => {
    const sim = makeWorld();
    spawnAldric(sim);
    const a = aldric(sim);
    expect(a, 'Aldric should spawn at the phase-two transition').toBeTruthy();
    expect(a?.kind).toBe('npc'); // RED today: he is created via createMob
    expect(a?.hostile).toBe(false);
    expect(a?.level).toBe(20);
    expect(a?.questIds).toContain(FINAL_QUEST);
  });

  it('registers Aldric inside the active instance', () => {
    const sim = makeWorld();
    spawnAldric(sim);
    const a = aldric(sim)!;
    const inInstance = (sim as any).instances.some((i: any) => i.mobIds.includes(a.id));
    expect(inInstance).toBe(true);
  });
});

// --- [GUARD] encounter still drives Aldric (depends on findNythraxisAldric) --

describe('[GUARD] the encounter can still find and animate Aldric', () => {
  it('walks Aldric across the room during the transition', () => {
    const sim = makeWorld();
    spawnAldric(sim);
    const a = aldric(sim)!;
    const start = { x: a.pos.x, z: a.pos.z };
    for (let i = 0; i < 20; i++) sim.tick(); // 1s of transition movement
    const moved = Math.hypot(a.pos.x - start.x, a.pos.z - start.z);
    expect(moved, 'Aldric should walk in during the transition').toBeGreaterThan(0);
  });

  it('despawns Aldric when the encounter resets', () => {
    const sim = makeWorld();
    const { b } = spawnAldric(sim);
    expect(aldric(sim)).toBeTruthy();
    (sim as any).resetNythraxisEncounter(b);
    expect(
      aldric(sim),
      'reset must drop Aldric (findNythraxisAldric must match him)',
    ).toBeUndefined();
  });
});

// --- [GUARD] server-side turn-in authority ---------------------------------

describe("[GUARD] turning in Scourge's End at Aldric works server-side", () => {
  function readyToTurnIn(sim: Sim) {
    const { tankPid } = spawnAldric(sim);
    const a = aldric(sim)!;
    const meta = sim.players.get(tankPid)!;
    meta.questsDone.delete(FINAL_QUEST);
    meta.questLog.set(FINAL_QUEST, { questId: FINAL_QUEST, counts: [1], state: 'ready' });
    return { tankPid, a, meta };
  }

  it('grants completion and the copper reward when standing on Aldric', () => {
    const sim = makeWorld();
    const { tankPid, a, meta } = readyToTurnIn(sim);
    teleport(sim, tankPid, a.pos.x, a.pos.z);
    const before = meta.copper;
    sim.turnInQuest(FINAL_QUEST, tankPid);
    expect(meta.questsDone.has(FINAL_QUEST)).toBe(true);
    expect(meta.copper).toBe(before + QUESTS[FINAL_QUEST].copperReward);
  });

  it('rejects the turn-in from out of range', () => {
    const sim = makeWorld();
    const { tankPid, meta } = readyToTurnIn(sim);
    teleport(sim, tankPid, 99999, 99999);
    const events = sim.turnInQuest(FINAL_QUEST, tankPid) as unknown as
      | { type: string; text?: string }[]
      | undefined;
    expect(meta.questsDone.has(FINAL_QUEST)).toBe(false);
    void events;
  });
});

// --- [SPEC] online client reconstructs Aldric's quest from NPCS -------------

describe('[SPEC] the online client recognizes Aldric as a quest NPC', () => {
  function bareClient(pid: number): ClientWorld {
    const c: any = Object.create(ClientWorld.prototype);
    c.cfg = { seed: 42, playerClass: 'warrior' };
    c.entities = new Map();
    c.missingSince = new Map(); // despawn-grace bookkeeping (set by the real field initializer)
    c.playerId = pid;
    c.questLog = new Map();
    c.questsDone = new Set();
    c.lastSnapAt = 0;
    c.snapInterval = 50;
    c.connected = true;
    c.eventQueue = [];
    return c;
  }

  it('reconstructs questIds for an Aldric NPC identity record', () => {
    const client = bareClient(1);
    const wire = {
      id: 7,
      k: 'npc',
      tid: ALDRIC_ID,
      nm: 'Brother Aldric',
      lv: 20,
      x: 100,
      y: 0,
      z: 100,
      f: 0,
    };
    (client as any).applySnapshot({ t: 'snap', ents: [wire] });
    const mirrored = client.entities.get(7);
    expect(mirrored, 'client should mirror the Aldric entity').toBeTruthy();
    expect(mirrored?.kind).toBe('npc');
    // RED today: NPCS[ALDRIC_ID] is undefined, so questIds resolves to [].
    expect(mirrored?.questIds).toContain(FINAL_QUEST);
  });
});

// --- client interaction: why mob fails, why NPC works ----------------------

describe('client interaction classification', () => {
  function npcAldric(): Entity {
    return {
      id: 9,
      kind: 'npc',
      templateId: ALDRIC_ID,
      hostile: false,
      dead: false,
      pos: { x: 0, y: 0, z: 0 },
    } as Entity;
  }
  function mobAldric(): Entity {
    return {
      id: 9,
      kind: 'mob',
      templateId: ALDRIC_ID,
      hostile: false,
      dead: false,
      pos: { x: 0, y: 0, z: 0 },
    } as Entity;
  }

  it('[GUARD] an NPC Aldric shows the friendly cursor and is not attackable', () => {
    const a = npcAldric();
    expect(hoverCursorKind(a, 1, new Set())).toBe('friendly');
    expect(isAttackableEntity(a, 1)).toBe(false);
  });

  it('[CHARACTERIZATION] a friendly *mob* Aldric is neither attackable nor friendly-clickable', () => {
    // Documents the current bug: a non-hostile mob falls through every cursor
    // arm to "default", so the client never offers an interaction.
    const a = mobAldric();
    expect(isAttackableEntity(a, 1)).toBe(false);
    expect(hoverCursorKind(a, 1, new Set())).toBe('default');
  });

  it('[GUARD] clicking an in-range NPC Aldric opens the quest/turn-in dialog', () => {
    const player = { id: 1, kind: 'player', pos: { x: 0, y: 0, z: 0 } } as Entity;
    const a = npcAldric();
    let opened: number | null = null;
    const world: any = {
      playerId: 1,
      player,
      entities: new Map<number, Entity>([
        [1, player],
        [9, a],
      ]),
      duelInfo: null,
      arenaInfo: null,
      targetEntity: () => {},
      enterDungeon: () => {},
      leaveDungeon: () => {},
      pickUpObject: () => {},
      startAutoAttack: () => {},
    };
    const hud = {
      openLoot: () => {},
      openQuestDialog: (id: number) => {
        opened = id;
      },
      openDelveBoard: () => {},
      showError: () => {},
      closeContextMenu: () => {},
    };
    handlePickedEntity(world, hud, 9, 2, 10, 20); // right-click, in range
    expect(opened).toBe(9);
  });
});

// --- [GUARD] determinism ----------------------------------------------------

describe('[GUARD] Aldric spawn is deterministic', () => {
  it('produces the same Aldric id and position for the same seed', () => {
    const a = makeWorld();
    const b = makeWorld();
    spawnAldric(a);
    spawnAldric(b);
    const aa = aldric(a)!;
    const bb = aldric(b)!;
    expect(aa.id).toBe(bb.id);
    expect(aa.pos.x).toBeCloseTo(bb.pos.x, 6);
    expect(aa.pos.z).toBeCloseTo(bb.pos.z, 6);
  });
});
