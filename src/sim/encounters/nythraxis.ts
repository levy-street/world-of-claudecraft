// Nythraxis raid encounter (N1), extracted from the Sim monolith.
//
// This module owns the Nythraxis multi-phase raid script: the per-tick encounter
// driver, the dialogue/yell scheduler, the Gravebreaker / Raise Fallen / Soul Rend
// / Deathless Rage mechanics, the Aldric transition + wardstone channels, the
// skeleton-warrior add AI, the CC-immunity predicates, the raid lockout grant, and
// the crypt relic / grave-vision quest chain. It is the LAST slice: every AI /
// damage / aura / threat / locomotion callback it leans on already exists on
// SimContext, so it consumes a fully-grown seam.
//
// PRIME DIRECTIVE: this is a MOVE, not a rewrite. Every function below is the former
// `Sim` method verbatim, with `this.X` rewritten to `ctx.X` (the SimContext seam) or
// to a sibling function in this module. Statement order, branch order, the
// guard/early-return ladder, and EVERY rng draw position are preserved exactly so the
// parity gate's full-state trace AND rng draw-order log stay byte-identical. The two
// shared-stream rng draws live in updateNythraxisGravebreaker (ctx.rng.range over the
// boss weapon) and castNythraxisSoulRend (ctx.rng.int picking the marks); both keep
// their global stream position because the per-tick guard ladder in
// updateNythraxisEncounter is moved unchanged. The in-place Entity/PlayerMeta mutation
// (and the delayedEvents closures that capture the LIVE `boss.nythraxis` state via the
// dialogue token) is intentional under the refactor's immutability waiver.
//
// `src/sim`-pure: no DOM/Three/render/ui/game/net imports, no Math.random/Date.now
// (enforced by tests/architecture.test.ts). data/types/entity/threat/cc are imported
// directly (already pure); everything that touches not-yet-owned Sim state routes
// through the seam.

import { isStunned } from '../combat/cc';
import { ITEMS, MOBS, NPCS, QUESTS } from '../data';
import { createMob, createNpc } from '../entity';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { clearThreat, threatEntries } from '../threat';
import {
  type Aura,
  type AuraKind,
  angleTo,
  armorReduction,
  DT,
  dist2d,
  type Entity,
  INTERACT_RANGE,
  NYTHRAXIS_ADD_ID,
  NYTHRAXIS_BOSS_ID,
  normAngle,
  OBJECT_RESPAWN,
  type SimEvent,
  type Vec3,
  YELL_RANGE,
} from '../types';

const NYTHRAXIS_RELIC_SUMMONS: Record<string, string> = {
  captains_crest: 'fallen_captain_aldren',
  priests_sigil: 'corrupted_priest_malric',
  royal_seal: 'deathstalker_voss',
};
const _NYTHRAXIS_CRYPT_QUESTS = new Set(['q_nythraxis_sealed_crypt', 'q_nythraxis_bound_guardian']);
// NYTHRAXIS_BOSS_ID / NYTHRAXIS_ADD_ID live in types.ts (shared with mob/locomotion.ts;
// the dungeon raid-door seal in instances/dungeons.ts also reads NYTHRAXIS_BOSS_ID).
const NYTHRAXIS_ALDRIC_ID = 'brother_aldric_raid';
const _NYTHRAXIS_FINAL_QUEST_ID = 'q_nythraxis_scourges_end';
const NYTHRAXIS_WARDSTONE_ITEM_ID = 'bastion_ward_stone';
// How far a wardstone may sit from the boss spawn and still belong to this
// encounter. The three arena wards form a wide forward triangle (~54yd out), so
// this must comfortably exceed that; far above any cross-instance false match.
const NYTHRAXIS_WARDSTONE_RANGE = 100;
const NYTHRAXIS_GRAVEBREAKER_EVERY = 12;
const NYTHRAXIS_GRAVEBREAKER_RANGE = 11;
const NYTHRAXIS_GRAVEBREAKER_HALF_ARC = Math.PI / 3;
const NYTHRAXIS_OPENER_SECOND_YELL_DELAY = 4;
const NYTHRAXIS_DIALOGUE_LINE_SECONDS = 2.6;
const NYTHRAXIS_RAISE_FALLEN_EVERY = 45;
const NYTHRAXIS_PHASE_TWO_HP = 0.7;
const NYTHRAXIS_SOUL_REND_EVERY = 30;
const NYTHRAXIS_SOUL_REND_DURATION = 8;
const NYTHRAXIS_SOUL_REND_STACK_RANGE = 5;
const NYTHRAXIS_DEATHLESS_EVERY = 45;
const NYTHRAXIS_DEATHLESS_CAST = 10;
const NYTHRAXIS_DEATHLESS_CHANNEL = 5;
const NYTHRAXIS_DEATHLESS_STUN = 5;
const NYTHRAXIS_DEATHLESS_SOUL_REND_LOCKOUT = 15;
const NYTHRAXIS_PHASE_TWO_SETTLE_DELAY = 5;
const NYTHRAXIS_LOCKOUT_MS = 24 * 60 * 60 * 1000;
const NYTHRAXIS_TRANSITION_DURATION = 21;
const NYTHRAXIS_TRANSITION_STUN = 21.5;
const NYTHRAXIS_FINAL_STAND_HP = 0.05;
const NYTHRAXIS_ROOM_RADIUS = 260;
// Brother Aldric enters on the door side of the arena (the raid's side, lower z
// than the boss spawn) and walks toward the boss. Distances are yards in front
// of the boss spawn: appears 50yd out, walks up to 30yd out (between door + boss).
const NYTHRAXIS_ALDRIC_SPAWN_DIST = 50;
const NYTHRAXIS_ALDRIC_WALK_DIST = 30;
const NYTHRAXIS_PARTY_INTERACT_RANGE = 30;
const NYTHRAXIS_VISION_LINE_DELAY = 5;

// ----- CC-immunity predicates (consumed by the hot applyAura path on Sim) ---------

export function isNythraxisControlAura(ctx: SimContext, kind: AuraKind): boolean {
  return kind === 'slow' || ctx.isControlAura(kind);
}

