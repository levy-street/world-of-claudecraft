// Escort quest runs (src/sim/escort.ts) through the real Sim on the shipped
// Frostveil content: idle spawn, quest-gated start, the waypoint walk, ambush
// waves that attack the escortee and pause the walk, failure + respawn, and
// the success credit that readies the quest.
import { describe, expect, it } from 'vitest';
import { visualKeyFor } from '../src/render/characters/manifest';
import { ESCORTS, MOBS, NPCS, QUESTS, ZONES } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { dist2d, type Entity, LEASH_DISTANCE, type SimEvent } from '../src/sim/types';
import { groundHeight, WATER_LEVEL } from '../src/sim/world';

const ESCORT_ID = 'esc_fv_wren';
const QUEST_ID = 'q_fv_seeing_wren_home';
const ESCORTEE_TEMPLATE = 'apprentice_wren';

function makeSim(): Sim {
  const sim = new Sim({ seed: 424242, playerClass: 'warrior', playerName: 'Escorter' });
  sim.player.level = 20;
  return sim;
}

function findEscortee(sim: Sim): Entity | undefined {
  return [...sim.entities.values()].find(
    (e) => e.kind === 'mob' && e.templateId === ESCORTEE_TEMPLATE && !e.dead,
  );
}

function teleportTo(sim: Sim, x: number, z: number): void {
  const pos = sim.groundPos(x, z);
  sim.player.pos = { ...pos };
  sim.player.prevPos = { ...pos };
}

function activateQuest(sim: Sim): void {
  sim.questLog.set(QUEST_ID, { questId: QUEST_ID, counts: [0], state: 'active' });
}

// The run's own ambush wave (never the zone's natural camps of the same
// template: the Shiverfen has a resident fen_sprite camp).
function liveAmbushers(sim: Sim): Entity[] {
  const ids = sim.escortRuns.get(ESCORT_ID)?.run?.ambushIds ?? [];
  return ids.map((id) => sim.entities.get(id)).filter((e): e is Entity => !!e && !e.dead);
}

function tickMany(sim: Sim, ticks: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) events.push(...sim.tick());
  return events;
}

