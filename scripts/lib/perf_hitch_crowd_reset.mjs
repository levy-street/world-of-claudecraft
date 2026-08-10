// Pure reset planning and validation for the hitch referee's crowd-influx roster.
// WebSocket execution stays in perf_hitch_scenarios.mjs.

// The northern Veiled Hollow staging meadow is a shipped-seed fixture, not an
// arbitrary empty-looking coordinate. The focused test proves every grid cell
// is dry, collision-free, standable (an idle body settles without collider
// push-out or steep-slope slide), and beyond the maximum aggro plus wander
// reach of every hostile world spawn. The root sits one column west of the
// original 45,1401 grid: the abandoned east column at x=75 crossed a steep
// terrain band (rideSteepnessAt up to 2.27 versus the 1.5 climb limit), which
// slid parked bots 0.8 to 3.6 units downhill and failed neutral validation.
export const HITCH_CROWD_PARKING_LOCATION = Object.freeze({
  name: 'northern Veiled Hollow staging meadow',
  x: 39,
  z: 1401,
});
export const HITCH_CROWD_PARKING_X = HITCH_CROWD_PARKING_LOCATION.x;
export const HITCH_CROWD_PARKING_Z = HITCH_CROWD_PARKING_LOCATION.z;
export const HITCH_CROWD_PARKING_COLUMNS = 6;
export const HITCH_CROWD_PARKING_SPACING = 6;
export const HITCH_CROWD_PARKING_TOLERANCE = 2;
// This second verified-empty meadow is farther than the open-world interest
// drop radius from parking. The camera starts here, then the roster arrives in
// batches. The 50-unit envelope covers the mounted movement during measurement.
export const HITCH_CROWD_INFLUX_LOCATION = Object.freeze({
  name: 'northern Veiled Hollow influx meadow',
  x: -113,
  z: 1413,
});
export const HITCH_CROWD_INFLUX_X = HITCH_CROWD_INFLUX_LOCATION.x;
export const HITCH_CROWD_INFLUX_Z = HITCH_CROWD_INFLUX_LOCATION.z;
export const HITCH_CROWD_INFLUX_MOTION_RADIUS = 50;
export const HITCH_CROWD_INFLUX_START_RADIUS = 9;
export const HITCH_CROWD_INFLUX_MOVE_INTERVAL_MS = 250;
export const HITCH_CROWD_INFLUX_MOVE_STEPS = 12;
// Online self mirrors do not carry Entity.inCombat. The HUD combines live mob
// aggro records with personal damage in this window, so the referee uses both
// signals and cannot call a reset quiet until neither one remains.
export const HITCH_CROWD_COMBAT_QUIET_MS = 6_000;
export const HITCH_CROWD_FACING = 0;
export const HITCH_CROWD_FACING_TOLERANCE = 0.01;
export const HITCH_CROWD_RESET_LEVEL = 20;
// Spirit Healer resurrection adds no sickness below level 10. Recovery uses level 1,
// then restores the fixed level 20 target before neutral normalization begins.
export const HITCH_CROWD_RECOVERY_LEVEL = 1;

// Server-side per-connection send budgets the reset must stay beneath. A /dev
// text rides cmd:'chat', so it draws from the server's in-handler chat ladder
// (server/game.ts consumeChatToken): burst 5 tokens, refill 1/3 token per
// second (CHAT_RATE_REFILL_PER_SECOND, 20 messages per minute), and 3
// consecutive refused sends lock chat for 20 seconds, longer than a whole
// reset phase. Spacing one bot's chat sends at least this far apart keeps its
// send rate strictly below the one-token-per-3-seconds refill, so the bucket
// can never run dry and the ladder can never emit even a slow-down warning.
export const HITCH_CROWD_CHAT_RETRY_MS = 3_500;
// Non-chat commands ride the post-parse command lane (server/msg_lanes.ts:
// refill 30 per second, burst 60). The reset plans at most about ten distinct
// command signatures per bot, so one issue plus a retry at this quiet window
// stays far beneath that budget while still recovering a silently dropped
// command inside the phase timeout.
export const HITCH_CROWD_COMMAND_RETRY_MS = 2_500;
// '/dev mounts' grants riding plus reins, but its readback (mntRtd, bag
// contents) needs a snapshot round trip. The dev_give fallback waits this long
// after the grant before concluding the reins only exist as a banked copy.
export const HITCH_CROWD_MOUNT_GRANT_READBACK_MS = 1_000;