export function isNythraxisRaidEnemy(target: Entity): boolean {
  return (
    target.kind === 'mob' &&
    (target.templateId === NYTHRAXIS_BOSS_ID || target.templateId === NYTHRAXIS_ADD_ID)
  );
}

export function isNythraxisScriptedControl(target: Entity, aura: Aura): boolean {
  return (
    target.kind === 'mob' &&
    (target.templateId === NYTHRAXIS_ADD_ID || target.ownerId !== null) &&
    aura.id === 'nythraxis_transition_stun'
  );
}

// ----- skeleton-warrior add AI (consumed by mob retarget on Sim) ------------------

export function findNythraxisBossForAdd(ctx: SimContext, add: Entity): Entity | null {
  if (add.kind !== 'mob' || add.templateId !== NYTHRAXIS_ADD_ID) return null;
  for (const e of ctx.entities.values()) {
    if (e.kind !== 'mob' || e.templateId !== NYTHRAXIS_BOSS_ID || e.dead) continue;
    if (e.summonedIds.includes(add.id) || dist2d(e.spawnPos, add.spawnPos) < 1) return e;
  }
  return null;
}

export function nythraxisAddFallbackTarget(ctx: SimContext, add: Entity): Entity | null {
  const boss = findNythraxisBossForAdd(ctx, add);
  if (!boss?.inCombat || boss.aiState === 'idle' || boss.aiState === 'evade') return null;
  const target = boss.aggroTargetId !== null ? ctx.entities.get(boss.aggroTargetId) : null;
  return target && !target.dead && target.kind === 'player' ? target : null;
}

export function scheduleNythraxisAddDespawnIfBossReset(ctx: SimContext, add: Entity): boolean {
  const boss = findNythraxisBossForAdd(ctx, add);
  if (!boss || (boss.inCombat && boss.aiState !== 'idle' && boss.aiState !== 'evade')) return false;
  add.aggroTargetId = null;
  add.aiState = 'idle';
  add.inCombat = false;
  add.hostile = false;
  add.despawnTimer = add.despawnTimer ?? 10;
  clearThreat(add);
  return true;
}

// ----- boss-death dialogue hook (fired from updateMob's dead-branch via ctx) -------

export function onBossDeath(ctx: SimContext, mob: Entity): void {
  if (mob.templateId === NYTHRAXIS_BOSS_ID && mob.nythraxis && !mob.nythraxis.deathSpoken) {
    mob.nythraxis.deathSpoken = true;
    mob.nythraxis.phase = 'dead';
    nythraxisDialogueSet(ctx, mob, [
      { speaker: 'nythraxis', text: 'Malric...', delay: 0 },
      {
        speaker: 'nythraxis',
        text: 'What have you done',
        delay: NYTHRAXIS_DIALOGUE_LINE_SECONDS,
      },
    ]);
  }
}

// ----- encounter lifecycle --------------------------------------------------------

export function initNythraxisEncounter(boss: Entity): NonNullable<Entity['nythraxis']> {
  if (!boss.nythraxis) {
    boss.nythraxis = {
      phase: 1,
      introSpoken: false,
      transitionStarted: false,
      transitionTimer: 0,
      transitionCues: [],
      transitionReleased: false,
      dialogueBusyUntil: 0,
      dialogueToken: 0,
      gravebreakerTimer: 1.5,
      gravebreakerCasts: 0,
      raiseFallenTimer: NYTHRAXIS_RAISE_FALLEN_EVERY,
      soulRendTimer: NYTHRAXIS_SOUL_REND_EVERY,
      soulRendMarks: [],
      soulRendLockout: 0,
      deathlessTimer: NYTHRAXIS_DEATHLESS_EVERY,
      deathlessCastRemaining: 0,
      deathlessStunRemaining: 0,
      wardChannels: [],
      finalStand: false,
      deathSpoken: false,
    };
  }
  return boss.nythraxis;
}

export function resetNythraxisEncounter(ctx: SimContext, boss: Entity): void {
  for (const p of playersInNythraxisRoom(ctx, boss)) {
    p.auras = p.auras.filter(
      (a) => a.id !== 'nythraxis_soul_rend' && a.id !== 'nythraxis_transition_stun',
    );
    clearNythraxisWardChannelCast(p);
  }
  for (const e of nythraxisTransitionStunTargets(ctx, boss)) {
    if (e.kind !== 'player') e.auras = e.auras.filter((a) => a.id !== 'nythraxis_transition_stun');
  }
  const aldric = findNythraxisAldric(ctx, boss);
  if (aldric) ctx.dropEntity(aldric.id);
  for (const ward of nythraxisDeathlessChannelObjects(ctx, boss)) {
    ward.auras = ward.auras.filter((a) => a.id !== 'nythraxis_wardstone_lit');
  }
  boss.nythraxis = undefined;
  boss.castingAbility = null;
  boss.castRemaining = 0;
  boss.castTotal = 0;
  boss.channeling = false;
}

// Full wipe: every player in the arena is dead. Send Nythraxis home at full
// health, clear his adds/Aldric/wards/auras, and drop combat so the sealed
// doors reopen and the raid can run back in for another attempt.
export function wipeNythraxisEncounter(ctx: SimContext, boss: Entity): void {
  boss.pos = { ...boss.spawnPos };
  boss.prevPos = { ...boss.spawnPos };
  ctx.rebucket(boss);
  ctx.resetEvadingMob(boss); // restores hp, clears threat/auras/adds + resetNythraxisEncounter
}