describe('escort content integrity', () => {
  it('resolves every escort def against the content tables', () => {
    expect(Object.keys(ESCORTS).length).toBeGreaterThan(0);
    for (const def of Object.values(ESCORTS)) {
      expect(MOBS[def.npcMobId], `${def.id} escortee template`).toBeTruthy();
      // The run drives all movement; wander AI must never move the escortee.
      expect(MOBS[def.npcMobId].moveSpeed).toBe(0);
      expect(MOBS[def.npcMobId].aggroRadius).toBe(0);
      const quest = QUESTS[def.questId];
      expect(quest, `${def.id} quest`).toBeTruthy();
      const objective = quest.objectives.find((o) => o.type === 'escort' && o.escortId === def.id);
      expect(objective, `${def.id} quest escort objective`).toBeTruthy();
      expect(objective?.count).toBe(1);
      expect(def.waypoints.length).toBeGreaterThan(0);
      // Faster than the stuck-advance epsilon (0.05 yd per 1/20s tick = 1 yd/s):
      // a slower def would register as permanently stuck and skip every waypoint
      // instead of walking (see ESCORT_STUCK_MOVE_EPSILON in src/sim/escort.ts).
      expect(def.moveSpeed).toBeGreaterThan(1.0);
      for (const ambush of def.ambushes) {
        expect(MOBS[ambush.mobId], `${def.id} ambush ${ambush.mobId}`).toBeTruthy();
        expect(ambush.atWaypoint).toBeGreaterThanOrEqual(0);
        expect(ambush.atWaypoint).toBeLessThan(def.waypoints.length);
      }
    }
  });

  // The quest text is the ONLY navigation aid this game gives (there are no
  // objective markers on the map or minimap), so a wrong bearing is a
  // functional bug. Bearings must be computed under the convention the compass
  // and the map actually render: +z north, +x WEST, so east is -x (see
  // src/ui/compass.ts, and src/ui/map_terrain.ts drawing +x on the left).
  // PR #1904 previously pinned a direction "fix" to the mirrored convention by
  // reading it off content ids, so this asserts the axes explicitly.
  it('sends the player the way the compass and map actually point', () => {
    const frostveil = ZONES.find((zone) => zone.id === 'frostveil');
    const steps = frostveil?.pois?.find((poi) => poi.id === 'the_aurora_steps');
    expect(steps).toBeTruthy();
    if (!steps) return;
    const post = ESCORTS.esc_fv_wren.start;

    // East is -x: a SMALLER x than the landmark is east of it. North is +z.
    expect(post.x).toBeLessThan(steps.x);
    expect(post.z).toBeGreaterThan(steps.z);

    const text = QUESTS.q_fv_seeing_wren_home.text;
    expect(text).toContain('northeast of the Aurora Steps');
    expect(text).not.toContain('southwest');
  });

  // Bram is the other escort whose text carries a bearing. His post sits on the
  // isle's SOUTH shore: open sea a few yards south of it and none within 60
  // yards north. Sampled here rather than asserted from prose, and stable
  // across seeds (the macro coastline is authored, the seed only adds noise).
  it("puts Bram's wreck on the shore the terrain actually has", () => {
    const post = ESCORTS.esc_fs_bram.start;
    const seaDistance = (dz: number): number => {
      for (let d = 0; d <= 200; d += 2) {
        if (groundHeight(post.x, post.z + dz * d, 1337) < WATER_LEVEL) return d;
      }
      return Number.POSITIVE_INFINITY;
    };

    expect(seaDistance(-1)).toBeLessThan(20);
    expect(seaDistance(1)).toBeGreaterThan(60);

    const text = QUESTS.q_fs_bram_come_home.text;
    expect(text).toContain('on the south shore');
    expect(text).not.toContain('north shore');
  });

  // Every escortee needs an explicit body in the character manifest. The
  // humanoid family default is the hooded outlaw (mob_bandit), so an
  // unregistered escortee reads as the bandits the player is protecting them
  // from: only Wren was registered, and Mosley, Suli and Bram were not.
  it('gives every escortee an explicit character model, never the outlaw fallback', () => {
    for (const def of Object.values(ESCORTS)) {
      const key = visualKeyFor({ kind: 'mob', templateId: def.npcMobId } as Entity);
      expect(key, `${def.id} escortee model`).not.toBe('mob_bandit');
      expect(key.startsWith('npc_'), `${def.id} escortee model is ${key}`).toBe(true);
      // The body is shared, so each escortee's own tint is what tells them apart.
      expect(MOBS[def.npcMobId].color, `${def.id} tint`).toBeTypeOf('number');
    }
  });
});

