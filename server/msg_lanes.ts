// Post-parse per-class inbound lanes: movement, commands, and chat stop
// sharing one budget, so a saturated movement stream structurally cannot
// starve casts and a cast flood cannot starve movement (the reserved-lane
// requirement of the input cadence contract,
// docs/design/player-performance/packet-3-input-cadence.md, R5).
//
// The lanes are deliberately POST-parse: classification needs the parsed
// message type, and the pre-parse gate (server/msg_rate_limit.ts) has already
// bounded the frame and byte budget these checks run inside. Like the gate,
// every verdict is allow-or-drop, never defer: queueing a frame would shift
// its receive time, which the bot detector's timing strategies are calibrated
// against. Lane drops tally into the gate's shared per-second abuse window
// (tallyDrop, R6) at the consumer, and take no protocol-anomaly observation of
// their own: protocol_conformance means "not our client", not "server shed
// load".
//
// Classification mirrors GameServer.dispatchMessage's msg.t / msg.cmd switch:
// - movement: t 'input'. The refill clears the 82.5/s input-stream hard cap of
//   the measured client cadence (see the msg_rate_limit header).
// - chat: cmd 'chat'. A pre-guard only, deliberately more generous than the
//   in-handler ladder (consumeChatToken), which stays the authoritative chat
//   throttle and messaging; the ladder's cooldown copy still fires on the
//   subset the lane passes.
// - exempt, never lane-checked: t 'logout' (a clean leave always processes),
//   cmd 'telemetry', and cmd 'challengeResponse'. Defense-in-depth token
//   accounting: beats and challenge replies never compete for command-lane
//   tokens, and never spend or refill lane state at all.
// - name_screen: cmd 'pet_rename', and cmd 'perfect_item' carrying a `name`
//   field: the two handlers that run the obscenity matcher on player text
//   before any sim gate (see the lane's constants below).
// - command: every OTHER parsed shape. All remaining commands, plus the
//   garbage shapes (non-object JSON, unknown t, unknown cmd), so sub-ceiling
//   garbage is bounded to the lane rate and anything above it becomes
//   score-visible through the abuse window.
//
// Pure state + functions (no ClientSession/WebSocket import, injected nowSec)
// so the lane math is unit-testable without a live server.

// Movement lane: sized above the 82.5/s analytic hard cap of the client's
// input send scheme, so a legitimate held turn at any refresh rate never
// drops. Burst absorbs the reconnect catch-up spike, same shape as the gate.
export const MSG_LANE_MOVEMENT_REFILL_PER_SECOND = 90;
export const MSG_LANE_MOVEMENT_BURST = 120;

// Command lane: OS key repeat is filtered client-side (input.ts returns on
// e.repeat), so the worst legitimate rate is human mashing across keybinds
// and clicks, realistically under 20/s; 30/s with a 60 burst is comfortable
// headroom for casts, targeting, loot, vendor, trade, and the hotbar save.
export const MSG_LANE_COMMAND_REFILL_PER_SECOND = 30;
export const MSG_LANE_COMMAND_BURST = 60;

// Chat lane: a pre-guard bounding what a chat flood can burn; strictly more
// generous than the in-handler ladder (burst 5, a third of a message per
// second), so the ladder stays the player-facing throttle.
export const MSG_LANE_CHAT_REFILL_PER_SECOND = 4;
export const MSG_LANE_CHAT_BURST = 8;

// Name-screen lane (the Masterwrought phase 13 QA hot-path review): the two
// commands that run the obscenity matcher on player text BEFORE any sim gate
// (pet_rename, and perfect_item when it carries a legendary name) cost about
// 25 microseconds each on the event loop, and an ALLOWED under-ceiling frame
// books no drop, so on the 30/s command lane a hostile client could spend
// 0.8 ms/s per session on screens for frames naming an empty slot. Both are
// dialog actions at single digits per minute for a real player, so the lane
// is sized far above human rate (the chat lane's human-dialog sizing: a
// retype after a refusal is a second of human time, and five rapid submits
// fit the burst) and far below the command lane; refusals drop and tally
// like every other lane drop, and a dropped frame sends NOTHING back, so the
// phase 14 window disables its submit for a beat after each submit rather
// than letting a mash read as a dead button. Both tenants are shape-first:
// the matcher prices the sim's normalized value (32 or 16 characters), never
// the raw token. An UNNAMED perfect_item frame stays on the command lane: it
// runs no screen.
export const MSG_LANE_NAME_SCREEN_REFILL_PER_SECOND = 2;
export const MSG_LANE_NAME_SCREEN_BURST = 5;