export function updateNythraxisEncounter(ctx: SimContext, boss: Entity): void {
  const st = initNythraxisEncounter(boss);
  if (!st.introSpoken) {
    st.introSpoken = true;
    nythraxisDialogueSet(ctx, boss, [
      { speaker: 'nythraxis', text: 'Another kingdom comes to challenge me', delay: 0 },
      {
        speaker: 'nythraxis',
        text: 'You will join the rest',
        delay: NYTHRAXIS_OPENER_SECOND_YELL_DELAY,
      },
    ]);
  }

  // Wipe-or-kill is the only reset: if every player in the arena is dead the
  // encounter resets for a retry; otherwise keep the boss locked onto a live
  // target so kiting him out of melee never sends him home.
  const room = playersInNythraxisRoom(ctx, boss);
  if (room.length === 0) {
    wipeNythraxisEncounter(ctx, boss);
    return;
  }
  const tgt = boss.aggroTargetId !== null ? ctx.entities.get(boss.aggroTargetId) : null;
  if (
    !tgt ||
    tgt.dead ||
    tgt.kind !== 'player' ||
    dist2d(tgt.pos, boss.spawnPos) > NYTHRAXIS_ROOM_RADIUS
  ) {
    const topId = threatEntries(boss, 1)[0]?.[0] ?? null;
    const top = topId !== null ? ctx.entities.get(topId) : null;
    const next = top && !top.dead && top.kind === 'player' ? top : room[0];
    boss.aggroTargetId = next.id;
    boss.inCombat = true;
    if (boss.aiState === 'idle' || boss.aiState === 'evade') boss.aiState = 'chase';
  }
  if (boss.aggroTargetId !== null && (boss.aiState === 'idle' || boss.aiState === 'evade')) {
    boss.inCombat = true;
    boss.aiState = 'chase';
  }

  if (st.soulRendLockout > 0) st.soulRendLockout = Math.max(0, st.soulRendLockout - DT);
  updateNythraxisSoulRend(ctx, boss, st);
  if (st.phase === 'transition') {
    updateNythraxisTransition(ctx, boss, st);
    return;
  }
  if (st.phase === 'dead') return;

  const hpFrac = boss.hp / Math.max(1, boss.maxHp);
  if (st.phase === 1 && hpFrac <= NYTHRAXIS_PHASE_TWO_HP) {
    startNythraxisTransition(ctx, boss, st);
    return;
  }

  if (st.phase === 2 && !st.finalStand && hpFrac <= NYTHRAXIS_FINAL_STAND_HP) {
    st.finalStand = true;
    boss.enraged = true;
    nythraxisDialogueSet(ctx, boss, [
      { speaker: 'nythraxis', text: 'I built a kingdom', delay: 0 },
      {
        speaker: 'nythraxis',
        text: 'I will not lose it again',
        delay: NYTHRAXIS_DIALOGUE_LINE_SECONDS,
      },
    ]);
    ctx.applyAura(boss, {
      id: 'nythraxis_final_stand',
      name: 'Final Stand',
      kind: 'buff_haste',
      remaining: 600,
      duration: 600,
      value: 1.45,
      sourceId: boss.id,
      school: 'shadow',
    });
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: boss.id,
      school: 'shadow',
      fx: 'nova',
    });
  }

  if (st.deathlessStunRemaining > 0) {
    st.deathlessStunRemaining = Math.max(0, st.deathlessStunRemaining - DT);
    return;
  }
  if (st.deathlessCastRemaining > 0) {
    updateNythraxisDeathlessRage(ctx, boss, st);
    return;
  }

  updateNythraxisGravebreaker(ctx, boss, st);
  if (st.phase === 1) updateNythraxisRaiseFallen(ctx, boss, st);
  if (st.phase === 2) {
    st.soulRendTimer -= DT;
    if (st.soulRendTimer <= 0) {
      if (canCastNythraxisSoulRend(st)) castNythraxisSoulRend(ctx, boss, st);
      else st.soulRendTimer = 1;
    }
    st.deathlessTimer -= DT;
    if (st.deathlessTimer <= 0) {
      if (st.soulRendMarks.length === 0 && st.soulRendLockout <= 0)
        startNythraxisDeathlessRage(ctx, boss, st);
      else st.deathlessTimer = 1;
    }
  }
}

// ----- dialogue / yell scheduling -------------------------------------------------

export function reserveNythraxisDialogue(
  ctx: SimContext,
  boss: Entity,
  duration: number,
  critical = false,
  queue = false,
): { st: NonNullable<Entity['nythraxis']>; token: number } | null {
  const st = initNythraxisEncounter(boss);
  const busyUntil = st.dialogueBusyUntil ?? 0;
  if (!critical && busyUntil > ctx.time && !queue) return null;
  const delay = !critical && queue && busyUntil > ctx.time ? busyUntil - ctx.time : 0;
  const token = (st.dialogueToken ?? 0) + 1;
  st.dialogueToken = token;
  st.dialogueBusyUntil = ctx.time + delay + duration;
  return { st, token };
}

export function nythraxisDialogueSet(
  ctx: SimContext,
  boss: Entity,
  lines: { speaker: 'nythraxis' | 'aldric'; text: string; delay: number }[],
  critical = false,
  queue = false,
): boolean {
  if (lines.length === 0) return true;
  const duration = Math.max(...lines.map((line) => line.delay)) + NYTHRAXIS_DIALOGUE_LINE_SECONDS;
  const busyUntil = boss.nythraxis?.dialogueBusyUntil ?? 0;
  const startDelay = !critical && queue && busyUntil > ctx.time ? busyUntil - ctx.time : 0;
  const reservation = reserveNythraxisDialogue(ctx, boss, duration, critical, queue);
  if (!reservation) return false;
  const { st, token } = reservation;
  for (const line of lines) {
    const delay = startDelay + line.delay;
    if (delay <= 0) {
      emitNythraxisYell(ctx, boss, line.speaker, line.text);
      continue;
    }
    ctx.delayedEvents.push({
      at: ctx.time + delay,
      event: nythraxisYellEvent(ctx, boss, line.speaker, line.text),
      guard: () => critical || st.dialogueToken === token,
    });
  }
  return true;
}

export function nythraxisSay(
  ctx: SimContext,
  boss: Entity,
  speaker: 'nythraxis' | 'aldric',
  text: string,
  critical = false,
): boolean {
  const reservation = reserveNythraxisDialogue(
    ctx,
    boss,
    NYTHRAXIS_DIALOGUE_LINE_SECONDS,
    critical,
  );
  if (!reservation) return false;
  emitNythraxisYell(ctx, boss, speaker, text);
  return true;
}

export function nythraxisYellEvent(
  ctx: SimContext,
  boss: Entity,
  speaker: 'nythraxis' | 'aldric',
  text: string,
): SimEvent {
  const actor = speaker === 'aldric' ? findNythraxisAldric(ctx, boss) : boss;
  const from = actor?.name ?? (speaker === 'aldric' ? 'Brother Aldric' : boss.name);
  const fromPid = actor?.id ?? boss.id;
  return { type: 'chat', fromPid, from, text, channel: 'yell', entityId: actor?.id ?? boss.id };
}

