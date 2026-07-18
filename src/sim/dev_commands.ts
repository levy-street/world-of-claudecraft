import { GATHERING_PROFESSIONS } from './content/professions';
import { DUNGEONS, ITEMS, MOBS } from './data';
import { createMob } from './entity';
import { enterDungeon } from './instances/dungeons';
import { isGatheringProfessionId, queueGatheringGrant } from './professions/gathering';
import { completeAllQuestsForDev } from './quests/dev_quest_commands';
import type { SentChat } from './sim';
import type { SimContext } from './sim_context';
import { revivePlayerAt } from './spirit';
import { MAX_LEVEL } from './types';

const MAX_DEV_SPAWNS = 20;
const DEV_SPAWN_RADIUS = 4;
const DEV_SPAWN_RING_SIZE = 8;

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export function spawnMobsForDev(
  ctx: SimContext,
  pid: number,
  templateId: string,
  requestedCount = 1,
  requestedLevel?: number,
): number[] {
  const player = ctx.entities.get(pid);
  const template = MOBS[templateId];
  if (!player || !template) return [];

  const count = clampInteger(requestedCount, 1, MAX_DEV_SPAWNS);
  const defaultLevel = clampInteger(player.level, template.minLevel, template.maxLevel);
  const level = clampInteger(requestedLevel ?? defaultLevel, 1, MAX_LEVEL);
  const ids: number[] = [];
  for (let i = 0; i < count; i++) {
    const ring = Math.floor(i / DEV_SPAWN_RING_SIZE);
    const slot = i % DEV_SPAWN_RING_SIZE;
    const slotsInRing = Math.min(DEV_SPAWN_RING_SIZE, count - ring * DEV_SPAWN_RING_SIZE);
    const angle = player.facing + (slot - (slotsInRing - 1) / 2) * (Math.PI / 6);
    const radius = DEV_SPAWN_RADIUS + ring * 2;
    const pos = ctx.groundPos(
      player.pos.x + Math.sin(angle) * radius,
      player.pos.z + Math.cos(angle) * radius,
    );
    const mob = createMob(ctx.nextId++, template, level, pos);
    mob.devSpawnOwnerId = pid;
    ctx.addEntity(mob);
    ids.push(mob.id);
  }
  return ids;
}

export function despawnMobsForDev(
  ctx: SimContext,
  pid: number,
  mode: 'target' | 'spawned',
): number {
  const drop = (id: number): void => {
    for (const entity of ctx.entities.values()) {
      if (entity.kind === 'player' && entity.targetId === id) entity.targetId = null;
    }
    ctx.dropEntity(id);
  };
  if (mode === 'target') {
    const player = ctx.entities.get(pid);
    const target = player?.targetId === null ? null : ctx.entities.get(player?.targetId ?? -1);
    if (!target || target.devSpawnOwnerId !== pid) return 0;
    drop(target.id);
    return 1;
  }

  const ids = [...ctx.entities.values()]
    .filter((entity) => entity.devSpawnOwnerId === pid)
    .map((entity) => entity.id)
    .sort((a, b) => a - b);
  for (const id of ids) drop(id);
  return ids.length;
}

export function resetCombatForDev(ctx: SimContext, pid: number): void {
  const player = ctx.entities.get(pid);
  if (!player) return;
  player.inCombat = false;
  player.combatTimer = 99;
  player.autoAttack = false;
  player.queuedOnSwing = null;
  player.queuedCastAbility = null;
  player.queuedCastAim = null;

  for (const entity of ctx.entities.values()) {
    if (entity.kind !== 'mob') continue;
    entity.threat.delete(pid);
    if (entity.aggroTargetId === pid) entity.aggroTargetId = null;
    if (entity.forcedTargetId === pid) {
      entity.forcedTargetId = null;
      entity.forcedTargetTimer = 0;
    }
    if (entity.targetId === pid) entity.targetId = null;
    if (entity.threat.size === 0 && entity.aggroTargetId === null) {
      entity.inCombat = false;
      entity.combatTimer = 99;
      entity.autoAttack = false;
      entity.aiState = 'idle';
      entity.leashAnchor = null;
      entity.castingAbility = null;
      entity.castTargetId = null;
      entity.castRemaining = 0;
      entity.castTotal = 0;
    }
  }
}

