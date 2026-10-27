// The Hammer Council (docs/design/raid/smith_heart.md section 7.1): the
// Quarry's first boss is three stone beings sharing the Hammer's strength, the
// Guardian of the Hammer (the tank boss, council_wrath.ts), the Slabwright (the
// pillar maker, council_stone.ts) and the Seam Singer (the caster,
// council_song.ts), fought round the quarry's pillars (council_pillars.ts).
//
//   One pull       the three share one authored pack: pulling one pulls all
//                  three, and a member whose foe fell is put back on the fight
//                  with its siblings' hate while any of them fights.
//   One wipe       the fight ends when no living member is fighting: every
//                  fallen member stands up whole at its place (no reward twice,
//                  Entity.regrown), the five columns stand whole again, the
//                  risen pillars, marks, rubble and stacks go.
//   One kill       complete only when all three are dead: the Slab, the heart
//                  seal's Hammer vein and every credit wait on all three
//                  (content/smith_heart.ts gate, seal.ts). The risen pillars
//                  sink back into the floor.
//   The stone remembers
//                  when one falls, each survivor gains a stack of Memory of
//                  Stone (more damage dealt) and takes up the fallen one's job
//                  in a worse form (council_scope.ts jobHolder): the pillars
//                  under random players on a 2 s warning, the song on three
//                  that no kick stops, a shorter Wrath. The last one carries
//                  both.
//
// Difficulty: the claim's (heroic Resonance overlaps Wrath, two marks for
// Wake the Stone, the pillars pulse), with a dev switch for a run while the
// raid has no heroic tier of its own (setCouncilDevHeroic). Mythic, a
// prototype behind its own dev switch until the game has a mythic tier
// (setCouncilDevTier), is one more COUNCIL_DIFFICULTY row: stronger
// inheritances, the rock outliving the Slabwright, and Soul in the Stone
// (council_soul.ts: a fallen member's soul takes a pillar).
//
// Deterministic: every pick is hashed or ordered (roles, roster, entity ids);
// the only rng draws are damage rolls, in claim-player order. Every visible
// state rides existing entity fields (cast bars with their targets, the
// energy as the holder's resource, auras on the players and on the council,
// the pillar, rubble and rise-spot objects, `spellfx` cues), so the online
// client mirrors the whole fight with no wire or IWorld change.

import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { addThreat, clearThreat } from '../../threat';
import { DT, type Entity } from '../../types';
import { regrowHead } from '../drowned_temple/hydra_regrowth';
import { claimBoss, dropAuraById } from '../sunken_bastion/claim';
import {
  COUNCIL_AURAS,
  COUNCIL_CASTS,
  COUNCIL_CUES,
  COUNCIL_DIFFICULTY,
  COUNCIL_NAMES,
  COUNCIL_ROLES,
  COUNCIL_TEMPLATES,
  type CouncilDifficulty,
  type CouncilRole,
  COUNCIL_TUNING as T,
} from './council_ids';
import {
  clearRubble,
  ensurePillarWalls,
  pulsePillars,
  restorePillars,
  settlePillars,
  stepRubble,
} from './council_pillars';
import {
  type CouncilScope,
  damageMult,
  holdPlantedAt,
  living,
  quarryPlayers,
  raidWarn,
} from './council_scope';
import {
  applyResonance,
  clearSong,
  clearSongBars,
  landBolt,
  landSong,
  songKicked,
  startBolt,
  startSong,
  stepResonance,
} from './council_song';
import {
  crumbleSouls,
  soulDevTrigger,
  soulReadout,
  stepSouls,
  syncSoulsToTier,
  takeSoul,
} from './council_soul';
import type { CouncilFightState } from './council_state';
import {
  clearStone,
  clearStoneBars,
  landRockBar,
  landWake,
  startRock,
  startWake,
  stepRises,
  stepRock,
} from './council_stone';
import { councilSay, sayFallen, stepCouncilVoice } from './council_voice';
import {
  clearWrathBars,
  fillEnergy,
  landWeight,
  landWrath,
  startWeight,
  startWrath,
  syncEnergyBars,
} from './council_wrath';

// ---- the dev difficulty switches ------------------------------------------------------

/** Claims a dev playtest switched to heroic or mythic (`/dev heart council
 *  heroic|mythic`), keyed by the claim's identity and its exit so a recycled
 *  slot never inherits it; one tier at a time (switching one on switches
 *  the other off). Dev-gated by its one caller (sim/dev/smith_heart_dev.ts). */