describe('escort run lifecycle', () => {
  it('spawns the idle escortee at the def start, non-hostile and unattackable by players', () => {
    const sim = makeSim();
    const def = ESCORTS[ESCORT_ID];
    const wren = findEscortee(sim);
    expect(wren).toBeTruthy();
    expect(wren?.hostile).toBe(false);
    expect(
      Math.hypot((wren?.pos.x ?? 0) - def.start.x, (wren?.pos.z ?? 0) - def.start.z),
    ).toBeLessThan(2);
  });

  it('does not start without the quest, and starts (with a bark) with it active', () => {
    const sim = makeSim();
    const def = ESCORTS[ESCORT_ID];
    teleportTo(sim, def.start.x, def.start.z);
    sim.interact();
    expect(sim.escortRuns.get(ESCORT_ID)?.run ?? null).toBeNull();

    activateQuest(sim);
    sim.interact();
    const state = sim.escortRuns.get(ESCORT_ID);
    expect(state?.run).toBeTruthy();
    const events = tickMany(sim, 1);
    expect(
      events.some(
        (e) =>
          e.type === 'chat' && 'channel' in e && e.channel === 'yell' && e.text === def.startText,
      ),
    ).toBe(true);
  });

  it('walks the waypoints, fires the ambush wave onto the escortee, and pauses until it dies', () => {
    const sim = makeSim();
    const def = ESCORTS[ESCORT_ID];
    teleportTo(sim, def.start.x, def.start.z);
    activateQuest(sim);
    sim.interact();
    const wren = findEscortee(sim);
    expect(wren).toBeTruthy();
    if (!wren) return;
    const startDist = Math.hypot(wren.pos.x - def.waypoints[0].x, wren.pos.z - def.waypoints[0].z);

    // Walk until the first ambush fires (waypoint 0), bounded by a generous cap.
    let sprites: Entity[] = [];
    for (let i = 0; i < 60 * 20 && sprites.length === 0; i++) {
      sim.tick();
      sprites = liveAmbushers(sim);
    }
    expect(sprites.length).toBe(3);
    expect(sprites.every((s) => s.templateId === 'fen_sprite')).toBe(true);
    const movedDist = Math.hypot(wren.pos.x - def.waypoints[0].x, wren.pos.z - def.waypoints[0].z);
    expect(movedDist).toBeLessThan(startDist);
    // The wave opens on the escortee (seeded threat), not the far-away player.
    for (const sprite of sprites) expect(sprite.aggroTargetId).toBe(wren.id);

    // The walk holds while the wave lives, and the wave actually hurts her.
    const held = { x: wren.pos.x, z: wren.pos.z };
    tickMany(sim, 20 * 8);
    expect(Math.hypot(wren.pos.x - held.x, wren.pos.z - held.z)).toBeLessThan(4);
    expect(wren.hp).toBeLessThan(wren.maxHp);
  });

  it('fails the run when the ambush kills the escortee, then respawns it at the start', () => {
    const sim = makeSim();
    const def = ESCORTS[ESCORT_ID];
    teleportTo(sim, def.start.x, def.start.z);
    activateQuest(sim);
    sim.interact();
    const wren = findEscortee(sim);
    expect(wren).toBeTruthy();
    if (!wren) return;

    // Walk to the first ambush, then leave Wren nearly dead so the wave kills
    // her through the real mob-swing damage path.
    for (let i = 0; i < 60 * 20 && liveAmbushers(sim).length === 0; i++) sim.tick();
    expect(liveAmbushers(sim).length).toBe(3);
    const waveIds = [...(sim.escortRuns.get(ESCORT_ID)?.run?.ambushIds ?? [])];
    wren.hp = 5;
    const events: SimEvent[] = [];
    for (let i = 0; i < 30 * 20 && (sim.escortRuns.get(ESCORT_ID)?.run ?? null) !== null; i++) {
      events.push(...sim.tick());
    }
    expect(wren.dead).toBe(true);
    expect(
      events.some(
        (e) =>
          e.type === 'chat' && 'channel' in e && e.channel === 'yell' && e.text === def.failText,
      ),
    ).toBe(true);
    expect(sim.escortRuns.get(ESCORT_ID)?.run ?? null).toBeNull();
    expect(sim.questLog.get(QUEST_ID)?.counts[0]).toBe(0);
    // The failed wave leaves with the run instead of camping the respawn.
    for (const id of waveIds) {
      const mob = sim.entities.get(id);
      expect(!mob || mob.dead).toBe(true);
    }

    // Respawns at the start after the cooldown, ready for a retry.
    tickMany(sim, Math.ceil(def.respawnSeconds * 20) + 5);
    const again = findEscortee(sim);
    expect(again).toBeTruthy();
    expect(
      Math.hypot((again?.pos.x ?? 0) - def.start.x, (again?.pos.z ?? 0) - def.start.z),
    ).toBeLessThan(2);
    expect(sim.escortRuns.get(ESCORT_ID)?.run ?? null).toBeNull();
  });

  // 60s budget: drives up to 4800 real ticks of NPC pathing to the final
  // waypoint (terrain movement, not a jumpable deadline), and has been
  // measured at ~5.3s standalone, only ~3.8x headroom under the 20s default
  // (see tests/stable_yard.test.ts and tests/emerald_deck_escape.test.ts for
  // the same long-tick-loop-walker convention).
  it('credits the quest for the nearby escorting player at the final waypoint', () => {
    const sim = makeSim();
    const def = ESCORTS[ESCORT_ID];
    teleportTo(sim, def.start.x, def.start.z);
    activateQuest(sim);
    sim.interact();
    const wren = findEscortee(sim);
    expect(wren).toBeTruthy();
    if (!wren) return;

    // Drive the whole walk: whenever a wave spawns, cut it down (the test digs
    // the escort logic, not the combat math) and keep the player near the NPC.
    let credited = false;
    for (let i = 0; i < 240 * 20 && !credited; i++) {
      for (const mob of liveAmbushers(sim)) {
        mob.hp = 0;
        mob.dead = true;
        // Park the generic camp respawn so the test kill stays dead.
        mob.respawnTimer = 99999;
      }
      teleportTo(sim, wren.pos.x + 2, wren.pos.z + 2);
      const events = sim.tick();
      credited = events.some((e) => e.type === 'questReady' && e.questId === QUEST_ID);
    }
    expect(credited).toBe(true);
    expect(sim.questLog.get(QUEST_ID)?.state).toBe('ready');
    expect(sim.questLog.get(QUEST_ID)?.counts[0]).toBe(1);
    // The escortee has left the world and its def is on respawn cooldown.
    expect(findEscortee(sim)).toBeUndefined();

    // Turn-in at Aurorist Veyla (the destination) completes the chain.
    const veyla = NPCS.aurorist_veyla;
    teleportTo(sim, veyla.pos.x, veyla.pos.z);
    const npcEntity = [...sim.entities.values()].find(
      (e) => e.kind === 'npc' && e.templateId === 'aurorist_veyla',
    );
    expect(npcEntity).toBeTruthy();
    if (!npcEntity) return;
    sim.talkToNpc(npcEntity.id);
    expect(sim.questLog.get(QUEST_ID)?.state ?? 'done').toBe('done');
  }, 60_000);
});

