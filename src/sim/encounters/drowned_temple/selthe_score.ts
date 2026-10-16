// Choirmother Selthe's Score (selthe.ts calls in; the numbers and their math:
// ids.ts SELTHE_TUNING, "the Score"). Her one moment, at 60 and 30 percent:
//
//   The melody   she stops (her other clocks stand still and she takes no
//                damage), turns to the moon tiles set round the front of her
//                pool and sings: the tiles ring ONE AFTER ANOTHER, three the
//                first time, four the second.
//   The answer   the verse stays open for 14 s (16 s the second time). The
//                group steps on those tiles in that same order. A step counts
//                when a player ENTERS a tile. Correct notes alternate players
//                while more than one is alive; already sounded tiles are inert.
//   False Note   a tile stepped out of turn stings whoever stepped it and
//                sends the answer back to its first tile; the clock runs on.
//   Broken Voice the last tile sounded in time: her voice breaks. Stunned 4 s
//                and taking 20 percent more damage for 10 s.
//   Discord      the verse ran out first: heavy frost to the whole court, and
//                no window.
//   Heroic       the melody is shown once and each tile goes dark as soon as
//                it has rung, so the group must remember it.
//
// The state rides existing entity fields, so the online client draws exactly
// what the sim tests with no wire change: the five tile objects (a tile's
// template id is its state and its place in the melody, ids.ts
// moonTileTemplate), her two bars (the melody, and the answer whose time left
// is the verse's clock) and her ward aura. Zero rng in the pick: the melody
// is hashed per cast from a fixed table (ids.ts scoreMelodies). The only rng
// draw is Discord's damage roll, in player order.

import { kitHash } from '../../mob/trash_kit/targets';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import {
  angleTo,
  DT,
  type Entity,
  type SeltheFightState,
  type SeltheScoreState,
} from '../../types';
import {
  claimPlayers,
  clearCastOf,
  dropEncounterObject,
  mechanicDamage,
  spawnTempleObject,
  startCast,
} from './claim';
import {
  COURT,
  type MoonTileState,
  moonTileSpots,
  moonTileTemplate,
  onMoonTile,
  SELTHE_BROKEN_VOICE,
  SELTHE_BROKEN_VOICE_EXPOSED,
  SELTHE_DISCORD,
  SELTHE_FALSE_NOTE,
  SELTHE_SCORE,
  SELTHE_SCORE_ANSWER,
  SELTHE_SCORE_WARD,
  SELTHE_TILE_NOTE,
  SELTHE_TILE_SOUNDED,
  SELTHE_TUNING,
  SELTHE_VOICE_BREAKS,
  scoreAnswerSeconds,
  scoreMelody,
  scoreMelodySeconds,
  scoreNoteEvery,
  scoreNoteRing,
  scoreNotesOf,
} from './ids';
import {
  clearScoreRelay,
  recordScoreSinger,
  refreshScoreRelay,
  scoreSingerBlocked,
} from './selthe_score_relay';

const T = SELTHE_TUNING;
/** After a Score her next mark and her next bar wait at least this long. */
const BREATH_AFTER = 2;

/** The moon tiles rise round her pool as the fight begins: five dormant tile
 *  objects, in tile order, on the arc in front of her. */
export function raiseMoonTiles(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: SeltheFightState,
): void {
  if (st.tiles.length > 0) return;
  const o = ctx.instanceOriginOf(inst);
  const cx = boss.pos.x - o.x;
  const cz = boss.pos.z - o.z;
  for (const spot of moonTileSpots(cx, cz)) {
    const obj = spawnTempleObject(
      ctx,
      inst,
      moonTileTemplate('dark'),
      'Moon Tile',
      spot.x,
      spot.z,
      T.scoreTileRadius,
    );
    // Its facing is its bearing from her (the renderer orients its marks).
    obj.facing = Math.atan2(spot.x - cx, spot.z - cz);
    obj.prevFacing = obj.facing;
    st.tiles.push({ x: spot.x, z: spot.z, objectId: obj.id });
  }
}

/** What tile `tile` shows right now. */
function tileLook(sc: SeltheScoreState | null, tile: number): [MoonTileState, number] {
  if (!sc) return ['dark', 0];
  const place = sc.order.indexOf(tile) + 1;
  if (sc.phase === 'melody') {
    if (place === 0 || place > sc.rung) return ['dark', 0];
    // The last note rung is still ringing for scoreNoteRing of its slot.
    const ringing =
      place === sc.rung &&
      scoreNoteEvery(sc.order.length) - sc.noteIn < scoreNoteRing(sc.order.length) - 1e-6;
    if (ringing) return ['note', place];
    return sc.hidden ? ['dark', 0] : ['lit', place];
  }
  if (sc.sour.some((s) => s.tile === tile)) return ['sour', 0];
  if (place === 0) return ['dark', 0];
  if (place <= sc.progress) return ['done', place];
  if (sc.hidden) return ['dark', 0];
  return place === sc.progress + 1 ? ['next', place] : ['lit', place];
}

