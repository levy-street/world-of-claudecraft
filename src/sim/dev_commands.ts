import { DEV_KIT_ROLES, devKitRole } from './content/dev_kit_roles';
import { MOUNT_KEYS, TRAINING_MOUNT_KEY } from './content/mounts';
import { GATHERING_PROFESSIONS } from './content/professions';
import { DUNGEONS, ITEMS, MOBS, NPCS } from './data';
import { applyDevKit } from './dev_kit';
import { createGroundObject, createMob } from './entity';
import { enterDungeon } from './instances/dungeons';
import { mountItemId, mountOwned } from './mounts';
import { MOUNT_TRAIN_MIN_LEVEL } from './mounts_training';
import { isGatheringProfessionId, queueGatheringGrant } from './professions/gathering';
import { placeMobileStationForPlayer } from './professions/mobile_station';
import { cancelProfessionSessionOnDisplacement } from './professions/session_teardown';
import { completeAllQuestsForDev } from './quests/dev_quest_commands';
import { RIFT_RANK_BASE_LEVEL, riftRankForBaseLevel } from './rift/ranks';
import { generateRiftPlan, isSetPieceSeed } from './rift/rift_gen';
import type { SentChat } from './sim';
import type { SimContext } from './sim_context';
import { revivePlayerAt } from './spirit';
import { MAX_LEVEL, type RiftTier } from './types';

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
      cancelProfessionSessionOnDisplacement(ctx, entity);
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

  if (/^\/(?:dev\s+mounts?|devmounts?)\s*$/i.test(raw)) {
    const meta = ctx.players.get(pid);
    const entity = ctx.entities.get(pid);
    if (meta && entity) {
      // Mounts have no per-mount level gate any more; the only level that still
      // matters anywhere in the mount flow is the stablemaster's level-20 buy gate.
      const maxGate = 20;
      const leveled = entity.level < maxGate;
      if (leveled) ctx.setPlayerLevel(maxGate, pid);
      meta.ridingTrained = true;
      let granted = 0;
      for (const key of MOUNT_KEYS) {
        if (mountOwned(meta, key)) continue;
        const itemId = mountItemId(key);
        if (!itemId) continue;
        ctx.addItem(itemId, 1, pid);
        granted += 1;
      }
      const levelNote = leveled ? `, level raised to ${maxGate} for the riding gate` : '';
      emitDevLog(
        ctx,
        pid,
        `[dev] Granted ${granted} mount reins (${MOUNT_KEYS.length} owned)${levelNote}. Use a reins item from your bags to ride.`,
      );
    }
    return null;
  }

  if (/^\/(?:dev\s+(?:mountquest|startmount)|devmountquest)\s*$/i.test(raw)) {
    const meta = ctx.players.get(pid);
    const entity = ctx.entities.get(pid);
    const marla = NPCS.stablemaster_marla;
    if (meta && entity && marla) {
      const gate = MOUNT_TRAIN_MIN_LEVEL;
      const leveled = entity.level < gate;
      if (leveled) ctx.setPlayerLevel(gate, pid);
      meta.copper += 100 * 10000;
      // Every teleport, the dev ones included, runs the one session teardown
      // (the same call /dev tp makes above).
      cancelProfessionSessionOnDisplacement(ctx, entity);
      const pos = ctx.groundPos(marla.pos.x + 2, marla.pos.z + 1);
      entity.pos = pos;
      entity.prevPos = { ...pos };
      ctx.rebucket(entity);
      const levelNote = leveled ? `level ${gate}, ` : '';
      emitDevLog(
        ctx,
        pid,
        `[dev] ${levelNote}100g added, teleported to the Highwatch Stables. Talk to Stablemaster Marla to begin the riding lesson.`,
      );
    }
    return null;
  }

  // /dev kit [spec]: wear the fresh-level-20 preset for this character's class and
  // the named spec (defaulting to the one currently specced). GEAR ONLY: level, spec
  // and talents are deliberately untouched, so a tester can vary gear and level
  // independently instead of the two being welded together.
  const kitMatch = /^\/(?:dev\s+kit|devkit)(?:\s+(\S+))?\s*$/i.exec(raw);
  if (kitMatch) {
    const meta = ctx.players.get(pid);
    if (!meta) return null;
    const spec = kitMatch[1] ?? meta.talents.spec;
    if (!spec) {
      ctx.error(pid, '[dev] No spec chosen; pass one, e.g. /dev kit fury.');
      return null;
    }
    if (!devKitRole(meta.cls, spec)) {
      const known = (DEV_KIT_ROLES[meta.cls] ?? []).map((role) => role.spec).join(', ');
      ctx.error(pid, `[dev] '${spec}' is not a ${meta.cls} spec. Try: ${known}.`);
      return null;
    }
    const applied = applyDevKit(ctx, meta.cls, spec, pid);
    if (!applied) {
      ctx.error(pid, `[dev] No kit for ${meta.cls} ${spec}.`);
      return null;
    }
    emitDevLog(
      ctx,
      pid,
      `[dev] Equipped the fresh-20 ${meta.cls} ${spec} kit: ${applied.slots} pieces and ${applied.bagsEquipped} bags.`,
    );
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

  const mobileStationMatch = /^\/(?:dev\s+mobilestation|devmobilestation)\s+(\S+)\s*$/i.exec(raw);
  if (mobileStationMatch) {
    // Places through the REAL specialization-gated path (mobile_station.ts),
    // same as the wire command: the cheat saves the walk, not the gate.
    const craftId = mobileStationMatch[1].toLowerCase();
    const station = placeMobileStationForPlayer(ctx, craftId, pid);
    if (!station) {
      // The module's dead gate already printed the real reason for a dead
      // caller; the specialization line would state the wrong one on top.
      if (!ctx.resolve(pid)?.e.dead) {
        ctx.error(
          pid,
          `[dev] Could not place a mobile ${craftId} station (specialization required).`,
        );
      }
    } else {
      const minutes = Math.round((station.expiresAtTick - station.placedAtTick) / (20 * 60));
      emitDevLog(ctx, pid, `[dev] Mobile ${craftId} station placed here for ${minutes} minutes.`);
    }
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

  // [dev] Spawn a procedural rift portal in front of the player. Each invocation
  // rolls a fresh seed (so every portal opens a different, infinite dungeon) unless
  // one is supplied for reproducibility. An optional rank letter selects the
  // DIFFICULTY: it maps to that rank's canonical baseLevel (RIFT_RANK_BASE_LEVEL),
  // overriding an explicit level, so what spawns inside always matches the badge.
  // Without a letter, the badge derives from the (explicit or player) level via
  // the same inversion every difficulty consumer uses; the badge can never lie.
  // A trailing kind token forces the DUNGEON TYPE:
  // /dev portal [seed] [level] [C|B|A|S] [infernal|random].
  //
  // The kind is not a wire field: it SEARCHES for a seed of the requested kind
  // (isSetPieceSeed is a pure function of the seed), so the descriptor stays
  // {seed, baseLevel, floorIndex, origin} and every client regenerates the same
  // dungeon from it. A supplied seed of the wrong kind is advanced, with a notice.
  const portalMatch =
    /^\/(?:dev\s+portal|devportal)(?:\s+(\d+))?(?:\s+(\d+))?(?:\s+([CBAScbas]))?(?:\s+(infernal|citadel|random|procedural))?\s*$/i.exec(
      raw,
    );
  if (portalMatch) {
    const e = ctx.entities.get(pid);
    if (!e) return null;
    let seed = (portalMatch[1] ? Number(portalMatch[1]) : ctx.rng.int(1, 1_000_000_000)) >>> 0;
    const kind = portalMatch[4]?.toLowerCase();
    if (kind) {
      const wantSetPiece = kind === 'infernal' || kind === 'citadel';
      const start = seed;
      for (let i = 0; i < 10_000 && isSetPieceSeed(seed) !== wantSetPiece; i++) {
        seed = (seed + 1) >>> 0;
      }
      if (isSetPieceSeed(seed) !== wantSetPiece) {
        ctx.error(pid, '[dev] Found no seed of that kind. Try again.');
        return null;
      }
      if (seed !== start) {
        ctx.emit({
          type: 'log',
          text: `[dev] Seed ${start} is not ${wantSetPiece ? 'infernal' : 'procedural'}; using ${seed}.`,
          color: '#b9f',
          pid,
        });
      }
    }
    const forcedTier = portalMatch[3] ? (portalMatch[3].toUpperCase() as RiftTier) : null;
    const baseLevel = forcedTier
      ? RIFT_RANK_BASE_LEVEL[forcedTier]
      : Math.max(1, Math.min(60, portalMatch[2] ? Number(portalMatch[2]) : e.level));
    const tier: RiftTier = forcedTier ?? riftRankForBaseLevel(Math.round(baseLevel));
    const d = 5;
    const px = e.pos.x + Math.sin(e.facing) * d;
    const pz = e.pos.z + Math.cos(e.facing) * d;
    const plan = generateRiftPlan(seed, baseLevel);
    const portal = createGroundObject(ctx.nextId++, '', plan.name, ctx.groundPos(px, pz));
    portal.templateId = 'rift_portal';
    portal.objectItemId = null;
    portal.lootable = true;
    portal.riftSeed = seed;
    portal.riftBaseLevel = baseLevel;
    portal.riftTier = tier;
    portal.facing = e.facing + Math.PI; // face back toward the player
    portal.prevFacing = portal.facing;
    ctx.addEntity(portal);
    ctx.emit({
      type: 'log',
      text: `[dev] Opened a ${tier}-rank portal to ${plan.name} (${plan.floorCount} floors, L${baseLevel}). Walk through it.`,
      color: '#b9f',
      pid,
    });
    return null;
  }

  // [dev] Toggle one-shot ("smite") mode: this player's every hit deletes any mob
  // it lands on (see dealDamage). Handy for blasting through the giga-boss rifts.
  if (/^\/(?:dev\s+(?:smite|oneshot|nuke)|devsmite)\s*$/i.test(raw)) {
    const e = ctx.entities.get(pid);
    if (e) {
      e.oneShot = !e.oneShot;
      ctx.emit({
        type: 'log',
        text: e.oneShot ? '[dev] Smite mode ON (one-shot everything).' : '[dev] Smite mode OFF.',
        color: '#b9f',
        pid,
      });
    }
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
      'Dev commands: /dev gui, /dev level, /dev tp, /dev spawn, /dev despawn, /dev killtarget, /dev give, /dev kit, /dev mounts, /dev mountquest, /dev gold, /dev quest, /dev quests, /dev attune, /dev mobilestation, /dev gather, /dev bot, /dev vendor, /dev lfg, /dev portal [seed] [level] [C|B|A|S] [infernal|random], /dev cascade, /dev sandbox, /dev smite, /dev god, /dev heal, /dev resource, /dev cooldowns, /dev revive, /dev combatreset, /dev dungeon, /dev raid, /dev kill',
    );
    return null;
  }
  return undefined;
}