describe('escort run guards', () => {
  it('fails a run that outlives the timeout', () => {
    const sim = makeSim();
    const def = ESCORTS[ESCORT_ID];
    teleportTo(sim, def.start.x, def.start.z);
    activateQuest(sim);
    sim.interact();
    const state = sim.escortRuns.get(ESCORT_ID);
    expect(state?.run).toBeTruthy();
    if (!state?.run) return;
    // Backdate the start beyond the run timeout: the next driver tick fails it.
    state.run.startedAt = -10000;
    const events = tickMany(sim, 1);
    expect(
      events.some(
        (e) =>
          e.type === 'chat' && 'channel' in e && e.channel === 'yell' && e.text === def.failText,
      ),
    ).toBe(true);
    expect(sim.escortRuns.get(ESCORT_ID)?.run ?? null).toBeNull();
  });

  it('stuck-advances a walker pinned in place instead of wedging the run', () => {
    const sim = makeSim();
    const def = ESCORTS[ESCORT_ID];
    teleportTo(sim, def.start.x, def.start.z);
    activateQuest(sim);
    sim.interact();
    const wren = findEscortee(sim);
    const state = sim.escortRuns.get(ESCORT_ID);
    expect(wren && state?.run).toBeTruthy();
    if (!wren || !state?.run) return;
    // Pin the walker: undo whatever the driver moved every tick, simulating a
    // collider that absorbs all progress. After ESCORT_STUCK_TICKS the driver
    // must count the waypoint as reached rather than stalling to the timeout.
    const pin = { x: wren.pos.x, z: wren.pos.z };
    const before = state.run.waypointIndex;
    for (let i = 0; i < 120 && state.run && state.run.waypointIndex === before; i++) {
      sim.tick();
      wren.pos.x = pin.x;
      wren.pos.z = pin.z;
    }
    expect(state.run?.waypointIndex ?? before + 1).toBeGreaterThan(before);
  });

  // 60s budget: four sequential real-tick loops (walk to ambush, evade past
  // the leash, re-engage, resume the attack) with a cumulative worst case of
  // 6600 ticks of mob AI/leash simulation that cannot be jumped ahead, the
  // same long-tick-loop-walker convention as tests/stable_yard.test.ts and
  // tests/emerald_deck_escape.test.ts.
  it('re-engages an evaded ambush wave onto the escortee instead of wedging the run', () => {
    const sim = makeSim();
    const def = ESCORTS[ESCORT_ID];
    teleportTo(sim, def.start.x, def.start.z);
    activateQuest(sim);
    sim.interact();
    const wren = findEscortee(sim);
    const state = sim.escortRuns.get(ESCORT_ID);
    expect(wren && state?.run).toBeTruthy();
    if (!wren || !state?.run) return;

    // Walk to the first ambush.
    for (let i = 0; i < 60 * 20 && liveAmbushers(sim).length === 0; i++) sim.tick();
    const wave = liveAmbushers(sim);
    expect(wave.length).toBe(3);

    // Wound one mob through the real damage path so the full-health check
    // below can prove the walk-home reset (which heals) actually ran.
    sim.dealDamage(sim.player, wave[0], 50, false, 'physical', null, 'hit');
    expect(wave[0].hp).toBeLessThan(wave[0].maxHp);

    // The live-server kite: drag the whole wave far past its leash. The chase
    // exceeds LEASH_DISTANCE, the mobs evade home, and the evade reset clears
    // their hate tables, the escortee seed included. Without the driver
    // re-commit they would idle beside the waiting escortee until the run
    // timeout (the reported "escortee just stops walking" wedge).
    for (const mob of wave) {
      const far = sim.groundPos(mob.pos.x + 80, mob.pos.z);
      mob.pos = { ...far };
      mob.prevPos = { ...far };
      // Precondition pin: the drag genuinely exceeds the leash, so the pass
      // below exercises a real evade, not the surviving spawn commitment.
      expect(dist2d(mob.pos, wren.pos)).toBeGreaterThan(LEASH_DISTANCE);
    }
    let reengaged = false;
    for (let i = 0; i < 120 * 20 && !reengaged; i++) {
      sim.tick();
      const live = liveAmbushers(sim);
      reengaged =
        live.length === 3 &&
        live.every((m) => m.aggroTargetId === wren.id && (m.threat.get(wren.id) ?? 0) > 0);
    }
    expect(reengaged).toBe(true);
    // Full health proves the re-commit happened AFTER the walk-home reset
    // (resetEvadingMob heals), not on the leash-break tick: the escort driver
    // must never bypass the leash contract.
    for (const mob of liveAmbushers(sim)) expect(mob.hp).toBe(mob.maxHp);

    // The wave resumes the ATTACK, not just the aggro fields: the escortee
    // takes fresh hits after the re-commit.
    const hpAtReengage = wren.hp;
    for (let i = 0; i < 120 * 20 && wren.hp >= hpAtReengage; i++) sim.tick();
    expect(wren.hp).toBeLessThan(hpAtReengage);

    // With the wave re-committed, cutting it down releases the walk: the run
    // survives and advances past the held waypoint instead of stalling to the
    // timeout or failing.
    const before = state.run?.waypointIndex ?? -1;
    for (const mob of liveAmbushers(sim)) {
      mob.hp = 0;
      mob.dead = true;
      mob.respawnTimer = 99999;
    }
    for (let i = 0; i < 30 * 20 && state.run !== null && state.run.waypointIndex <= before; i++) {
      sim.tick();
    }
    expect(wren.dead).toBe(false);
    expect(state.run).not.toBeNull();
    expect(state.run?.waypointIndex ?? before).toBeGreaterThan(before);
  }, 60_000);

  it('never re-seeds a wave mob a player is actively fighting', () => {
    const sim = makeSim();
    const def = ESCORTS[ESCORT_ID];
    teleportTo(sim, def.start.x, def.start.z);
    activateQuest(sim);
    sim.interact();
    const wren = findEscortee(sim);
    expect(wren).toBeTruthy();
    if (!wren) return;
    for (let i = 0; i < 60 * 20 && liveAmbushers(sim).length === 0; i++) sim.tick();
    const mob = liveAmbushers(sim)[0];
    expect(mob).toBeTruthy();

    // The player pulls one wave mob through the real damage path: their
    // threat towers over the escortee seed and the mob turns on them.
    teleportTo(sim, mob.pos.x + 2, mob.pos.z);
    sim.dealDamage(sim.player, mob, 50, false, 'physical', null, 'hit');
    for (let i = 0; i < 20; i++) sim.tick();
    expect(mob.dead).toBe(false);
    expect(mob.aggroTargetId).toBe(sim.player.id);
    // The driver never re-seeded the fight: the escortee entry is still the
    // untouched spawn seed of 1, below the player's damage threat.
    expect(mob.threat.get(wren.id) ?? 0).toBeLessThanOrEqual(1);
    expect(mob.threat.get(sim.player.id) ?? 0).toBeGreaterThan(1);
  });

  it('a slain wave unravels after its loot window instead of respawning into the run', {
    timeout: 60_000,
  }, () => {
    const sim = makeSim();
    const def = ESCORTS[ESCORT_ID];
    teleportTo(sim, def.start.x, def.start.z);
    activateQuest(sim);
    sim.interact();
    for (let i = 0; i < 60 * 20 && liveAmbushers(sim).length === 0; i++) sim.tick();
    const waveIds = [...(sim.escortRuns.get(ESCORT_ID)?.run?.ambushIds ?? [])];
    expect(waveIds.length).toBe(3);
    // Cut the wave down through the real damage path so death runs the full
    // handleDeath arm (corpse window, respawn timer assignment).
    for (const mob of liveAmbushers(sim)) {
      sim.dealDamage(sim.player, mob, 999999, false, 'physical', null, 'hit');
    }
    // Pre-fix, the generic in-place camp respawn (cfg default 25s, deferred by
    // the corpse window) revived the wave into ambushIds and wedged or
    // re-attacked any run still walking. Now the summoned-add arm drops the
    // corpse once its loot window (60s) lapses, and the mob NEVER comes back.
    // corpseTimer is a plain DT countdown checked per tick (mob/locomotion.ts),
    // not something the assertions need 2000 real ticks to observe: jump it to
    // the edge of its window, the same way tests/loot_master_sim.test.ts jumps
    // its own per-roll expiresAt deadline instead of ticking through the full
    // 5-minute curate window (da4441ffa4). Ticking the whole 100 sim-seconds
    // one tick at a time pushed this file past the 20s default under any CPU
    // contention with zero extra coverage: every intermediate tick can only
    // ever observe "still dead" or "gone", the same two states a 2-tick jump
    // proves.
    for (const id of waveIds) {
      const mob = sim.entities.get(id);
      expect(mob).toBeTruthy();
      if (mob) mob.corpseTimer = 0.1;
    }
    for (let i = 0; i < 10; i++) {
      sim.tick();
      for (const id of waveIds) {
        const mob = sim.entities.get(id);
        expect(!mob || mob.dead).toBe(true);
      }
    }
    for (const id of waveIds) expect(sim.entities.get(id)).toBeUndefined();
  });
});