const devTier = new WeakMap<InstanceSlot, { exitId: number; tier: 'heroic' | 'mythic' }>();

export function setCouncilDevTier(
  inst: InstanceSlot,
  tier: 'heroic' | 'mythic',
  on: boolean,
): void {
  if (on && inst.exitId !== null) devTier.set(inst, { exitId: inst.exitId, tier });
  else if (devTier.get(inst)?.tier === tier) devTier.delete(inst);
}

export function setCouncilDevHeroic(inst: InstanceSlot, on: boolean): void {
  setCouncilDevTier(inst, 'heroic', on);
}

/** The council's difficulty in a claim. */
export function councilDifficulty(inst: InstanceSlot): CouncilDifficulty {
  const dev = inst.exitId !== null ? devTier.get(inst) : undefined;
  const tier = dev && dev.exitId === inst.exitId ? dev.tier : null;
  // Mythic exists only behind its dev switch (the game has no mythic tier).
  if (tier === 'mythic') return 'mythic';
  if (inst.difficulty === 'heroic') return 'heroic';
  return tier === 'heroic' ? 'heroic' : 'normal';
}

// ---- the bodies and the state -----------------------------------------------------------

export type CouncilBodies = Record<CouncilRole, Entity | null>;

/** The claim's three council members (dead or alive), or null when the claim
 *  holds none of them. */
export function councilBodies(ctx: SimContext, inst: InstanceSlot): CouncilBodies | null {
  const b: CouncilBodies = {
    guardian: claimBoss(ctx, inst, COUNCIL_TEMPLATES.guardian),
    slabwright: claimBoss(ctx, inst, COUNCIL_TEMPLATES.slabwright),
    singer: claimBoss(ctx, inst, COUNCIL_TEMPLATES.singer),
  };
  return b.guardian || b.slabwright || b.singer ? b : null;
}

/** The council's shared state when a fight runs (or ran to its end). */
export function councilState(bodies: CouncilBodies): CouncilFightState | null {
  for (const r of COUNCIL_ROLES) {
    const st = bodies[r]?.smithHeartFight;
    if (st) return st;
  }
  return null;
}

/** In its fight: pulled, alive, not walking home (a momentary target loss,
 *  the tank falling, still counts). */
function fighting(e: Entity | null): boolean {
  return (
    living(e) &&
    e.inCombat &&
    e.aiState !== 'evade' &&
    (e.aiState === 'chase' || e.aiState === 'attack')
  );
}

function freshState(difficulty: CouncilDifficulty): CouncilFightState {
  return {
    kind: 'council',
    difficulty,
    finished: false,
    clock: 0,
    energy: 0,
    wraths: 0,
    weightTimer: T.weightFirst,
    wakeTimer: T.wakeFirst,
    rockTimer: T.rockFirst,
    boltTimer: T.boltFirst,
    songTimer: T.songFirst,
    songDue: null,
    pulseTimer: T.pulseEvery,
    quiet: 0,
    bars: {},
    gaps: { guardian: 0, slabwright: 0, singer: 0 },
    kickable: null,
    wakeMarks: [],
    riseSpots: [],
    rock: null,
    resonance: [],
    rubble: [],
    fallen: [],
    lines: [],
    said: {},
    casts: 0,
    souls: [],
    soulsSpent: [],
  };
}

function scopeOf(
  ctx: SimContext,
  inst: InstanceSlot,
  st: CouncilFightState,
  bodies: CouncilBodies,
): CouncilScope {
  return {
    ctx,
    inst,
    st,
    bodies,
    players: quarryPlayers(ctx, inst),
    rules: COUNCIL_DIFFICULTY[st.difficulty],
  };
}

// ---- the stone remembers ----------------------------------------------------------------

/** The lines the raid reads as each one falls (raid warnings). */
const FALLEN_LINES: Readonly<Record<CouncilRole, string>> = {
  guardian: 'The Guardian of the Hammer falls. Its wrath passes into the stone that remains!',
  slabwright: 'The Slabwright falls. Now the stone rises where it will!',
  singer: 'The Seam Singer falls. Its song passes on, and no one can stop it now!',
};