export function emitNythraxisYell(
  ctx: SimContext,
  boss: Entity,
  speaker: 'nythraxis' | 'aldric',
  text: string,
): void {
  const event = nythraxisYellEvent(ctx, boss, speaker, text);
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (!p || dist2d(p.pos, boss.pos) > YELL_RANGE) continue;
    ctx.emit({ ...event, pid: meta.entityId });
  }
}

// ----- room / participant queries -------------------------------------------------

export function findNythraxisAldric(ctx: SimContext, boss: Entity): Entity | null {
  for (const e of ctx.entities.values()) {
    if (
      e.templateId === NYTHRAXIS_ALDRIC_ID &&
      !e.dead &&
      dist2d(e.spawnPos, boss.spawnPos) < NYTHRAXIS_ROOM_RADIUS
    )
      return e;
  }
  return null;
}

export function playersInNythraxisRoom(ctx: SimContext, boss: Entity): Entity[] {
  const out: Entity[] = [];
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (p && !p.dead && dist2d(p.pos, boss.spawnPos) <= NYTHRAXIS_ROOM_RADIUS) out.push(p);
  }
  out.sort((a, b) => a.id - b.id);
  return out;
}

export function nythraxisTransitionStunTargets(ctx: SimContext, boss: Entity): Entity[] {
  return [...ctx.entities.values()].filter(
    (e) =>
      !e.dead &&
      dist2d(e.pos, boss.spawnPos) <= NYTHRAXIS_ROOM_RADIUS &&
      (e.kind === 'player' ||
        (e.kind === 'mob' && (e.templateId === NYTHRAXIS_ADD_ID || e.ownerId !== null))),
  );
}

export function nythraxisRoomMetas(ctx: SimContext, boss: Entity): PlayerMeta[] {
  const out: PlayerMeta[] = [];
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (p && dist2d(p.pos, boss.spawnPos) <= NYTHRAXIS_ROOM_RADIUS) out.push(meta);
  }
  out.sort((a, b) => a.entityId - b.entityId);
  return out;
}

export function grantNythraxisLockout(ctx: SimContext, boss: Entity): void {
  const until = ctx.lockoutNowMs() + NYTHRAXIS_LOCKOUT_MS;
  for (const meta of nythraxisRoomMetas(ctx, boss)) {
    meta.raidLockouts.set('nythraxis_boss_arena', until);
  }
}

// ----- phase-one mechanics --------------------------------------------------------

export function updateNythraxisGravebreaker(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
): void {
  st.gravebreakerTimer -= DT;
  if (st.gravebreakerTimer > 0) return;
  st.gravebreakerTimer = NYTHRAXIS_GRAVEBREAKER_EVERY;
  st.gravebreakerCasts = (st.gravebreakerCasts ?? 0) + 1;
  if (st.gravebreakerCasts % 3 === 0)
    nythraxisSay(ctx, boss, 'nythraxis', 'Kneel before your king');
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'physical',
    fx: 'nova',
  });
  let rawDmg =
    ctx.rng.range(boss.weapon.min, boss.weapon.max) +
    (ctx.effectiveAttackPower(boss) / 14) * boss.weapon.speed;
  const enrage = MOBS[boss.templateId]?.enrage;
  if (boss.enraged && enrage) rawDmg *= enrage.dmgMult;
  for (const p of playersInNythraxisRoom(ctx, boss)) {
    const d = dist2d(p.pos, boss.pos);
    if (d > NYTHRAXIS_GRAVEBREAKER_RANGE) continue;
    const delta = Math.abs(normAngle(angleTo(boss.pos, p.pos) - boss.facing));
    if (delta > NYTHRAXIS_GRAVEBREAKER_HALF_ARC) continue;
    const mult = p.id === boss.aggroTargetId ? 1 : 1.5;
    const mitigated = rawDmg * mult * (1 - armorReduction(ctx.effectiveArmor(p), boss.level));
    const dmg = Math.max(1, Math.round(mitigated));
    ctx.dealDamage(boss, p, dmg, false, 'physical', 'Gravebreaker', 'hit', true);
  }
}

export function updateNythraxisRaiseFallen(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
): void {
  st.raiseFallenTimer -= DT;
  if (st.raiseFallenTimer > 0) return;
  st.raiseFallenTimer = NYTHRAXIS_RAISE_FALLEN_EVERY;
  nythraxisDialogueSet(ctx, boss, [
    { speaker: 'nythraxis', text: 'Rise once more', delay: 0 },
    {
      speaker: 'nythraxis',
      text: 'Your king commands it',
      delay: NYTHRAXIS_DIALOGUE_LINE_SECONDS,
    },
  ]);
  spawnNythraxisAdds(ctx, boss);
}

export function spawnNythraxisAdds(ctx: SimContext, boss: Entity): void {
  const template = MOBS[NYTHRAXIS_ADD_ID];
  if (!template) return;
  // Raise the guards from BEHIND the boss (toward the back wall), so they rise
  // up behind him and march out around him, not between the boss and the raid.
  const back = boss.spawnPos.z + 16;
  const spawnPoints = [
    ctx.groundPos(boss.spawnPos.x - 12, back),
    ctx.groundPos(boss.spawnPos.x + 12, back),
  ];
  const inst = ctx.instances.find((i) => i.partyKey !== null && i.mobIds.includes(boss.id));
  const victimId = boss.aggroTargetId ?? threatEntries(boss, 1)[0]?.[0] ?? null;
  const victim = victimId !== null ? ctx.entities.get(victimId) : null;
  for (const pos of spawnPoints) {
    const add = createMob(ctx.nextId++, template, template.maxLevel, pos);
    add.spawnPos = { ...boss.spawnPos };
    add.tappedById = boss.tappedById;
    ctx.addEntity(add);
    boss.summonedIds.push(add.id);
    inst?.mobIds.push(add.id);
    if (victim && !victim.dead && victim.kind === 'player') ctx.aggroMob(add, victim, false);
  }
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'shadow',
    fx: 'nova',
  });
}