function emitDevLog(ctx: SimContext, pid: number, text: string): void {
  ctx.emit({ type: 'log', text, pid });
}

export function handleDevChat(
  ctx: SimContext,
  raw: string,
  pid: number,
): SentChat | null | undefined {
  const levelMatch = /^\/(?:dev\s+level|devlevel)\s+(\d+)\s*$/i.exec(raw);
  if (levelMatch) {
    const level = Number(levelMatch[1]);
    ctx.setPlayerLevel(level, pid);
    emitDevLog(ctx, pid, `[dev] Level set to ${clampInteger(level, 1, MAX_LEVEL)}.`);
    return null;
  }

  const teleportMatch = /^\/(?:dev\s+tp|devtp)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*$/i.exec(
    raw,
  );
  if (teleportMatch) {
    const entity = ctx.entities.get(pid);
    if (entity) {
      const pos = ctx.groundPos(Number(teleportMatch[1]), Number(teleportMatch[2]));
      entity.pos = pos;
      entity.prevPos = { ...pos };
      ctx.rebucket(entity);
      emitDevLog(ctx, pid, `[dev] Teleported to ${pos.x.toFixed(1)}, ${pos.z.toFixed(1)}.`);
    }
    return null;
  }

  const spawnMatch = /^\/(?:dev\s+spawn|devspawn)\s+(\S+)(?:\s+(\d+))?(?:\s+(\d+))?\s*$/i.exec(raw);
  if (spawnMatch) {
    const templateId = spawnMatch[1];
    if (!MOBS[templateId]) {
      ctx.error(pid, `[dev] Unknown mob '${templateId}'.`);
      return null;
    }
    const ids = spawnMobsForDev(
      ctx,
      pid,
      templateId,
      Number(spawnMatch[2] ?? 1),
      spawnMatch[3] === undefined ? undefined : Number(spawnMatch[3]),
    );
    emitDevLog(ctx, pid, `[dev] Spawned ${ids.length} x ${templateId}.`);
    return null;
  }

  const despawnMatch = /^\/(?:dev\s+despawn|devdespawn)\s+(target|spawned)\s*$/i.exec(raw);
  if (despawnMatch) {
    const mode = despawnMatch[1].toLowerCase() as 'target' | 'spawned';
    const removed = despawnMobsForDev(ctx, pid, mode);
    if (removed === 0) ctx.error(pid, '[dev] No matching dev-spawned mobs found.');
    else emitDevLog(ctx, pid, `[dev] Despawned ${removed} mob${removed === 1 ? '' : 's'}.`);
    return null;
  }

  if (/^\/(?:dev\s+killtarget|devkilltarget)\s*$/i.test(raw)) {
    const player = ctx.entities.get(pid);
    const target = player?.targetId === null ? null : ctx.entities.get(player?.targetId ?? -1);
    if (target?.kind !== 'mob' || target.dead) {
      ctx.error(pid, '[dev] Target a living mob first.');
    } else {
      ctx.handleDeath(target, player ?? null);
      emitDevLog(ctx, pid, `[dev] Killed ${target.name}.`);
    }
    return null;
  }

  const giveMatch = /^\/(?:dev\s+give|devgive)\s+(\S+)(?:\s+(\d+))?\s*$/i.exec(raw);
  if (giveMatch) {
    const itemId = giveMatch[1];
    const count = clampInteger(Number(giveMatch[2] ?? 1), 1, 20);
    if (!ITEMS[itemId]) ctx.error(pid, `[dev] Unknown item '${itemId}'.`);
    else ctx.addItem(itemId, count, pid);
    return null;
  }

  const goldMatch = /^\/(?:dev\s+gold|devgold)\s+(\d+)\s*$/i.exec(raw);
  if (goldMatch) {
    const gold = clampInteger(Number(goldMatch[1]), 1, 100000);
    const meta = ctx.players.get(pid);
    if (meta) {
      meta.copper += gold * 10000;
      emitDevLog(ctx, pid, `[dev] Added ${gold}g to your purse.`);
    }
    return null;
  }

  const questMatch = /^\/(?:dev\s+quest|devquest)\s+(\S+)\s*$/i.exec(raw);
  if (questMatch) {
    ctx.completeQuestForDev(questMatch[1], pid);
    return null;
  }
  if (/^\/(?:dev\s+(?:quests|questall)|devquestall)\s*$/i.test(raw)) {
    ctx.completeCurrentQuestsForDev(pid);
    return null;
  }

  const gatherMatch = /^\/(?:dev\s+gather|devgather)\s+(\S+)(?:\s+(\d+))?\s*$/i.exec(raw);
  if (gatherMatch) {
    const professionId = gatherMatch[1].toLowerCase();
    const amount = clampInteger(Number(gatherMatch[2] ?? 1), 1, 100);
    if (!isGatheringProfessionId(professionId)) {
      ctx.error(
        pid,
        `[dev] Unknown gathering profession '${professionId}'. Options: ${Object.keys(GATHERING_PROFESSIONS).join(', ')}.`,
      );
      return null;
    }
    const meta = ctx.players.get(pid);
    if (meta) queueGatheringGrant(meta, professionId, amount);
    return null;
  }

  const botMatch = /^\/(?:dev\s+bot|devbot)\s+(\S+)\s*$/i.exec(raw);
  if (botMatch) {
    const botName = botMatch[1];
    const botPid = ctx.spawnDevBot(botName);
    if (botPid < 0) ctx.error(pid, `[dev] Could not spawn '${botName}'.`);
    else emitDevLog(ctx, pid, `[dev] Spawned ${botName}. Whisper it with /w ${botName} hi.`);
    return null;
  }

  if (/^\/(?:dev\s+vendor|devvendor)\s*$/i.test(raw)) {
    const vendorId = ctx.spawnDevVendor(pid);
    if (vendorId < 0) ctx.error(pid, '[dev] Could not spawn the test vendor.');
    else {
      emitDevLog(ctx, pid, '[dev] Spawned the Test Quartermaster (free epic gear) next to you.');
    }
    return null;
  }

  const lfgMatch = /^\/(?:dev\s+lfg|devlfg)(?:\s+(\S+))?\s*$/i.exec(raw);
  if (lfgMatch) {
    const mode = (lfgMatch[1] ?? 'queue').toLowerCase();
    if (mode !== 'queue' && mode !== 'raid' && mode !== 'board') {
      ctx.error(pid, '[dev] Usage: /dev lfg [queue|raid|board].');
      return null;
    }
    const result = ctx.seedDungeonFinderDev(mode, pid);
    const text =
      result.note === 'needRoles'
        ? '[dev] Pick a Dungeon Finder role first.'
        : result.note === 'noneEligible'
          ? '[dev] No finder activity matches your current level.'
          : `[dev] Spawned ${result.spawned} finder bots (${mode}).`;
    if (result.note === 'ok') emitDevLog(ctx, pid, text);
    else ctx.error(pid, text);
    return null;
  }

  if (/^\/(?:dev\s+attune|devattune)\s*$/i.test(raw)) {
    completeAllQuestsForDev(ctx, pid);
    return null;
  }

  if (/^\/(?:dev\s+cascade|devcascade)\s*$/i.test(raw)) {
    // [dev] Controlled Cascada temporal playtest: a non-offensive training dummy plus
    // raid allies at known distances, with a per-cast metrics readout. Dev realms only.
    ctx.startCascadePlaytest(pid);
    emitDevLog(
      ctx,
      pid,
      '[dev] Cascade scenario ready: training dummy + raid allies (one beyond 15 yd). Target the center, cast Temporal Cascade, then hit the dummy with Arcane spells for the per-cast readout.',
    );
    return null;
  }
  if (/^\/(?:dev\s+sandbox|devsandbox)\s*$/i.test(raw)) {
    // [dev] A generic practice scenario: a non-offensive training dummy plus a raid of
    // regen-frozen friendly bots (10k pool) for testing any ability threat-free.
    const allies = ctx.startDevSandbox(pid);
    emitDevLog(
      ctx,
      pid,
      `[dev] Sandbox ready: a training dummy plus ${allies} raid allies (10k HP, started low, regen frozen). Attack the dummy, then practice heals or AoE on the allies threat-free. Re-run /dev sandbox to reset.`,
    );
    return null;
  }

  const dungeonMatch = /^\/(?:dev\s+dungeon|devdungeon)\s+(\S+)(?:\s+(normal|heroic))?\s*$/i.exec(
    raw,
  );
  if (dungeonMatch) {
    const dungeonId = dungeonMatch[1];
    if (!DUNGEONS[dungeonId]) {
      ctx.error(pid, `[dev] Unknown dungeon '${dungeonId}'.`);
      return null;
    }
    const difficulty = dungeonMatch[2]?.toLowerCase() === 'heroic' ? 'heroic' : 'normal';
    ctx.setDungeonDifficulty(difficulty, pid);
    enterDungeon(ctx, dungeonId, pid, true);
    emitDevLog(ctx, pid, `[dev] Entering ${dungeonId} (${difficulty}).`);
    return null;
  }

  const raidMatch = /^\/(?:dev\s+)(?:tp\s+)?raid\b\s*(.*)$/i.exec(raw);
  if (raidMatch) {
    const rest = raidMatch[1].toLowerCase();
    const meta = ctx.players.get(pid);
    if (/\breset\b/.test(rest)) {
      if (meta) meta.raidLockouts.clear();
      emitDevLog(ctx, pid, '[dev] Raid lockouts cleared.');
      return null;
    }
    const difficulty = /\bnormal\b/.test(rest) ? 'normal' : 'heroic';
    ctx.setDungeonDifficulty(difficulty, pid);
    enterDungeon(ctx, 'nythraxis_boss_arena', pid, true);
    emitDevLog(ctx, pid, `[dev] Entering Nythraxis raid (${difficulty}).`);
    return null;
  }

  if (/^\/(?:dev\s+god|devgod)\s*$/i.test(raw)) {
    const entity = ctx.entities.get(pid);
    if (entity) {
      entity.devGod = !entity.devGod;
      if (entity.devGod) {
        entity.hp = entity.maxHp;
        entity.resource = entity.maxResource;
      }
      emitDevLog(ctx, pid, `[dev] God mode ${entity.devGod ? 'ON' : 'OFF'}.`);
    }
    return null;
  }

  if (/^\/(?:dev\s+heal|devheal)\s*$/i.test(raw)) {
    const entity = ctx.entities.get(pid);
    if (entity && !entity.dead) entity.hp = entity.maxHp;
    emitDevLog(ctx, pid, '[dev] Health restored.');
    return null;
  }
  if (/^\/(?:dev\s+resource|devresource)\s*$/i.test(raw)) {
    const entity = ctx.entities.get(pid);
    if (entity && !entity.dead) entity.resource = entity.maxResource;
    emitDevLog(ctx, pid, '[dev] Resource restored.');
    return null;
  }
  if (/^\/(?:dev\s+cooldowns|devcooldowns)\s*$/i.test(raw)) {
    const entity = ctx.entities.get(pid);
    if (entity) {
      entity.cooldowns.clear();
      entity.gcdRemaining = 0;
      entity.potionCooldownUntil = ctx.time;
      entity.potionCdRemaining = 0;
    }
    emitDevLog(ctx, pid, '[dev] Cooldowns cleared.');
    return null;
  }
  if (/^\/(?:dev\s+revive|devrevive)\s*$/i.test(raw)) {
    const entity = ctx.entities.get(pid);
    if (entity?.dead || entity?.ghost) revivePlayerAt(ctx, pid, entity.pos, 1);
    emitDevLog(ctx, pid, '[dev] Revived.');
    return null;
  }
  if (/^\/(?:dev\s+combatreset|devcombatreset)\s*$/i.test(raw)) {
    resetCombatForDev(ctx, pid);
    emitDevLog(ctx, pid, '[dev] Combat state cleared.');
    return null;
  }
  if (/^\/(?:dev\s+(?:kill|die|suicide)|devkill)\s*$/i.test(raw)) {
    const entity = ctx.entities.get(pid);
    if (entity && !entity.dead) ctx.handleDeath(entity, null);
    return null;
  }

  if (/^\/dev(?:\s|$)/i.test(raw)) {
    ctx.error(
      pid,
      'Dev commands: /dev gui, /dev level, /dev tp, /dev spawn, /dev despawn, /dev killtarget, /dev give, /dev gold, /dev quest, /dev quests, /dev attune, /dev gather, /dev bot, /dev vendor, /dev lfg, /dev cascade, /dev sandbox, /dev god, /dev heal, /dev resource, /dev cooldowns, /dev revive, /dev combatreset, /dev dungeon, /dev raid, /dev kill',
    );
    return null;
  }
  return undefined;
}