/** Memory of Stone on each living member: one stack per fallen member. */
function syncMemory(s: CouncilScope): void {
  const fallen = s.st.fallen.length;
  for (const r of COUNCIL_ROLES) {
    const b = s.bodies[r];
    if (!living(b)) continue;
    const have = b.auras.find((a) => a.id === COUNCIL_AURAS.memory);
    if (fallen === 0) {
      if (have) dropAuraById(b, COUNCIL_AURAS.memory);
      continue;
    }
    const value = T.memoryPerFallen * fallen;
    if (have && have.stacks === fallen) continue;
    if (have) dropAuraById(b, COUNCIL_AURAS.memory);
    s.ctx.applyAura(b, {
      id: COUNCIL_AURAS.memory,
      name: COUNCIL_NAMES.memory,
      kind: 'buff_dmg_done',
      remaining: 3600,
      duration: 3600,
      permanent: true,
      value,
      stacks: fallen,
      sourceId: b.id,
      school: 'physical',
      undispellable: true,
    });
  }
}

/** A member fell this tick: the light flows from it into each survivor. */
function noteFallen(s: CouncilScope, role: CouncilRole, dead: Entity): void {
  s.st.fallen.push(role);
  // Its own bars and the marks it alone was running go with it.
  delete s.st.bars[role];
  if (s.st.kickable !== null && role === 'singer') s.st.kickable = null;
  for (const r of COUNCIL_ROLES) {
    const b = s.bodies[r];
    if (!living(b)) continue;
    s.ctx.emit({
      type: 'spellfx',
      sourceId: dead.id,
      targetId: b.id,
      school: 'physical',
      fx: 'beam',
      ability: COUNCIL_CUES.inherit,
    });
  }
  const survivor = COUNCIL_ROLES.map((r) => s.bodies[r]).find(living);
  if (survivor) raidWarn(s, survivor, `fell_${role}`, FALLEN_LINES[role]);
  // The Wrath's heir starts its own (shorter) fill from empty.
  if (role === 'guardian') s.st.energy = 0;
  // Mythic: its soul takes the most intact pillar (council_soul.ts).
  const soul = survivor && s.rules.soulInTheStone ? takeSoul(s, role, dead) !== null : false;
  if (survivor) sayFallen(s, role, soul);
}

// ---- the bars -----------------------------------------------------------------------------

function landBar(s: CouncilScope, role: CouncilRole, body: Entity): void {
  const bar = s.st.bars[role];
  if (!bar) return;
  delete s.st.bars[role];
  s.st.gaps[role] = T.barGap;
  if (s.st.kickable === bar.castId) s.st.kickable = null;
  switch (bar.castId) {
    case COUNCIL_CASTS.wrath:
      landWrath(s, body, bar.heir);
      return;
    case COUNCIL_CASTS.weight:
      landWeight(s, body, bar.targetId);
      return;
    case COUNCIL_CASTS.wake:
      landWake(s, body);
      return;
    case COUNCIL_CASTS.rock:
      landRockBar(s, body);
      return;
    case COUNCIL_CASTS.bolt:
      landBolt(s, body, bar.targetId);
      return;
    case COUNCIL_CASTS.song:
    case COUNCIL_CASTS.songUnbroken:
      landSong(s, body, bar.heir);
      return;
  }
}

/** Every running bar: planted, counting down, landing; a cut kickable bar is
 *  a kick. */
function stepBars(s: CouncilScope): void {
  for (const role of COUNCIL_ROLES) {
    const b = s.bodies[role];
    const bar = s.st.bars[role];
    s.st.gaps[role] = Math.max(0, s.st.gaps[role] - DT);
    if (!bar || !living(b)) continue;
    if (b.castingAbility !== bar.castId) {
      // Cut: between two passes only a player interrupt clears a council bar.
      delete s.st.bars[role];
      s.st.gaps[role] = T.barGap;
      // A kick, unless the bar went with an evade (the leash clears it).
      if (s.st.kickable === bar.castId) {
        s.st.kickable = null;
        if (b.aiState !== 'evade') songKicked(s, b, bar.castId);
      }
      continue;
    }
    holdPlantedAt(s.ctx, b, bar.at);
    b.swingTimer = Math.max(b.swingTimer, 0.6);
    if (bar.targetId !== null) {
      const t = s.ctx.entities.get(bar.targetId);
      if (t && !t.dead) b.facing = Math.atan2(t.pos.x - b.pos.x, t.pos.z - b.pos.z);
    }
    b.castRemaining = Math.max(0, b.castRemaining - DT);
    if (b.castRemaining > 1e-9) continue;
    b.castingAbility = null;
    b.castRemaining = 0;
    b.castTotal = 0;
    b.castTargetId = null;
    landBar(s, role, b);
  }
}