// ----- transition (phase 1 -> 2) --------------------------------------------------

export function startNythraxisTransition(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
): void {
  st.phase = 'transition';
  st.transitionStarted = true;
  const queuedDialogueDelay = Math.max(0, (st.dialogueBusyUntil ?? 0) - ctx.time);
  st.transitionTimer = NYTHRAXIS_TRANSITION_DURATION + queuedDialogueDelay;
  st.transitionReleased = false;
  st.soulRendMarks = [];
  st.deathlessCastRemaining = 0;
  boss.castingAbility = null;
  boss.castRemaining = 0;
  boss.castTotal = 0;
  const transitionLines = [
    { speaker: 'nythraxis' as const, text: 'Another priest...', delay: 0 },
    { speaker: 'aldric' as const, text: 'Your kingdom is gone, Nythraxis', delay: 3.0 },
    { speaker: 'aldric' as const, text: 'Yet you still cling to it', delay: 5.7 },
    { speaker: 'aldric' as const, text: 'Champions, listen carefully!', delay: 8.4 },
    { speaker: 'aldric' as const, text: 'The wardstones still bind his soul.', delay: 11.2 },
    { speaker: 'aldric' as const, text: 'When the time comes, do not ignore them.', delay: 14.1 },
    { speaker: 'aldric' as const, text: 'Fail and we all perish', delay: 17.1 },
  ];
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'physical',
    fx: 'nova',
  });
  for (const e of nythraxisTransitionStunTargets(ctx, boss)) {
    ctx.applyAura(e, {
      id: 'nythraxis_transition_stun',
      name: 'War Stomp',
      kind: 'stun',
      remaining: NYTHRAXIS_TRANSITION_STUN,
      duration: NYTHRAXIS_TRANSITION_STUN,
      value: 0,
      sourceId: boss.id,
      school: 'physical',
    });
  }
  ctx.applyAura(boss, {
    id: 'nythraxis_transition_pause',
    name: 'War Stomp',
    kind: 'stun',
    remaining: NYTHRAXIS_TRANSITION_STUN,
    duration: NYTHRAXIS_TRANSITION_STUN,
    value: 0,
    sourceId: boss.id,
    school: 'physical',
  });
  spawnNythraxisAldric(ctx, boss);
  lightNythraxisWardstones(ctx, boss);
  nythraxisDialogueSet(ctx, boss, transitionLines, false, true);
  st.transitionCues = [];
}

export function spawnNythraxisAldric(ctx: SimContext, boss: Entity): void {
  if (findNythraxisAldric(ctx, boss)) return;
  // Brother Aldric is a friendly quest NPC, not a mob: modeling him as an NPC
  // lets the online client mirror his questIds and open the turn-in dialog
  // (createMob produced a friendly mob the client could never interact with).
  const def = NPCS[NYTHRAXIS_ALDRIC_ID];
  if (!def) return;
  const aldric = createNpc(
    ctx.nextId++,
    def,
    ctx.groundPos(boss.spawnPos.x, boss.spawnPos.z - NYTHRAXIS_ALDRIC_SPAWN_DIST),
  );
  aldric.level = boss.level; // createNpc defaults to 10; match the boss's level for the nameplate
  aldric.hostile = false;
  aldric.facing = 0;
  aldric.prevFacing = 0;
  aldric.spawnPos = { ...aldric.pos };
  ctx.addEntity(aldric);
  const inst = ctx.instances.find((i) => i.partyKey !== null && i.mobIds.includes(boss.id));
  inst?.mobIds.push(aldric.id);
}

export function updateNythraxisTransition(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
): void {
  const aldric = findNythraxisAldric(ctx, boss);
  if (aldric) {
    const dest = ctx.groundPos(boss.spawnPos.x, boss.spawnPos.z - NYTHRAXIS_ALDRIC_WALK_DIST);
    ctx.moveToward(aldric, dest, aldric.moveSpeed);
  }
  st.transitionTimer -= DT;
  if (st.transitionTimer > 0) return;
  st.phase = 2;
  st.transitionReleased = true;
  st.gravebreakerTimer = 3;
  st.soulRendTimer = NYTHRAXIS_PHASE_TWO_SETTLE_DELAY;
  st.deathlessTimer = NYTHRAXIS_PHASE_TWO_SETTLE_DELAY + 15;
  boss.auras = boss.auras.filter((a) => a.id !== 'nythraxis_transition_pause');
  for (const e of nythraxisTransitionStunTargets(ctx, boss)) {
    e.auras = e.auras.filter((a) => a.id !== 'nythraxis_transition_stun');
  }
}

export function lightNythraxisWardstones(ctx: SimContext, boss: Entity): void {
  for (const ward of nythraxisDeathlessChannelObjects(ctx, boss)) {
    ctx.applyAura(ward, {
      id: 'nythraxis_wardstone_lit',
      name: 'Soul Ward',
      kind: 'absorb',
      remaining: 600,
      duration: 600,
      value: 1,
      sourceId: boss.id,
      school: 'arcane',
    });
    ctx.emit({
      type: 'spellfx',
      sourceId: ward.id,
      targetId: boss.id,
      school: 'arcane',
      fx: 'projectile',
    });
  }
}

// ----- phase-two mechanics: Soul Rend ---------------------------------------------

export function canCastNythraxisSoulRend(st: NonNullable<Entity['nythraxis']>): boolean {
  return st.deathlessCastRemaining <= 0 && st.deathlessStunRemaining <= 0;
}

export function castNythraxisSoulRend(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
): void {
  const candidates = playersInNythraxisRoom(ctx, boss).filter((p) => p.id !== boss.aggroTargetId);
  if (candidates.length === 0) {
    st.soulRendTimer = 3;
    return;
  }
  const picked: Entity[] = [];
  while (picked.length < 3 && candidates.length > 0) {
    const idx = ctx.rng.int(0, candidates.length - 1);
    picked.push(candidates.splice(idx, 1)[0]);
  }
  st.soulRendMarks = picked.map((p) => ({
    playerId: p.id,
    remaining: NYTHRAXIS_SOUL_REND_DURATION,
  }));
  st.soulRendTimer = NYTHRAXIS_SOUL_REND_EVERY;
  nythraxisSay(ctx, boss, 'nythraxis', 'Your spirit belongs to me', true);
  for (const p of picked) {
    ctx.applyAura(p, {
      id: 'nythraxis_soul_rend',
      name: 'Soul Rend',
      kind: 'vulnerability',
      remaining: NYTHRAXIS_SOUL_REND_DURATION,
      duration: NYTHRAXIS_SOUL_REND_DURATION,
      value: 0,
      sourceId: boss.id,
      school: 'shadow',
    });
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: p.id,
      school: 'shadow',
      fx: 'projectile',
    });
  }
}