const RATE_LIMITER_ERROR_PATTERN =
  /sending messages too quickly|chat locked for|chat is on cooldown/i;

const FRESH_AURAS_BY_CLASS = Object.freeze({ warrior: Object.freeze(['battle_stance']) });
const RECOVERY_SICKNESS_AURA_IDS = new Set(['resurrection_sickness', 'unstuck_sickness']);

export function buildCrowdInfluxPositions(botCount) {
  if (!Number.isInteger(botCount) || botCount <= 0) {
    throw new Error(`crowd influx bot count is invalid: ${String(botCount)}`);
  }
  const center = { x: HITCH_CROWD_INFLUX_X, z: HITCH_CROWD_INFLUX_Z };
  return Array.from({ length: botCount }, (_, index) => {
    const angle = (index / botCount) * Math.PI * 2;
    return {
      x: center.x + Math.sin(angle) * HITCH_CROWD_INFLUX_START_RADIUS,
      z: center.z + Math.cos(angle) * HITCH_CROWD_INFLUX_START_RADIUS,
      angle,
    };
  });
}

function mountKeyForItem(item) {
  if (typeof item !== 'string' || !item.startsWith('reins_') || item.length <= 'reins_'.length) {
    throw new Error(`crowd reset mount item is invalid: ${String(item)}`);
  }
  return item.slice('reins_'.length);
}

export function buildCrowdResetTargets(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('crowd reset requires at least one fixture row');
  }
  const seen = new Set();
  return rows.map((row) => {
    if (!Number.isInteger(row?.index) || row.index < 0 || seen.has(row.index)) {
      throw new Error(`crowd reset bot index is invalid: ${String(row?.index)}`);
    }
    seen.add(row.index);
    if (
      !Number.isInteger(row.skin) ||
      typeof row.cls !== 'string' ||
      typeof row.weaponType !== 'string' ||
      typeof row.weaponSkin !== 'string'
    ) {
      throw new Error(`crowd reset appearance is incomplete for bot ${row.index}`);
    }
    const parkingColumn = row.index % HITCH_CROWD_PARKING_COLUMNS;
    const parkingRow = Math.floor(row.index / HITCH_CROWD_PARKING_COLUMNS);
    return {
      botIndex: row.index,
      parking: {
        x: HITCH_CROWD_PARKING_X + parkingColumn * HITCH_CROWD_PARKING_SPACING,
        z: HITCH_CROWD_PARKING_Z + parkingRow * HITCH_CROWD_PARKING_SPACING,
      },
      facing: HITCH_CROWD_FACING,
      level: HITCH_CROWD_RESET_LEVEL,
      auraIds: [...(FRESH_AURAS_BY_CLASS[row.cls] ?? [])],
      skin: row.skin,
      weaponType: row.weaponType,
      weaponSkin: row.weaponSkin,
      mountItem: row.mountItem,
      mountKey: mountKeyForItem(row.mountItem),
    };
  });
}