// Every authored escort route must be WALKABLE in the real world: the escortee
// has to reach its final waypoint against real terrain and colliders (a
// waypoint inside a rock or across deep water would strand every run at the
// timeout). Drives each def's full walk with waves auto-culled.
describe('every escort route completes in the real world', () => {
  for (const def of Object.values(ESCORTS)) {
    // 90s budget: drives up to 6000 real ticks of NPC pathing across authored
    // terrain per def (not a jumpable deadline). Measured 4.66s to 8.66s
    // standalone per def, only ~2.3x to 4.3x headroom under the 20s default,
    // the same long-tick-loop-walker convention as
    // tests/emerald_deck_escape.test.ts's walkRoute tests and
    // tests/stable_yard.test.ts's long real-world tick run.
    it(`${def.id} walks its full route to credit`, () => {
      const sim = makeSim();
      teleportTo(sim, def.start.x, def.start.z);
      sim.questLog.set(def.questId, { questId: def.questId, counts: [0], state: 'active' });
      sim.interact();
      const state = sim.escortRuns.get(def.id);
      expect(state?.run, `${def.id} run started`).toBeTruthy();
      const npcId = state?.npcId;
      const npc = npcId !== null && npcId !== undefined ? sim.entities.get(npcId) : undefined;
      expect(npc).toBeTruthy();
      if (!npc) return;
      let credited = false;
      for (let i = 0; i < 300 * 20 && !credited; i++) {
        const run = sim.escortRuns.get(def.id)?.run;
        for (const id of run?.ambushIds ?? []) {
          const mob = sim.entities.get(id);
          if (mob && !mob.dead) {
            mob.hp = 0;
            mob.dead = true;
            mob.respawnTimer = 99999;
          }
        }
        teleportTo(sim, npc.pos.x + 2, npc.pos.z + 2);
        const events = sim.tick();
        credited = events.some((e) => e.type === 'questReady' && e.questId === def.questId);
      }
      expect(credited, `${def.id} reached its destination`).toBe(true);
    }, 90_000);
  }
});