export function updateNythraxisSoulRend(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
): void {
  if (st.soulRendMarks.length === 0) return;
  for (const mark of st.soulRendMarks) mark.remaining -= DT;
  if (st.soulRendMarks.some((m) => m.remaining > 0)) return;
  const marked = st.soulRendMarks
    .map((m) => ctx.entities.get(m.playerId))
    .filter((e): e is Entity => !!e && e.kind === 'player' && !e.dead);
  for (const p of marked) {
    const stacked = marked.filter(
      (other) => dist2d(other.pos, p.pos) <= NYTHRAXIS_SOUL_REND_STACK_RANGE,
    ).length;
    const share = Math.max(1, stacked);
    ctx.dealDamage(boss, p, Math.ceil(p.maxHp / share), false, 'shadow', 'Soul Rend', 'hit', true);
    p.auras = p.auras.filter((a) => a.id !== 'nythraxis_soul_rend');
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: p.id,
      school: 'shadow',
      fx: 'nova',
    });
  }
  st.soulRendMarks = [];
}

// ----- phase-two mechanics: Deathless Rage + wardstone channels --------------------

export function startNythraxisDeathlessRage(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
): void {
  st.deathlessTimer = NYTHRAXIS_DEATHLESS_EVERY;
  st.deathlessCastRemaining = NYTHRAXIS_DEATHLESS_CAST;
  st.soulRendLockout = NYTHRAXIS_DEATHLESS_SOUL_REND_LOCKOUT;
  st.wardChannels = nythraxisDeathlessChannelObjects(ctx, boss).map((ward) => ({
    objectId: ward.id,
    playerId: null,
    remaining: NYTHRAXIS_DEATHLESS_CHANNEL,
    complete: false,
  }));
  boss.castingAbility = 'nythraxis_deathless_rage';
  boss.castTotal = NYTHRAXIS_DEATHLESS_CAST;
  boss.castRemaining = NYTHRAXIS_DEATHLESS_CAST;
  boss.channeling = false;
  nythraxisSay(ctx, boss, 'nythraxis', 'Witness true eternity!', true);
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'shadow',
    fx: 'nova',
  });
}

export function updateNythraxisDeathlessRage(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
): void {
  st.deathlessCastRemaining = Math.max(0, st.deathlessCastRemaining - DT);
  boss.castingAbility = 'nythraxis_deathless_rage';
  boss.castTotal = NYTHRAXIS_DEATHLESS_CAST;
  boss.castRemaining = st.deathlessCastRemaining;
  updateNythraxisWardChannels(ctx, boss, st);
  if (nythraxisWardstoneInterruptReady(st)) {
    st.deathlessCastRemaining = 0;
    boss.castingAbility = null;
    boss.castRemaining = 0;
    boss.castTotal = 0;
    st.deathlessStunRemaining = NYTHRAXIS_DEATHLESS_STUN;
    ctx.applyAura(boss, {
      id: 'nythraxis_deathless_stun',
      name: 'Deathless Rage Interrupted',
      kind: 'stun',
      remaining: NYTHRAXIS_DEATHLESS_STUN,
      duration: NYTHRAXIS_DEATHLESS_STUN,
      value: 0,
      sourceId: boss.id,
      school: 'arcane',
    });
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: boss.id,
      school: 'arcane',
      fx: 'nova',
    });
    return;
  }
  if (st.deathlessCastRemaining > 0) return;
  boss.castingAbility = null;
  boss.castRemaining = 0;
  boss.castTotal = 0;
  nythraxisSay(ctx, boss, 'nythraxis', 'You cannot stop what was promised..', true);
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'shadow',
    fx: 'nova',
  });
  for (const p of playersInNythraxisRoom(ctx, boss)) {
    ctx.dealDamage(
      boss,
      p,
      Math.ceil(p.maxHp * 0.82),
      false,
      'shadow',
      'Deathless Rage',
      'hit',
      true,
    );
  }
}

export function nythraxisWardstoneInterruptReady(st: NonNullable<Entity['nythraxis']>): boolean {
  if (
    st.wardChannels.length === 0 ||
    !st.wardChannels.every((c) => c.complete && c.playerId !== null)
  )
    return false;
  return new Set(st.wardChannels.map((c) => c.playerId)).size === st.wardChannels.length;
}

export function updateNythraxisWardChannels(
  ctx: SimContext,
  boss: Entity,
  st: NonNullable<Entity['nythraxis']>,
): void {
  for (const channel of st.wardChannels) {
    if (channel.complete || channel.playerId === null) continue;
    const ward = ctx.entities.get(channel.objectId);
    const p = ctx.entities.get(channel.playerId);
    if (!ward || !p || p.dead || isStunned(p) || dist2d(p.pos, ward.pos) > INTERACT_RANGE + 1) {
      if (p) clearNythraxisWardChannelCast(p);
      channel.playerId = null;
      channel.remaining = NYTHRAXIS_DEATHLESS_CHANNEL;
      continue;
    }
    channel.remaining = Math.max(0, channel.remaining - DT);
    p.castingAbility = 'nythraxis_ward_channel';
    p.channeling = true;
    p.castTotal = NYTHRAXIS_DEATHLESS_CHANNEL;
    p.castRemaining = channel.remaining;
    ctx.emit({
      type: 'spellfx',
      sourceId: ward.id,
      targetId: boss.id,
      school: 'shadow',
      fx: 'beam',
    });
    if (channel.remaining <= 0) {
      channel.complete = true;
      clearNythraxisWardChannelCast(p);
      ctx.emit({
        type: 'spellfx',
        sourceId: ward.id,
        targetId: boss.id,
        school: 'arcane',
        fx: 'nova',
      });
    }
  }
}