export function observeCrowdResetState({
  botIndex,
  frame,
  profilerInvulnerable = false,
  ridingTrained,
  inventory,
  inCombat,
}) {
  const latest = frame && typeof frame === 'object' ? frame : {};
  const auraIds = Array.isArray(latest.auras)
    ? [...new Set(latest.auras.map((aura) => aura?.id).filter((id) => typeof id === 'string'))]
    : [];
  const latestInventory = Array.isArray(inventory)
    ? inventory
    : Array.isArray(latest.inv)
      ? latest.inv
      : [];
  const bagItemIds = [
    ...new Set(
      latestInventory.map((slot) => slot?.itemId).filter((itemId) => typeof itemId === 'string'),
    ),
  ];
  return {
    botIndex,
    x: Number(latest.x),
    z: Number(latest.z),
    facing: Number(latest.f),
    level: Number(latest.lv),
    skin: Number(latest.sk ?? 0),
    weaponSkin: typeof latest.wsk === 'string' ? latest.wsk : null,
    mountKey: typeof latest.mnt === 'string' ? latest.mnt : '',
    mountCastRemaining: Number(latest.mcr ?? 0),
    mountCastKey: typeof latest.mck === 'string' ? latest.mck : '',
    weaponStowed: latest.ws === 1,
    auraIds,
    targetId: typeof latest.target === 'number' ? latest.target : null,
    autoAttack: latest.auto === true,
    queuedOnSwing: typeof latest.queued === 'string' ? latest.queued : null,
    casting: typeof latest.cast === 'string' && latest.cast.length > 0,
    inCombat: inCombat === true,
    dead: latest.dead === 1,
    ghost: latest.gh === 1,
    profilerInvulnerable: profilerInvulnerable === true,
    ridingTrained: ridingTrained === undefined ? latest.mntRtd === true : ridingTrained === true,
    bagItemIds,
  };
}

function command(botIndex, payload) {
  return { botIndex, kind: 'command', payload };
}

function input(botIndex, move, facing) {
  return { botIndex, kind: 'input', move, facing };
}

const MOUNT_GRANT_PAYLOAD = Object.freeze({ cmd: 'chat', text: '/dev mounts' });

/**
 * Issue-once command pacing state for one reset invocation, generalizing the
 * mount summon's issue-then-hold mechanism to every command type. Each
 * bot-plus-payload signature records when it was last sent; the acknowledgment
 * is implicit (the planners stop planning a command once its state readback
 * converges), and an unacknowledged command is re-sent only after its class
 * quiet window. lastChatAtByBot additionally spaces ALL of one bot's chat
 * sends (across different texts) at HITCH_CROWD_CHAT_RETRY_MS, the provable
 * stay-under-the-ladder guarantee.
 */
export function createCrowdCommandLedger() {
  return { issuedAtBySignature: new Map(), lastChatAtByBot: new Map() };
}

export function crowdCommandSignature(botIndex, payload) {
  return `${botIndex}:${JSON.stringify(payload, Object.keys(payload).sort())}`;
}

function commandRetryWindowMs(payload) {
  return payload.cmd === 'chat' ? HITCH_CROWD_CHAT_RETRY_MS : HITCH_CROWD_COMMAND_RETRY_MS;
}

/**
 * Filter planned actions through the ledger: inputs always pass (the 200 ms
 * poll sits far beneath the 90 per second movement lane), a command passes
 * once and then only after its quiet window, and chat additionally honors the
 * per-bot whole-lane spacing. Allowed commands are recorded as issued.
 */
export function paceCrowdResetActions(ledger, actions, nowMs) {
  const allowed = [];
  for (const action of actions) {
    if (action.kind !== 'command') {
      allowed.push(action);
      continue;
    }
    const signature = crowdCommandSignature(action.botIndex, action.payload);
    const issuedAt = ledger.issuedAtBySignature.get(signature);
    if (issuedAt !== undefined && nowMs - issuedAt < commandRetryWindowMs(action.payload)) continue;
    if (action.payload.cmd === 'chat') {
      const lastChatAt = ledger.lastChatAtByBot.get(action.botIndex);
      if (lastChatAt !== undefined && nowMs - lastChatAt < HITCH_CROWD_CHAT_RETRY_MS) continue;
      ledger.lastChatAtByBot.set(action.botIndex, nowMs);
    }
    ledger.issuedAtBySignature.set(signature, nowMs);
    allowed.push(action);
  }
  return allowed;
}