/** Begin whatever each member has due, the most dangerous first. */
function startBars(s: CouncilScope): void {
  const st = s.st;
  st.weightTimer -= DT;
  st.wakeTimer -= DT;
  st.rockTimer -= DT;
  st.boltTimer -= DT;
  st.songTimer -= DT;
  if (st.songDue !== null) st.songDue -= DT;
  // An owed song that could not start soon after its Wrath is dropped (sung
  // late it would run into the next one).
  if (st.songDue !== null && st.songDue < -T.songLateDrop) st.songDue = null;
  st.quiet = Math.max(0, st.quiet - DT);
  // The Wrath first (its holder waits for nothing but its own bar to end).
  startWrath(s);
  // The song next: on normal it is owed only just after a Wrath.
  startSong(s);
  if (st.wakeTimer <= 0) startWake(s);
  if (st.rockTimer <= 0) startRock(s);
  if (st.weightTimer <= 0) startWeight(s);
  if (st.boltTimer <= 0) startBolt(s);
}

// ---- keeping the three together ---------------------------------------------------------

/** A living member out of the fight while a sibling fights (its foe fell, or
 *  the pack pull missed it) joins it again on the sibling's foe and hate. */
function keepTogether(s: CouncilScope): void {
  const lead = COUNCIL_ROLES.map((r) => s.bodies[r]).find(
    (b): b is Entity => b !== null && fighting(b) && b.aggroTargetId !== null,
  );
  if (!lead || lead.aggroTargetId === null) return;
  const foe = s.ctx.entities.get(lead.aggroTargetId);
  if (!foe || foe.dead) return;
  for (const r of COUNCIL_ROLES) {
    const b = s.bodies[r];
    // A member walking home keeps its leash; once home and idle it rejoins.
    if (!living(b) || b === lead || fighting(b) || b.aiState === 'evade') continue;
    b.aiState = 'chase';
    b.aggroTargetId = foe.id;
    b.inCombat = true;
    b.leashAnchor ??= { ...b.pos };
    for (const [id, amount] of lead.threat) if (!b.threat.has(id)) addThreat(b, id, amount * 0.5);
    addThreat(b, foe.id, 1);
  }
}

// ---- the start, the reset, the end ------------------------------------------------------

function attach(bodies: CouncilBodies, st: CouncilFightState | undefined): void {
  for (const r of COUNCIL_ROLES) {
    const b = bodies[r];
    if (b) b.smithHeartFight = st;
  }
}

function clearBars(bodies: CouncilBodies): void {
  for (const r of COUNCIL_ROLES) {
    const b = bodies[r];
    if (!b) continue;
    clearWrathBars(b);
    clearStoneBars(b);
    clearSongBars(b);
  }
}

/** Lift Hammer's Weight off this claim's players (never another claim's). */
function dropClaimWeight(ctx: SimContext, inst: InstanceSlot): void {
  const o = ctx.instanceOriginOf(inst);
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (!p || Math.abs(p.pos.x - o.x) >= 300 || Math.abs(p.pos.z - o.z) >= 250) continue;
    dropAuraById(p, COUNCIL_AURAS.weight);
  }
}

/** The fight ended without the kill: everything stands as it was. */
function resetCouncil(ctx: SimContext, inst: InstanceSlot, bodies: CouncilBodies): void {
  const st = councilState(bodies);
  if (st) {
    const s = scopeOf(ctx, inst, st, bodies);
    clearStone(s);
    clearSong(s);
    clearRubble(ctx, inst, st);
    // The tank keeps no Weight past the fight.
    dropClaimWeight(ctx, inst);
  }
  clearBars(bodies);
  const anyAlive = COUNCIL_ROLES.some((r) => living(bodies[r]));
  for (const r of COUNCIL_ROLES) {
    const b = bodies[r];
    if (!b) continue;
    dropAuraById(b, COUNCIL_AURAS.memory);
    if (b.dead && anyAlive) regrowHead(ctx, b, 1);
    b.resource = 0;
  }
  attach(bodies, undefined);
  restorePillars(ctx, inst);
}