export function clearNythraxisWardChannelCast(p: Entity): void {
  if (p.castingAbility !== 'nythraxis_ward_channel') return;
  p.castingAbility = null;
  p.channeling = false;
  p.castRemaining = 0;
  p.castTotal = 0;
}

export function nythraxisWardstones(ctx: SimContext, boss: Entity): Entity[] {
  const wards = [...ctx.entities.values()].filter(
    (e) =>
      e.kind === 'object' &&
      e.objectItemId === NYTHRAXIS_WARDSTONE_ITEM_ID &&
      dist2d(e.pos, boss.spawnPos) < NYTHRAXIS_WARDSTONE_RANGE,
  );
  wards.sort((a, b) => a.id - b.id);
  return wards;
}

export function nythraxisDeathlessChannelObjects(ctx: SimContext, boss: Entity): Entity[] {
  return nythraxisWardstones(ctx, boss);
}

export function tryStartNythraxisWardChannel(
  ctx: SimContext,
  ward: Entity,
  player: Entity,
): boolean {
  if (ward.objectItemId !== NYTHRAXIS_WARDSTONE_ITEM_ID) return false;
  const boss = [...ctx.entities.values()].find(
    (e) =>
      e.kind === 'mob' &&
      e.templateId === NYTHRAXIS_BOSS_ID &&
      !e.dead &&
      dist2d(e.spawnPos, ward.pos) < NYTHRAXIS_WARDSTONE_RANGE,
  );
  // No Nythraxis boss in range: this is not a raid wardstone but the overworld
  // "Sunken Bastion" quest ward stone (same item id). Fall through so the normal
  // quest pickup runs, instead of swallowing the interaction.
  if (!boss) return false;
  if (!boss.nythraxis || boss.nythraxis.deathlessCastRemaining <= 0) return true;
  const channel = boss.nythraxis.wardChannels.find((c) => c.objectId === ward.id);
  if (!channel || channel.complete) return true;
  if (channel.playerId === player.id) return true;
  if (channel.playerId !== null && channel.playerId !== player.id) return true;
  channel.playerId = player.id;
  channel.remaining = NYTHRAXIS_DEATHLESS_CHANNEL;
  player.castingAbility = 'nythraxis_ward_channel';
  player.channeling = true;
  player.castTotal = NYTHRAXIS_DEATHLESS_CHANNEL;
  player.castRemaining = NYTHRAXIS_DEATHLESS_CHANNEL;
  ctx.emit({
    type: 'spellfx',
    sourceId: ward.id,
    targetId: boss.id,
    school: 'shadow',
    fx: 'beam',
  });
  return true;
}

// ----- crypt relic / grave-vision quest chain -------------------------------------

export function activateNythraxisRelic(ctx: SimContext, obj: Entity, meta: PlayerMeta): boolean {
  if (!obj.objectItemId) return false;
  const mobId = NYTHRAXIS_RELIC_SUMMONS[obj.objectItemId];
  if (!mobId) return false;
  const qp = meta.questLog.get('q_nythraxis_sealed_crypt');
  if (qp?.state !== 'active') {
    const def = ITEMS[obj.objectItemId];
    ctx.error(meta.entityId, def?.pickupDeny ?? 'The relic is bound by the sealed crypt.');
    return true;
  }
  const quest = QUESTS.q_nythraxis_sealed_crypt;
  const objectiveIndex = quest.objectives.findIndex(
    (o) => o.type === 'collect' && o.itemId === obj.objectItemId,
  );
  if (
    objectiveIndex >= 0 &&
    ctx.countItem(obj.objectItemId, meta.entityId) >= quest.objectives[objectiveIndex].count
  ) {
    const def = ITEMS[obj.objectItemId];
    ctx.error(meta.entityId, def?.pickupEnough ?? 'You have already recovered this relic.');
    return true;
  }
  summonQuestMob(ctx, mobId, obj.pos, meta.entityId);
  obj.lootable = false;
  obj.respawnTimer = OBJECT_RESPAWN;
  return true;
}

export function interactObjectForQuests(ctx: SimContext, obj: Entity, meta: PlayerMeta): boolean {
  if (!obj.objectItemId) return false;
  let handled = false;
  for (const qp of meta.questLog.values()) {
    if (qp.state !== 'active') continue;
    const quest = QUESTS[qp.questId];
    quest.objectives.forEach((objective, objectiveIndex) => {
      if (objective.type !== 'interact' || objective.targetObjectItemId !== obj.objectItemId)
        return;
      handled = true;
      const isRitual = obj.objectItemId === 'crypt_ritual_circle';
      if (isRitual && !ctx.countItem('crypt_keystone', meta.entityId)) {
        ctx.error(meta.entityId, 'The ritual circle is silent without the Crypt Keystone.');
        return;
      }
      // Re-summon the Bound Guardian whenever the player still owes the kill.
      // The interact objective is one-shot, but a guardian lost to the idle
      // despawn (leash, wipe) must stay reachable or the kill/collect/signet
      // dead-ends with no way to retry. summonQuestMob no-ops if one is alive.
      if (isRitual) {
        const killIdx = quest.objectives.findIndex(
          (o) => o.type === 'kill' && o.targetMobId === 'bound_guardian',
        );
        if (killIdx >= 0 && qp.counts[killIdx] < quest.objectives[killIdx].count) {
          summonQuestMob(ctx, 'bound_guardian', obj.pos, meta.entityId);
        }
      }
      // The interact objective itself (and its one-time vision) only credits once.
      if (qp.counts[objectiveIndex] >= objective.count) return;
      const shared = sharedNythraxisObjectParticipants(ctx, meta, obj, qp.questId, objectiveIndex);
      for (const member of shared) {
        const memberQp = member.questLog.get(qp.questId);
        if (memberQp?.state !== 'active') continue;
        if (memberQp.counts[objectiveIndex] >= objective.count) continue;
        memberQp.counts[objectiveIndex]++;
        member.counters.questProgress++;
        ctx.emit({
          type: 'questProgress',
          questId: memberQp.questId,
          text: `${objective.label}: ${memberQp.counts[objectiveIndex]}/${objective.count}`,
          pid: member.entityId,
        });
        ctx.checkQuestReady(memberQp, member);
      }
      const visionId = summonQuestVision(ctx, obj.objectItemId, obj.pos);
      emitQuestObjectVision(
        ctx,
        obj.objectItemId,
        shared.map((m) => m.entityId),
        visionId,
      );
    });
  }
  return handled;
}