/**
 * Plan the recovery mount-readiness commands: a '/dev mounts' grant while the
 * authoritative mntRtd readback is missing, and the dev_give reins fallback
 * once the grant has had its readback window (or immediately when riding was
 * already trained and no grant is pending), so a banked-only copy still lands
 * in bags. Re-sends are owned by the pacing ledger, never by the planner.
 */
export function planCrowdMountReadinessActions(targets, states, ledger, nowMs) {
  const stateByBot = new Map(states.map((state) => [state.botIndex, state]));
  const actions = [];
  for (const target of targets) {
    const state = stateByBot.get(target.botIndex);
    if (!state) continue;
    if (!state.ridingTrained) {
      actions.push(command(target.botIndex, { ...MOUNT_GRANT_PAYLOAD }));
    }
    if (!state.bagItemIds.includes(target.mountItem)) {
      const grantIssuedAt = ledger.issuedAtBySignature.get(
        crowdCommandSignature(target.botIndex, MOUNT_GRANT_PAYLOAD),
      );
      const grantReadbackElapsed =
        grantIssuedAt === undefined
          ? state.ridingTrained
          : nowMs - grantIssuedAt >= HITCH_CROWD_MOUNT_GRANT_READBACK_MS;
      if (grantReadbackElapsed) {
        actions.push(
          command(target.botIndex, { cmd: 'dev_give', item: target.mountItem, count: 1 }),
        );
      }
    }
  }
  return actions;
}

/**
 * Fail closed when any bot's server error tail contains the server chat rate
 * limiter's texts: those can only mean the referee itself out-sent the budget,
 * which invalidates the measured first-draw surface.
 */
export function assertNoRateLimiterErrors(serverErrors) {
  for (const tail of serverErrors ?? []) {
    const hit = (tail?.errors ?? []).find((text) => RATE_LIMITER_ERROR_PATTERN.test(String(text)));
    if (hit !== undefined) {
      throw new Error(
        `crowd-influx bot ${tail.botIndex} tripped the server message rate limiter: ${hit}`,
      );
    }
  }
  return serverErrors ?? [];
}

function requiresCombatReset(state) {
  return (
    state.inCombat ||
    state.targetId !== null ||
    state.autoAttack ||
    state.queuedOnSwing !== null ||
    state.casting
  );
}

function outsideParking(state, target) {
  return (
    !Number.isFinite(state.x) ||
    !Number.isFinite(state.z) ||
    Math.abs(state.x - target.parking.x) > HITCH_CROWD_PARKING_TOLERANCE ||
    Math.abs(state.z - target.parking.z) > HITCH_CROWD_PARKING_TOLERANCE
  );
}

function outsideFacing(state, target) {
  if (!Number.isFinite(state.facing)) return true;
  const delta = state.facing - target.facing;
  const wrapped = Math.atan2(Math.sin(delta), Math.cos(delta));
  return Math.abs(wrapped) > HITCH_CROWD_FACING_TOLERANCE;
}

export function crowdResetPlacementSettled(target, state) {
  return !outsideParking(state, target) && !outsideFacing(state, target);
}

function sameAuras(actual, expected) {
  const left = [...actual].sort();
  const right = [...expected].sort();
  return left.length === right.length && left.every((auraId, index) => auraId === right[index]);
}

export function planCrowdRecoveryActions(targets, states) {
  const stateByBot = new Map(states.map((state) => [state.botIndex, state]));
  const actions = [];
  for (const target of targets) {
    const state = stateByBot.get(target.botIndex);
    if (!state) continue;
    if (state.dead || state.ghost) {
      if (state.level !== HITCH_CROWD_RECOVERY_LEVEL) {
        actions.push(
          command(target.botIndex, { cmd: 'dev_level', level: HITCH_CROWD_RECOVERY_LEVEL }),
        );
      } else if (!state.ghost) {
        actions.push(command(target.botIndex, { cmd: 'release' }));
      } else {
        actions.push(command(target.botIndex, { cmd: 'resurrect_healer' }));
      }
      continue;
    }
    if (state.level !== target.level) {
      actions.push(command(target.botIndex, { cmd: 'dev_level', level: target.level }));
    }
  }
  return actions;
}