/** Write every tile's state onto its object (a template swap only on a change). */
function paintTiles(ctx: SimContext, st: SeltheFightState): void {
  for (let i = 0; i < st.tiles.length; i++) {
    const obj = ctx.entities.get(st.tiles[i].objectId);
    if (!obj) continue;
    const [state, place] = tileLook(st.score, i);
    const want = moonTileTemplate(state, place);
    if (obj.templateId !== want) obj.templateId = want;
  }
}

function cue(ctx: SimContext, boss: Entity, targetId: number, ability: string): void {
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId,
    school: 'frost',
    fx: 'nova',
    ability,
  });
}

/** Her health crossed a Score's mark: the next one is owed. */
export function queueScore(boss: Entity, st: SeltheFightState): void {
  if (st.scoreQueued || st.score || st.scores >= T.scoreAt.length) return;
  const share = boss.maxHp > 0 ? boss.hp / boss.maxHp : 1;
  if (share <= T.scoreAt[st.scores]) st.scoreQueued = true;
}

/** An owed Score begins once her bar has ended, her marks and echoes have finished and the
 *  last Score's window has closed (the window is the group's reward: she
 *  never wards herself inside it). */
function scoreReady(boss: Entity, st: SeltheFightState): boolean {
  return (
    boss.castingAbility === null &&
    st.marks.length === 0 &&
    st.echoes.length === 0 &&
    !boss.auras.some((a) => a.id === SELTHE_BROKEN_VOICE_EXPOSED)
  );
}

/** Turn her to a tile (the one that rings, or the middle of the arc). */
function faceTile(ctx: SimContext, boss: Entity, st: SeltheFightState, tile: number): void {
  const obj = ctx.entities.get(st.tiles[tile]?.objectId ?? -1);
  if (!obj) return;
  boss.facing = angleTo(boss.pos, obj.pos);
  boss.prevFacing = boss.facing;
}

/** She begins Score number `index` (0 the first): the ward, the melody's bar
 *  and the hashed melody. Returns false when the tiles are not standing. */
export function startScore(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: SeltheFightState,
  index = st.scores,
): boolean {
  if (st.score || st.tiles.length === 0) return false;
  const notes = scoreNotesOf(index);
  // Hashed per cast (the boss and how many Scores she has sung), never rolled.
  const order = scoreMelody(notes, kitHash(boss.id, 4100 + index * 31));
  if (order.length === 0) return false;
  const hidden = inst.difficulty === 'heroic';
  const melody = scoreMelodySeconds(notes);
  const whole = melody + scoreAnswerSeconds(index) + 0.5;
  st.scoreQueued = false;
  st.scores = Math.max(st.scores, index + 1);
  st.score = {
    phase: 'melody',
    index,
    order,
    hidden,
    timer: melody,
    rung: 0,
    noteIn: T.scoreIntro,
    progress: 0,
    lastSingerId: null,
    inside: st.tiles.map(() => []),
    sour: [],
  };
  boss.damageImmune = true;
  ctx.applyAura(boss, {
    id: SELTHE_SCORE_WARD,
    name: 'The Score',
    kind: 'buff_dr',
    remaining: whole,
    duration: whole,
    value: 0,
    // What the client's alert reads: the notes, and whether the tiles go dark.
    value2: hidden ? 1 : 0,
    stacks: notes,
    sourceId: boss.id,
    school: 'frost',
    undispellable: true,
  });
  startCast(boss, SELTHE_SCORE, melody, null);
  faceTile(ctx, boss, st, Math.floor(st.tiles.length / 2));
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'frost',
    fx: 'windup',
    ability: SELTHE_SCORE,
  });
  paintTiles(ctx, st);
  return true;
}

/** The Score is over: the ward falls, the tiles go dormant, her clocks take a
 *  breath before they run again. */
function closeScore(ctx: SimContext, boss: Entity, st: SeltheFightState): void {
  clearScoreRelay(ctx, boss.id);
  st.score = null;
  clearCastOf(boss, SELTHE_SCORE);
  clearCastOf(boss, SELTHE_SCORE_ANSWER);
  boss.damageImmune = false;
  boss.auras = boss.auras.filter((a) => a.id !== SELTHE_SCORE_WARD);
  st.chorusTimer = Math.max(st.chorusTimer, BREATH_AFTER);
  st.soloTimer = Math.max(st.soloTimer, BREATH_AFTER);
  st.surgeTimer = Math.max(st.surgeTimer, BREATH_AFTER);
  st.ariaTimer = Math.max(st.ariaTimer, BREATH_AFTER);
  st.boltTimer = T.boltEvery;
  st.boltCued = false;
  paintTiles(ctx, st);
}