/** The four metered lanes. */
export type MsgLane = 'movement' | 'command' | 'chat' | 'name_screen';

/** A metered lane, or exempt: never lane-checked, spends nothing. */
export type MsgLaneClass = MsgLane | 'exempt';

export interface MsgLaneState {
  movementTokens: number;
  commandTokens: number;
  chatTokens: number;
  nameScreenTokens: number;
  lastRefillSec: number;
}

export function createMsgLanes(nowSec: number): MsgLaneState {
  return {
    movementTokens: MSG_LANE_MOVEMENT_BURST,
    commandTokens: MSG_LANE_COMMAND_BURST,
    chatTokens: MSG_LANE_CHAT_BURST,
    nameScreenTokens: MSG_LANE_NAME_SCREEN_BURST,
    lastRefillSec: nowSec,
  };
}

/** The two commands whose handler screens player text through the obscenity
 *  matcher ahead of every sim gate; perfect_item only when a name field rides
 *  (the promotion), never for a plain attempt. */
function isNameScreenCommand(record: Record<string, unknown>): boolean {
  if (record.cmd === 'pet_rename') return true;
  return record.cmd === 'perfect_item' && record.name !== undefined;
}

/**
 * Classify a parsed inbound message into its lane, mirroring the
 * GameServer.dispatchMessage switch. Takes the raw JSON.parse result: valid
 * non-object JSON (null, numbers, strings, arrays) is command-lane garbage,
 * exactly like an unknown t or an unknown cmd.
 */
export function classifyMsgLane(msg: unknown): MsgLaneClass {
  if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) return 'command';
  const record = msg as Record<string, unknown>;
  if (record.t === 'logout') return 'exempt';
  if (record.t === 'input') return 'movement';
  if (record.t !== 'cmd') return 'command';
  if (record.cmd === 'chat') return 'chat';
  if (record.cmd === 'telemetry' || record.cmd === 'challengeResponse') return 'exempt';
  if (isNameScreenCommand(record)) return 'name_screen';
  return 'command';
}

/**
 * Mutates `state` in place and returns whether this frame may proceed down
 * its lane. A dropped frame spends nothing, mirroring the pre-parse gate. All
 * four lanes refill off one shared clock on every call, which is equivalent
 * to lazy per-lane refill because the refill math composes over time splits.
 */
export function consumeLaneToken(
  state: MsgLaneState,
  lane: MsgLane,
  nowSec: number,
): 'allow' | 'drop' {
  const elapsed = Math.max(0, nowSec - state.lastRefillSec);
  state.movementTokens = Math.min(
    MSG_LANE_MOVEMENT_BURST,
    state.movementTokens + elapsed * MSG_LANE_MOVEMENT_REFILL_PER_SECOND,
  );
  state.commandTokens = Math.min(
    MSG_LANE_COMMAND_BURST,
    state.commandTokens + elapsed * MSG_LANE_COMMAND_REFILL_PER_SECOND,
  );
  state.chatTokens = Math.min(
    MSG_LANE_CHAT_BURST,
    state.chatTokens + elapsed * MSG_LANE_CHAT_REFILL_PER_SECOND,
  );
  state.nameScreenTokens = Math.min(
    MSG_LANE_NAME_SCREEN_BURST,
    state.nameScreenTokens + elapsed * MSG_LANE_NAME_SCREEN_REFILL_PER_SECOND,
  );
  state.lastRefillSec = nowSec;
  if (lane === 'movement') {
    if (state.movementTokens < 1) return 'drop';
    state.movementTokens -= 1;
  } else if (lane === 'command') {
    if (state.commandTokens < 1) return 'drop';
    state.commandTokens -= 1;
  } else if (lane === 'name_screen') {
    if (state.nameScreenTokens < 1) return 'drop';
    state.nameScreenTokens -= 1;
  } else {
    if (state.chatTokens < 1) return 'drop';
    state.chatTokens -= 1;
  }
  return 'allow';
}