function validateCrowdRecovery(targets, states, requireMountReadiness) {
  const stateByBot = new Map(states.map((state) => [state.botIndex, state]));
  const failures = [];
  for (const target of targets) {
    const state = stateByBot.get(target.botIndex);
    if (!state) {
      failures.push(`bot ${target.botIndex} snapshot unavailable`);
      continue;
    }
    if (state.dead || state.ghost) {
      failures.push(`bot ${target.botIndex} remained dead or ghosted`);
    }
    if (state.level !== target.level) {
      failures.push(
        `bot ${target.botIndex} recovery level expected ${target.level}, got ${display(state.level)}`,
      );
    }
    if (!state.profilerInvulnerable) {
      failures.push(`bot ${target.botIndex} profiler invulnerability was not armed`);
    }
    const sickness = state.auraIds.filter((auraId) => RECOVERY_SICKNESS_AURA_IDS.has(auraId));
    if (sickness.length > 0) {
      failures.push(`bot ${target.botIndex} recovery sickness remained: ${sickness.join(',')}`);
    }
    if (requireMountReadiness) {
      if (!state.ridingTrained) {
        failures.push(`bot ${target.botIndex} riding training was not granted`);
      }
      if (!state.bagItemIds.includes(target.mountItem)) {
        failures.push(`bot ${target.botIndex} mount reins ${target.mountItem} were not in bags`);
      }
    }
  }
  return { ok: failures.length === 0, phase: 'recovery', bots: targets.length, failures };
}

export function validateCrowdRecoveryLifeState(targets, states) {
  return validateCrowdRecovery(targets, states, false);
}

export function validateCrowdRecoveryState(targets, states) {
  return validateCrowdRecovery(targets, states, true);
}

function presentedNonMountStateSettled(target, state) {
  return (
    crowdResetPlacementSettled(target, state) &&
    state.level === target.level &&
    state.skin === target.skin &&
    state.weaponSkin === target.weaponSkin &&
    !state.weaponStowed &&
    sameAuras(state.auraIds, target.auraIds) &&
    !requiresCombatReset(state) &&
    !state.dead &&
    !state.ghost
  );
}