/** All three are down: the end is resolved once; the risen stone sinks. */
function finishCouncil(
  ctx: SimContext,
  inst: InstanceSlot,
  bodies: CouncilBodies,
  st: CouncilFightState,
): void {
  st.finished = true;
  const s = scopeOf(ctx, inst, st, bodies);
  // The last to fall says its last line.
  const last = COUNCIL_ROLES.find((r) => !st.fallen.includes(r));
  if (last) councilSay(s, last, 'defeat');
  // Every soul pillar crumbles with the council.
  crumbleSouls(s);
  clearStone(s);
  clearSong(s);
  clearRubble(ctx, inst, st);
  clearBars(bodies);
  dropClaimWeight(ctx, inst);
  settlePillars(ctx, inst);
  for (const r of COUNCIL_ROLES) {
    const b = bodies[r];
    if (b) b.resource = 0;
  }
}

/** The fight starts: one state for all three, the energy empty. */
function beginCouncil(
  ctx: SimContext,
  inst: InstanceSlot,
  bodies: CouncilBodies,
): CouncilFightState {
  const st = freshState(councilDifficulty(inst));
  // A member already down when the pull began (a dev kill) has fallen.
  for (const r of COUNCIL_ROLES) if (bodies[r] && !living(bodies[r])) st.fallen.push(r);
  attach(bodies, st);
  return st;
}

/** One tick of the claim's Hammer Council. */
export function tickHammerCouncil(ctx: SimContext, inst: InstanceSlot): void {
  const bodies = councilBodies(ctx, inst);
  if (!bodies) return;
  ensurePillarWalls(ctx, inst);
  const st0 = councilState(bodies);
  const alive = COUNCIL_ROLES.filter((r) => living(bodies[r]));
  if (alive.length === 0) {
    if (st0 && !st0.finished) finishCouncil(ctx, inst, bodies, st0);
    return;
  }
  const engaged = alive.some((r) => fighting(bodies[r]));
  if (!engaged) {
    if (st0) {
      // The raid lies dead on the floor: a survivor says so.
      if (!st0.finished && quarryPlayers(ctx, inst).length === 0) {
        const speaker = alive[0];
        if (speaker) councilSay(scopeOf(ctx, inst, st0, bodies), speaker, 'wipe');
      }
      resetCouncil(ctx, inst, bodies);
    }
    return;
  }
  const st = st0 ?? beginCouncil(ctx, inst, bodies);
  const s = scopeOf(ctx, inst, st, bodies);
  st.clock += DT;
  keepTogether(s);
  // The fallen, in the order they fell this pull.
  for (const r of COUNCIL_ROLES) {
    const b = bodies[r];
    if (b && !living(b) && !st.fallen.includes(r)) noteFallen(s, r, b);
  }
  syncMemory(s);
  stepCouncilVoice(s);
  stepBars(s);
  fillEnergy(s);
  syncEnergyBars(s);
  stepRises(s);
  stepRock(s);
  stepResonance(s);
  stepSouls(s);
  const source = COUNCIL_ROLES.map((r) => bodies[r]).find(living);
  if (source) {
    stepRubble(ctx, inst, st, source, s.players, damageMult(s, source));
    if (s.rules.pillarPulse) {
      st.pulseTimer -= DT;
      if (st.pulseTimer <= 1e-9) {
        st.pulseTimer += T.pulseEvery;
        pulsePillars(ctx, inst, source, s.players, damageMult(s, source));
      }
    }
  }
  startBars(s);
}

// ---- dev ------------------------------------------------------------------------------------

/** The council's fight scope for a dev command or a test (starting the fight
 *  state if none runs yet), or null when the claim holds no council. */
export function councilScopeForDev(ctx: SimContext, inst: InstanceSlot): CouncilScope | null {
  const bodies = councilBodies(ctx, inst);
  if (!bodies) return null;
  const st = councilState(bodies) ?? beginCouncil(ctx, inst, bodies);
  return scopeOf(ctx, inst, st, bodies);
}