/** The last tile was sounded in time: her voice breaks. */
export function breakVoice(ctx: SimContext, boss: Entity, st: SeltheFightState): void {
  if (!st.score) return;
  closeScore(ctx, boss, st);
  // Her own reel (sourceId herself): a boss's control immunity lets it in.
  ctx.applyAura(boss, {
    id: SELTHE_BROKEN_VOICE,
    name: 'Broken Voice',
    kind: 'stun',
    remaining: T.brokenStun,
    duration: T.brokenStun,
    value: 0,
    sourceId: boss.id,
    school: 'frost',
    unbreakableControl: true,
  });
  ctx.applyAura(boss, {
    id: SELTHE_BROKEN_VOICE_EXPOSED,
    name: 'Broken Voice',
    kind: 'vulnerability',
    remaining: T.brokenVulnSeconds,
    duration: T.brokenVulnSeconds,
    value: T.brokenVuln,
    sourceId: boss.id,
    school: 'frost',
  });
  cue(ctx, boss, boss.id, SELTHE_VOICE_BREAKS);
}

/** The verse ran out: Discord rolls over the whole court. No window. */
export function failScore(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: SeltheFightState,
): void {
  if (!st.score) return;
  closeScore(ctx, boss, st);
  cue(ctx, boss, boss.id, SELTHE_DISCORD);
  const o = ctx.instanceOriginOf(inst);
  for (const p of claimPlayers(ctx, inst)) {
    if (p.dead || Math.hypot(p.pos.x - o.x - COURT.x, p.pos.z - o.z - COURT.z) > COURT.r + 12)
      continue;
    ctx.dealDamage(
      boss,
      p,
      mechanicDamage(ctx, boss, T.discordMin, T.discordMax),
      false,
      'frost',
      'Discord',
      'hit',
      true,
    );
  }
}

/** The melody is sung: the verse opens for the answer. Whoever already stands
 *  on a tile has not stepped it (a step is the way IN). */
function openAnswer(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: SeltheFightState,
  sc: SeltheScoreState,
): void {
  const seconds = scoreAnswerSeconds(sc.index);
  sc.phase = 'answer';
  sc.timer = seconds;
  sc.progress = 0;
  const o = ctx.instanceOriginOf(inst);
  const players = claimPlayers(ctx, inst);
  sc.inside = st.tiles.map((spot) =>
    players
      .filter((p) => !p.dead && onMoonTile(spot, p.pos.x - o.x, p.pos.z - o.z, false))
      .map((p) => p.id),
  );
  startCast(boss, SELTHE_SCORE_ANSWER, seconds, null, true);
  faceTile(ctx, boss, st, Math.floor(st.tiles.length / 2));
}

/** One tick of the melody: the next tile rings in its turn. */
function stepMelody(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: SeltheFightState,
  sc: SeltheScoreState,
): void {
  sc.timer -= DT;
  sc.noteIn -= DT;
  boss.castRemaining = Math.max(0, sc.timer);
  if (sc.rung < sc.order.length && sc.noteIn <= 1e-6) {
    const tile = sc.order[sc.rung];
    sc.rung++;
    sc.noteIn += scoreNoteEvery(sc.order.length);
    // She sings to the tile that rings.
    faceTile(ctx, boss, st, tile);
    cue(ctx, boss, st.tiles[tile].objectId, SELTHE_TILE_NOTE);
  }
  if (sc.timer <= 1e-6) openAnswer(ctx, inst, boss, st, sc);
}