export function planCrowdResetActions(targets, states, phase, sequence = {}) {
  if (phase !== 'neutral' && phase !== 'presented') {
    throw new Error(`unknown crowd reset phase: ${String(phase)}`);
  }
  const nowMs = Number(sequence.nowMs ?? 0);
  const presentedAlignedBotIds = sequence.presentedAlignedBotIds;
  const mountRetryHoldUntilByBot = sequence.mountRetryHoldUntilByBot;
  const stateByBot = new Map(states.map((state) => [state.botIndex, state]));
  const actions = [];
  for (const target of targets) {
    const state = stateByBot.get(target.botIndex);
    if (!state) continue;

    if (phase === 'neutral') {
      const cancelMountCast = state.mountCastRemaining > 0;
      actions.push(
        input(target.botIndex, cancelMountCast || state.casting ? { f: 1 } : {}, target.facing),
      );
      if (state.targetId !== null) {
        actions.push(command(target.botIndex, { cmd: 'target', id: null }));
      }
      actions.push(
        command(target.botIndex, {
          cmd: 'dev_teleport',
          x: target.parking.x,
          z: target.parking.z,
        }),
        command(target.botIndex, { cmd: 'chat', text: '/dev combatreset' }),
        command(target.botIndex, { cmd: 'change_skin', skin: 0 }),
        command(target.botIndex, {
          cmd: 'change_weapon_skin',
          skin: null,
          wtype: target.weaponType,
        }),
      );
      if (state.mountKey) {
        actions.push(command(target.botIndex, { cmd: 'mount_toggle' }));
      }
      if (state.weaponStowed) {
        actions.push(command(target.botIndex, { cmd: 'stow_weapon' }));
      }
      for (const auraId of [...new Set(state.auraIds)].filter(
        (id) => !target.auraIds.includes(id),
      )) {
        actions.push(command(target.botIndex, { cmd: 'cancel_aura', aura: auraId }));
      }
      for (const auraId of target.auraIds.filter((id) => !state.auraIds.includes(id))) {
        actions.push(command(target.botIndex, { cmd: 'cast', ability: auraId }));
      }
      continue;
    }

    const expectedSummonInFlight =
      state.mountCastRemaining > 0 && state.mountCastKey === target.mountKey;
    if (expectedSummonInFlight) continue;

    const mountRetryHoldUntil = mountRetryHoldUntilByBot?.get(target.botIndex);
    if (state.mountKey !== target.mountKey && Number.isFinite(mountRetryHoldUntil)) {
      if (nowMs < mountRetryHoldUntil) continue;
      actions.push(command(target.botIndex, { cmd: 'use', item: target.mountItem }));
      continue;
    }

    if (state.mountCastRemaining > 0) {
      if (state.mountCastKey !== '') {
        actions.push(input(target.botIndex, { f: 1 }, target.facing));
      }
      continue;
    }

    const aligned = presentedAlignedBotIds?.has(target.botIndex) ?? true;
    if (!aligned || !crowdResetPlacementSettled(target, state)) {
      actions.push(input(target.botIndex, {}, target.facing));
      if (outsideParking(state, target)) {
        actions.push(
          command(target.botIndex, {
            cmd: 'dev_teleport',
            x: target.parking.x,
            z: target.parking.z,
          }),
        );
      }
      continue;
    }

    const actionStart = actions.length;
    if (state.casting) {
      actions.push(input(target.botIndex, { f: 1 }, target.facing));
    }
    if (state.targetId !== null) {
      actions.push(command(target.botIndex, { cmd: 'target', id: null }));
    }
    if (requiresCombatReset(state)) {
      actions.push(command(target.botIndex, { cmd: 'chat', text: '/dev combatreset' }));
    }
    if (state.skin !== target.skin) {
      actions.push(command(target.botIndex, { cmd: 'change_skin', skin: target.skin }));
    }
    if (state.weaponSkin !== target.weaponSkin) {
      actions.push(
        command(target.botIndex, { cmd: 'change_weapon_skin', skin: target.weaponSkin }),
      );
    }
    if (state.mountKey && state.mountKey !== target.mountKey) {
      actions.push(command(target.botIndex, { cmd: 'mount_toggle' }));
    }
    if (state.weaponStowed) {
      actions.push(command(target.botIndex, { cmd: 'stow_weapon' }));
    }
    for (const auraId of [...new Set(state.auraIds)].filter((id) => !target.auraIds.includes(id))) {
      actions.push(command(target.botIndex, { cmd: 'cancel_aura', aura: auraId }));
    }
    if (actions.length > actionStart) continue;

    if (presentedNonMountStateSettled(target, state) && state.mountKey !== target.mountKey) {
      actions.push(command(target.botIndex, { cmd: 'use', item: target.mountItem }));
    }
  }
  return actions;
}

function display(value) {
  return value === '' || value === null ? 'none' : String(value);
}