/** `/dev heart council <what>`: the reply line, or null for an unknown verb. */
export function councilDevTrigger(
  ctx: SimContext,
  inst: InstanceSlot,
  what: string,
): string | null {
  const [verb, arg] = what.trim().split(/\s+/);
  if (verb === 'reset') {
    const bodies = councilBodies(ctx, inst);
    if (!bodies) return 'This run holds no council.';
    resetCouncil(ctx, inst, bodies);
    // Out of the fight and home, whole: the next pull is a fresh one.
    for (const r of COUNCIL_ROLES) {
      const b = bodies[r];
      if (!b) continue;
      if (b.dead) regrowHead(ctx, b, 1);
      b.hp = b.maxHp;
      b.aiState = 'idle';
      b.inCombat = false;
      b.aggroTargetId = null;
      clearThreat(b);
      b.pos = { ...b.spawnPos, y: ctx.groundPos(b.spawnPos.x, b.spawnPos.z).y };
      b.prevPos = { ...b.pos };
      ctx.rebucket(b);
    }
    return 'The Hammer Council stands whole again, the five columns with it.';
  }
  if (verb === 'heroic' || verb === 'mythic') {
    const on = arg !== 'off';
    setCouncilDevTier(inst, verb, on);
    const bodies = councilBodies(ctx, inst);
    const live = bodies ? councilState(bodies) : null;
    if (bodies && live && !live.finished) {
      // A fight in progress takes the new tier whole (council_soul.ts):
      // off mythic every soul leaves its pillar, onto it every fallen
      // member's soul takes one, as if it had fallen on mythic.
      live.difficulty = councilDifficulty(inst);
      syncSoulsToTier(scopeOf(ctx, inst, live, bodies));
    } else if (live) live.difficulty = councilDifficulty(inst);
    return on
      ? `The council fights on ${verb} for this run.`
      : `The council fights on ${councilDifficulty(inst)}.`;
  }
  const s = councilScopeForDev(ctx, inst);
  if (!s) return 'This run holds no council.';
  const cut = (role: CouncilRole) => {
    const b = s.bodies[role];
    if (!b || !s.st.bars[role]) return;
    clearBars({ ...s.bodies, [role]: b } as CouncilBodies);
    delete s.st.bars[role];
    s.st.gaps[role] = 0;
  };
  if (verb === 'energy') {
    const n = Number(arg);
    if (!Number.isFinite(n)) return 'Name an amount: /dev heart council energy 95.';
    s.st.energy = Math.max(0, Math.min(T.energyMax, n));
    syncEnergyBars(s);
    return `Energy set to ${Math.round(s.st.energy)}.`;
  }
  if (verb === 'wrath') {
    s.st.energy = T.energyMax;
    for (const r of COUNCIL_ROLES) {
      cut(r);
      s.st.gaps[r] = 0;
    }
    return startWrath(s) ? "Mountain's Wrath." : 'No council member can cast it.';
  }
  if (verb === 'weight') {
    cut('guardian');
    return startWeight(s) ? "Hammer's Weight." : 'The Guardian has no tank, or has fallen.';
  }
  if (verb === 'wake') {
    for (const r of COUNCIL_ROLES) cut(r);
    return startWake(s) ? 'Wake the Stone.' : 'No pillar can rise (the cap, or nobody holds it).';
  }
  if (verb === 'rock') {
    cut('slabwright');
    s.st.rock = null;
    return startRock(s) ? 'Falling Rock.' : 'The Slabwright has fallen or is busy.';
  }
  if (verb === 'bolt') {
    cut('singer');
    s.st.quiet = 0;
    return startBolt(s) ? 'Seam Bolt.' : "Nobody in the Singer's sight.";
  }
  if (verb === 'song') {
    for (const r of COUNCIL_ROLES) cut(r);
    s.st.quiet = 0;
    return startSong(s, true) ? 'Song of the Seam.' : 'Nobody can sing it.';
  }
  const soulReply = soulDevTrigger(s, verb, arg);
  if (soulReply !== null) return soulReply;
  if (verb === 'resonance') {
    const holder = COUNCIL_ROLES.map((r) => s.bodies[r]).find(living);
    if (!holder) return 'The council has fallen.';
    const n = applyResonance(s, holder, Number(arg) > 0 ? Number(arg) : T.songMarks).length;
    return `Resonance on ${n}.`;
  }
  return null;
}

/** The council's readout for `/dev heart council` (state at a glance). */
export function councilReadout(ctx: SimContext, inst: InstanceSlot): string {
  const bodies = councilBodies(ctx, inst);
  if (!bodies) return '[dev] This run holds no council.';
  const st = councilState(bodies);
  const part = (r: CouncilRole) => {
    const b = bodies[r];
    if (!b) return `${r} missing`;
    return `${r} ${b.dead ? 'dead' : `${Math.round((b.hp / b.maxHp) * 100)}%`}`;
  };
  const head = `[dev] Council (${councilDifficulty(inst)}): ${COUNCIL_ROLES.map(part).join(', ')}`;
  if (!st) return `${head}; not fighting.`;
  const souls = st.souls.length > 0 ? `, souls ${soulReadout({ ctx, inst, st })}` : '';
  return `${head}; energy ${Math.round(st.energy)}, wraths ${st.wraths}, fallen ${st.fallen.join(' > ') || 'none'}${souls}.`;
}