export function sharedNythraxisObjectParticipants(
  ctx: SimContext,
  actor: PlayerMeta,
  obj: Entity,
  questId: string,
  objectiveIndex: number,
): PlayerMeta[] {
  if (
    obj.objectItemId !== 'grave_sir_aldren' &&
    obj.objectItemId !== 'grave_high_priest_malric' &&
    obj.objectItemId !== 'grave_captain_voss' &&
    obj.objectItemId !== 'crypt_ritual_circle'
  ) {
    return [actor];
  }
  const quest = QUESTS[questId];
  const objective = quest.objectives[objectiveIndex];
  const party = ctx.partyOf(actor.entityId);
  const members = party ? party.members : [actor.entityId];
  const eligible: PlayerMeta[] = [];
  for (const pid of members) {
    const member = ctx.players.get(pid);
    const entity = ctx.entities.get(pid);
    const memberQp = member?.questLog.get(questId);
    if (!member || !entity || entity.dead || !memberQp || memberQp.state !== 'active') continue;
    if (memberQp.counts[objectiveIndex] >= objective.count) continue;
    if (dist2d(entity.pos, obj.pos) > NYTHRAXIS_PARTY_INTERACT_RANGE) continue;
    eligible.push(member);
  }
  return eligible.some((member) => member.entityId === actor.entityId) ? eligible : [actor];
}

export function emitQuestObjectVision(
  ctx: SimContext,
  itemId: string,
  pids: number[],
  entityId?: number | null,
): void {
  const lines =
    itemId === 'grave_sir_aldren'
      ? ['My king was a good man.', 'I swore my blade to him.', 'I would do so again.']
      : itemId === 'grave_high_priest_malric'
        ? ['There had to be another way.', 'I could not let him die.', 'I only wanted to save him.']
        : itemId === 'grave_captain_voss'
          ? [
              'The king was already dead.',
              'Malric refused to accept it.',
              'We should have let him rest.',
              'If you find the crypt... end this.',
            ]
          : itemId === 'crypt_ritual_circle'
            ? ['The Crypt Keystone turns cold as the seal breaks.']
            : null;
  if (!lines) return;
  for (let i = 0; i < lines.length; i++) {
    for (const pid of pids) {
      const event: SimEvent = {
        type: 'log',
        text: lines[i],
        color: '#b8d7ff',
        pid,
        entityId: entityId ?? undefined,
      };
      if (i === 0) ctx.emit(event);
      else ctx.delayedEvents.push({ at: ctx.time + i * NYTHRAXIS_VISION_LINE_DELAY, event });
    }
  }
}

export function summonQuestVision(ctx: SimContext, itemId: string, pos: Vec3): number | null {
  const templateId =
    itemId === 'grave_sir_aldren'
      ? 'vision_aldren_warrior'
      : itemId === 'grave_high_priest_malric'
        ? 'vision_malric_mage'
        : itemId === 'grave_captain_voss'
          ? 'vision_deathstalker_voss'
          : null;
  if (!templateId) return null;
  const existing = [...ctx.entities.values()].find(
    (e) => e.kind === 'mob' && e.templateId === templateId && !e.dead && dist2d(e.pos, pos) < 10,
  );
  if (existing) return existing.id;
  const template = MOBS[templateId];
  if (!template) return null;
  const mob = createMob(
    ctx.nextId++,
    template,
    template.maxLevel,
    ctx.groundPos(pos.x + 2.4, pos.z + 2.4),
  );
  mob.hostile = false;
  mob.aiState = 'idle';
  mob.lootable = false;
  mob.loot = null;
  mob.despawnTimer = 22;
  mob.facing = Math.PI;
  mob.prevFacing = mob.facing;
  mob.swingTimer = Infinity;
  ctx.addEntity(mob);
  return mob.id;
}

export function summonQuestMob(
  ctx: SimContext,
  templateId: string,
  pos: Vec3,
  ownerPid: number,
): void {
  const existing = [...ctx.entities.values()].some(
    (e) => e.kind === 'mob' && e.templateId === templateId && !e.dead && dist2d(e.pos, pos) < 18,
  );
  if (existing) return;
  const template = MOBS[templateId];
  if (!template) return;
  const mob = createMob(ctx.nextId++, template, template.maxLevel, ctx.groundPos(pos.x, pos.z + 3));
  mob.facing = Math.PI;
  mob.prevFacing = mob.facing;
  mob.tappedById = ownerPid;
  ctx.addEntity(mob);
  const owner = ctx.entities.get(ownerPid);
  if (owner && owner.kind === 'player' && !owner.dead) ctx.aggroMob(mob, owner, false);
  const inst = ctx.instances.find((i) => {
    if (i.partyKey === null) return false;
    const origin = ctx.instanceOriginOf(i);
    return Math.abs(mob.pos.x - origin.x) < 120 && Math.abs(mob.pos.z - origin.z) < 250;
  });
  if (inst) inst.mobIds.push(mob.id);
  ctx.emit({ type: 'log', text: `${template.name} awakens!`, color: '#ff6666' });
  emitQuestMobDialogue(ctx, templateId, mob.id);
}

export function emitQuestMobDialogue(ctx: SimContext, templateId: string, entityId: number): void {
  const text =
    templateId === 'fallen_captain_aldren'
      ? 'Fallen Captain Aldren yells, "None shall disturb the king\'s rest! For Thornpeak!"'
      : templateId === 'corrupted_priest_malric'
        ? 'Corrupted Priest Malric yells, "Death shall never claim my king! The ritual must endure!"'
        : templateId === 'deathstalker_voss'
          ? 'Deathstalker Voss yells, "You will not reach him! The king must endure!"'
          : null;
  if (text) ctx.emit({ type: 'log', text, color: '#ff9999', entityId });
}