/** One tick of the answer: who stepped onto which tile, in what turn. */
function stepAnswer(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: SeltheFightState,
  sc: SeltheScoreState,
): void {
  sc.timer -= DT;
  boss.castRemaining = Math.max(0, sc.timer);
  for (let i = sc.sour.length - 1; i >= 0; i--) {
    sc.sour[i].remaining -= DT;
    if (sc.sour[i].remaining <= 1e-6) sc.sour.splice(i, 1);
  }
  // Who came onto a tile this tick (tile order, then entity-id order).
  const o = ctx.instanceOriginOf(inst);
  const players = claimPlayers(ctx, inst);
  const steps: { tile: number; player: Entity }[] = [];
  refreshScoreRelay(ctx, boss, sc, players);
  for (let i = 0; i < st.tiles.length; i++) {
    const was = sc.inside[i];
    const now: number[] = [];
    for (const p of players) {
      if (p.dead) continue;
      const on = was.includes(p.id);
      if (!onMoonTile(st.tiles[i], p.pos.x - o.x, p.pos.z - o.z, on)) continue;
      now.push(p.id);
      // A blocked entry is consumed without a penalty or a queued future note.
      if (!on && !scoreSingerBlocked(sc, players, p.id)) steps.push({ tile: i, player: p });
    }
    sc.inside[i] = now;
  }
  // The group shares the job, so two steps in one tick are read in the
  // kindest order: every step that is in turn is sounded first.
  let found = true;
  while (found) {
    found = false;
    for (let i = 0; i < steps.length; i++) {
      if (steps[i].tile !== sc.order[sc.progress]) continue;
      if (scoreSingerBlocked(sc, players, steps[i].player.id)) continue;
      sc.progress++;
      recordScoreSinger(ctx, boss, sc, players, steps[i].player.id);
      cue(ctx, boss, st.tiles[steps[i].tile].objectId, SELTHE_TILE_SOUNDED);
      steps.splice(i, 1);
      found = true;
      break;
    }
  }
  // Judge every leftover step against the same completed prefix. A wrong
  // tile cancels the tick's answer, even when the last correct tile arrived
  // too; duplicate correct steps stay harmless regardless of tile order.
  let falseNote = false;
  for (const step of steps) {
    if (scoreSingerBlocked(sc, players, step.player.id)) continue;
    // A tile already sounded is inert: only a tile still to come is false.
    const place = sc.order.indexOf(step.tile) + 1;
    if (place > 0 && place <= sc.progress) continue;
    falseNote = true;
    const at = sc.sour.find((s) => s.tile === step.tile);
    if (at) at.remaining = T.scoreSourSeconds;
    else sc.sour.push({ tile: step.tile, remaining: T.scoreSourSeconds });
    cue(ctx, boss, st.tiles[step.tile].objectId, SELTHE_FALSE_NOTE);
    const amount = Math.max(1, Math.round(T.falseNoteDamage * (boss.mechanicDamageMult ?? 1)));
    ctx.dealDamage(boss, step.player, amount, false, 'frost', 'False Note', 'hit', true);
  }
  if (falseNote) sc.progress = 0;
  else if (sc.progress >= sc.order.length) {
    breakVoice(ctx, boss, st);
    return;
  }
  if (sc.timer <= 1e-6) failScore(ctx, inst, boss, st);
}

/**
 * The Score's pass, before her marks' and bars' clocks. Returns true while it
 * owns her: a Score in flight, or the stun of her broken voice (her clocks
 * stand still through both).
 */
export function stepScore(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: SeltheFightState,
): boolean {
  queueScore(boss, st);
  const sc = st.score;
  if (sc) {
    if (sc.phase === 'melody') stepMelody(ctx, inst, boss, st, sc);
    else stepAnswer(ctx, inst, boss, st, sc);
    paintTiles(ctx, st);
    return true;
  }
  if (boss.auras.some((a) => a.id === SELTHE_BROKEN_VOICE)) return true;
  if (st.scoreQueued && scoreReady(boss, st)) return startScore(ctx, inst, boss, st);
  return false;
}

const SCORE_AURAS: ReadonlySet<string> = new Set([
  SELTHE_SCORE_WARD,
  SELTHE_BROKEN_VOICE,
  SELTHE_BROKEN_VOICE_EXPOSED,
]);

function dropScoreAuras(boss: Entity): void {
  if (boss.auras.some((a) => SCORE_AURAS.has(a.id)))
    boss.auras = boss.auras.filter((a) => !SCORE_AURAS.has(a.id));
}

/** A dev trigger's clean slate: a running Score and the last one's window
 *  end quietly (no Discord, no stun); the tiles stay standing. */
export function resetScoreRun(ctx: SimContext, boss: Entity, st: SeltheFightState): void {
  clearScoreRelay(ctx, boss.id);
  if (st.score) closeScore(ctx, boss, st);
  st.scoreQueued = false;
  dropScoreAuras(boss);
}

/** The fight ended: the Score falls silent and the tiles sink away. */
export function resetScore(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: SeltheFightState | null,
): void {
  clearScoreRelay(ctx, boss.id);
  if (st) {
    for (const tile of st.tiles) dropEncounterObject(ctx, inst, tile.objectId);
    st.tiles = [];
    st.score = null;
    st.scoreQueued = false;
  }
  clearCastOf(boss, SELTHE_SCORE);
  clearCastOf(boss, SELTHE_SCORE_ANSWER);
  boss.damageImmune = false;
  dropScoreAuras(boss);
}