export function validateCrowdResetState(targets, states, phase) {
  if (phase !== 'neutral' && phase !== 'presented') {
    throw new Error(`unknown crowd reset phase: ${String(phase)}`);
  }
  const stateByBot = new Map(states.map((state) => [state.botIndex, state]));
  const failures = [];
  for (const target of targets) {
    const state = stateByBot.get(target.botIndex);
    if (!state) {
      failures.push(`bot ${target.botIndex} snapshot unavailable`);
      continue;
    }
    if (outsideParking(state, target)) {
      failures.push(
        `bot ${target.botIndex} parking expected ${target.parking.x},${target.parking.z}, got ${display(state.x)},${display(state.z)}`,
      );
    }
    if (outsideFacing(state, target)) {
      failures.push(
        `bot ${target.botIndex} facing expected ${target.facing}, got ${display(state.facing)}`,
      );
    }
    if (state.level !== target.level) {
      failures.push(
        `bot ${target.botIndex} level expected ${target.level}, got ${display(state.level)}`,
      );
    }

    const expectedSkin = phase === 'neutral' ? 0 : target.skin;
    const expectedWeaponSkin = phase === 'neutral' ? null : target.weaponSkin;
    const expectedMountKey = phase === 'neutral' ? '' : target.mountKey;
    if (state.skin !== expectedSkin) {
      failures.push(
        `bot ${target.botIndex} skin expected ${expectedSkin}, got ${display(state.skin)}`,
      );
    }
    if (state.weaponSkin !== expectedWeaponSkin) {
      failures.push(
        `bot ${target.botIndex} weapon skin expected ${display(expectedWeaponSkin)}, got ${display(state.weaponSkin)}`,
      );
    }
    if (state.mountKey !== expectedMountKey) {
      failures.push(
        `bot ${target.botIndex} mount expected ${display(expectedMountKey)}, got ${display(state.mountKey)}`,
      );
    }
    if (state.mountCastRemaining !== 0 || state.mountCastKey !== '') {
      failures.push(
        `bot ${target.botIndex} mount transition expected idle, got ${state.mountCastRemaining}:${display(state.mountCastKey)}`,
      );
    }
    if (state.weaponStowed) failures.push(`bot ${target.botIndex} weapon remained stowed`);
    const expectedAuras = [...target.auraIds].sort();
    const actualAuras = [...state.auraIds].sort();
    if (!sameAuras(actualAuras, expectedAuras)) {
      failures.push(
        `bot ${target.botIndex} auras expected ${expectedAuras.join(',') || 'empty'}, got ${actualAuras.join(',') || 'empty'}`,
      );
    }
    if (
      state.targetId !== null ||
      state.autoAttack ||
      state.queuedOnSwing !== null ||
      state.casting
    ) {
      failures.push(`bot ${target.botIndex} combat presentation did not clear`);
    }
    if (state.inCombat) failures.push(`bot ${target.botIndex} remained in combat`);
    if (state.dead || state.ghost) failures.push(`bot ${target.botIndex} remained dead or ghosted`);
  }
  return { ok: failures.length === 0, phase, bots: targets.length, failures };
}

export function assertCrowdResetEvidence(reset, botCount) {
  if (
    !reset?.recovery?.ok ||
    !reset?.neutral?.ok ||
    !reset?.presented?.ok ||
    reset.bots !== botCount ||
    reset.recovery.bots !== botCount ||
    reset.neutral.bots !== botCount ||
    reset.presented.bots !== botCount
  ) {
    throw new Error('crowd-influx reset evidence is incomplete before influx');
  }
  return reset;
}

export function buildCrowdInfluxValidation({ cosmetics, quiet, reset, botCount, serverErrors }) {
  assertCrowdResetEvidence(reset, botCount);
  const errorTails = assertNoRateLimiterErrors(serverErrors);
  if (cosmetics.players < Math.floor(botCount * 0.8)) {
    throw new Error(`crowd-influx rendered only ${cosmetics.players}/${botCount} bots`);
  }
  if (cosmetics.skins < 4 || cosmetics.weaponSkins < 4 || cosmetics.mounts < 3) {
    throw new Error(`crowd-influx cosmetic variety is incomplete: ${JSON.stringify(cosmetics)}`);
  }
  return { ...cosmetics, quiet, reset, serverErrors: errorTails };
}
