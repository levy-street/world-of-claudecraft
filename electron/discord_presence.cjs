'use strict';

// Discord Rich Presence, in house.
//
// Discord's own SDK is a native dependency with a service of its own; the wire
// protocol it speaks to the locally running client is a JSON frame on a unix
// socket (a named pipe on Windows), which is small enough to own outright. That
// keeps the dependency set where CONTRIBUTING wants it and, more importantly,
// keeps every failure mode ours to decide: a player without Discord, a player
// who quits Discord mid-session, and a build whose app id was never registered
// all have to be non-events for the game.
//
// The rules that shape the state machine:
//
//  - CONSTRUCTION DOES NO IO. main.cjs builds this at module scope, before the
//    window exists, so the constructor may not touch a socket or arm a timer.
//    The first connection attempt happens when the game first has something to
//    show, which is also the earliest moment the connection is worth anything.
//  - ABSENCE IS SILENT. No Discord client means every candidate path fails, and
//    that is the common case for most players. It gets a debug line and a
//    backoff, never a warning and never a tight retry loop.
//  - A MISCONFIGURED APP ID IS TERMINAL. An unregistered client_id is answered
//    with a CLOSE frame before READY (probe-confirmed: {"code":4000,"message":
//    "Invalid Client ID"}). Retrying that would hot-loop against the daemon for
//    the whole session, so it is a one-line warning and a full stop.
//  - THE RATE LIMIT IS OURS TOO. Discord throttles presence updates (about one
//    per fifteen seconds), and the renderer's zone changes are not paced. The
//    floor here is trailing-edge: the LATEST desired activity is what lands,
//    intermediate ones are dropped rather than queued, because a presence line
//    that is four zones behind is worse than one that skipped four zones.
//
// Pure and dependency-injected (no electron import, and the socket factory
// arrives as a function), so tests/electron_discord_presence.test.ts drives
// every transition with a fake socket and fake timers.

const {
  EMPTY_FRAME_BUFFER,
  OPCODES,
  decodeFrames,
  encodeHandshake,
  encodePong,
  encodeSetActivity,
} = require('./discord_presence_codec.cjs');

/** The floor between two SET_ACTIVITY writes; Discord's own limit is near this. */
const DISCORD_MIN_SEND_INTERVAL_MS = 15000;

/** The first reconnect delay, doubled on each further failure. */
const DISCORD_BASE_BACKOFF_MS = 2000;

/** The ceiling the doubling stops at. */
const DISCORD_MAX_BACKOFF_MS = 60000;

/**
 * How long an accepted socket may sit on an unanswered handshake, or a READY
 * connection on an unanswered SET_ACTIVITY, before the peer is treated as
 * dead. A real Discord answers both in one turn, so this fires only for a
 * wedged daemon or a squatter that accepts and says nothing, either of which
 * used to park the state machine ('handshaking' forever, or flush() gated on
 * a nonce nobody will echo) until the socket happened to close. Expiry is the
 * same event as a hangup and takes the same road: destroy, then the ordinary
 * retry/backoff path, never a tight loop.
 */
const DISCORD_ANSWER_TIMEOUT_MS = 10000;

/** How many socket paths Discord may be listening on (discord-ipc-0 .. -9). */
const DISCORD_PIPE_SLOTS = 10;

/**
 * A Discord application id is a snowflake: digits only, and never a length that
 * short. Validated as a shape rather than trusted, because it arrives from the
 * environment and is written straight into a handshake.
 */
const DISCORD_CLIENT_ID_PATTERN = /^\d{15,22}$/;

/**
 * The official World of ClaudeCraft Discord application id, baked in by the
 * owner's provisioning decision (2026-08-15) once the registration landed
 * under exactly that name (the registration name is what Discord renders as
 * "Playing X"). An application id is public, every shipped build exposes it
 * on the wire, so baking it in leaks nothing, and it is what makes presence
 * work out of the box for players, who never set environment variables. This
 * supersedes the earlier no-hardcoded-fallback stance, which was the correct
 * reading only while no registration existed.
 */
const DEFAULT_DISCORD_APP_ID = '1537920691200983141';

/**
 * The app id for this build. Precedence: an unset WOC_DISCORD_APP_ID means
 * the baked official id; a set and valid value overrides it (the operator
 * slot); a set but INVALID value, the empty string included, resolves to
 * null and keeps the whole feature inert. That last arm is deliberate twice
 * over: it is the typo failure mode (never dial with junk), and it is the
 * documented opt-out for forks that do not want their sessions reported as
 * the official app (WOC_DISCORD_APP_ID=off).
 */
function resolveDiscordClientId(env) {
  const raw = env?.WOC_DISCORD_APP_ID;
  if (typeof raw !== 'string') return DEFAULT_DISCORD_APP_ID;
  return DISCORD_CLIENT_ID_PATTERN.test(raw) ? raw : null;
}

/**
 * The visible cap on the details line. Deliberately BELOW Discord's own 128:
 * clampText appends a three-dot suffix ON TOP of the cap it is given, so 125
 * plus the suffix is the largest string this can produce, and a details line
 * Discord would reject outright never leaves the machine.
 */
const DISCORD_DETAILS_MAX = 125;

/** The cap on any peer-written text this module puts in the log. */
const DISCORD_LOG_TEXT_MAX = 200;

/**
 * The clamp used when the caller injects none. The real one
 * (electron/diagnostics.cjs clampText) also flattens control characters, which
 * is why main.cjs passes it; this fallback only exists so the module is not
 * silently unbounded when used standalone.
 */
const fallbackClampText = (value, maxLength) => String(value).slice(0, maxLength);

/**
 * Build the activity object that may be sent, or null for anything that may
 * not. Pure and exported so the whitelist is EXECUTED by tests rather than
 * merely read off the handler: the risk this guards is a field quietly added
 * later (a player name, a party id, a lobby secret) reaching another program,
 * and a source-text pin cannot see that happen.
 *
 * The answer is always a FRESH object built from validated primitives, so
 * nothing that crossed the IPC (no prototype, no getter, no extra key) can ride
 * along. Malformed timestamps REFUSE the whole activity rather than being
 * stripped: a start the caller meant to send and this dropped would render as a
 * live counter running from the wrong moment, with nothing to notice it.
 */
function sanitizeDiscordActivity(payload, clampTextFn) {
  const clamp = typeof clampTextFn === 'function' ? clampTextFn : fallbackClampText;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (typeof payload.details !== 'string') return null;
  const details = clamp(payload.details, DISCORD_DETAILS_MAX);
  if (typeof details !== 'string' || details.trim() === '') return null;
  if (payload.timestamps === undefined) return { details };
  const timestamps = payload.timestamps;
  if (!timestamps || typeof timestamps !== 'object' || Array.isArray(timestamps)) return null;
  const start = timestamps.start;
  // A safe positive integer only: this is a unix timestamp in epoch SECONDS
  // (the renderer builder's contract; Discord auto-detects the magnitude)
  // rendered as a live counter, so a float, a NaN, or a zero would show the
  // player a timer running from the epoch.
  if (!Number.isSafeInteger(start) || start <= 0) return null;
  return { details, timestamps: { start } };
}

/**
 * Every socket path Discord could be listening on, in the order to try them.
 *
 * Windows uses named pipes and has one fixed base. Everywhere else the socket
 * lives in the runtime directory, but a sandboxed install relocates it: Flatpak
 * puts it under app/com.discordapp.Discord and snap under snap.discord, both
 * inside XDG_RUNTIME_DIR (the Flatpak path is the one that answered on the
 * maintainer's box). Those two are linux-only; macOS has neither packaging.
 *
 * The order is n-MAJOR: every base is tried for ipc-0 before any base is tried
 * for ipc-1. Slot 0 is what a single running client uses, so a base-major walk
 * would spend nine failed connects on the first base's empty slots before
 * reaching the base that actually has one.
 */
function candidatePipePaths(platform, env) {
  if (platform === 'win32') {
    const paths = [];
    for (let n = 0; n < DISCORD_PIPE_SLOTS; n += 1) paths.push(`\\\\?\\pipe\\discord-ipc-${n}`);
    return paths;
  }
  const bases = [];
  const addBase = (base) => {
    if (typeof base !== 'string' || base === '' || bases.includes(base)) return;
    bases.push(base);
  };
  const runtimeDir = env?.XDG_RUNTIME_DIR;
  addBase(runtimeDir);
  if (platform === 'linux' && typeof runtimeDir === 'string' && runtimeDir !== '') {
    addBase(`${runtimeDir}/app/com.discordapp.Discord`);
    addBase(`${runtimeDir}/snap.discord`);
  }
  // TMPDIR is usually /tmp, which is why the dedupe above is not cosmetic: the
  // walk is ten connect attempts per base on a machine with no Discord at all.
  addBase(env?.TMPDIR);
  addBase('/tmp');
  const paths = [];
  for (let n = 0; n < DISCORD_PIPE_SLOTS; n += 1) {
    for (const base of bases) paths.push(`${base}/discord-ipc-${n}`);
  }
  return paths;
}

function requireFunction(value, label) {
  if (typeof value !== 'function') {
    throw new TypeError(`createDiscordPresence: ${label} must be a function`);
  }
}

function requirePositiveInterval(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(
      `createDiscordPresence: ${label} must be a finite number greater than zero`,
    );
  }
}

/**
 * Structural equality over the small JSON activity objects this module sends.
 * Key ORDER is deliberately not part of it: the comparison exists to answer
 * "would this write change what Discord is showing", and a caller that built an
 * identical object a different way has nothing to say.
 */
function sameActivity(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    if (!Object.hasOwn(b, key)) return false;
    if (!sameActivity(a[key], b[key])) return false;
  }
  return true;
}

/**
 * Build the presence connection. Returns the three signals the shell drives it
 * with (what to show, whether the player wants it at all, and app shutdown)
 * plus a state readout the tests assert transitions through.
 */
function createDiscordPresence({
  clientId,
  connect,
  statPath,
  uid = null,
  platform,
  env,
  now,
  setTimeoutFn,
  clearTimeoutFn,
  random,
  pid,
  log,
  clampText = fallbackClampText,
  initiallyEnabled = true,
  minSendIntervalMs = DISCORD_MIN_SEND_INTERVAL_MS,
  maxBackoffMs = DISCORD_MAX_BACKOFF_MS,
  answerTimeoutMs = DISCORD_ANSWER_TIMEOUT_MS,
}) {
  requireFunction(connect, 'connect');
  requireFunction(statPath, 'statPath');
  requireFunction(clampText, 'clampText');
  requireFunction(now, 'now');
  requireFunction(setTimeoutFn, 'setTimeoutFn');
  requireFunction(clearTimeoutFn, 'clearTimeoutFn');
  requireFunction(random, 'random');
  requirePositiveInterval(minSendIntervalMs, 'minSendIntervalMs');
  requirePositiveInterval(maxBackoffMs, 'maxBackoffMs');
  requirePositiveInterval(answerTimeoutMs, 'answerTimeoutMs');
  if (!Number.isInteger(pid)) {
    throw new TypeError('createDiscordPresence: pid must be an integer');
  }
  if (!log || typeof log.warn !== 'function' || typeof log.debug !== 'function') {
    throw new TypeError('createDiscordPresence: log must provide warn and debug');
  }

  // An id that is absent or malformed makes the whole module inert rather than
  // half-live: nothing to connect to means nothing worth a socket, a timer, or
  // a log line on every zone change.
  const appId = typeof clientId === 'string' && clientId !== '' ? clientId : null;
  const paths = appId === null ? [] : candidatePipePaths(platform, env);

  // The connection lifecycle: 'idle' (nothing wanted or nothing running),
  // 'connecting' (walking the candidate paths), 'handshaking' (a socket
  // accepted us and the handshake is out), 'ready' (Discord answered READY),
  // 'backoff' (waiting to retry), 'off' (the player turned it off).
  let state = 'idle';
  // Held separately from the lifecycle because it must SURVIVE a disable and a
  // re-enable: an unregistered app id is a property of the build, so it stays
  // refused for the whole process run however the player toggles the setting.
  let terminal = appId === null ? 'absent' : null;
  let enabled = initiallyEnabled !== false;

  let socket = null;
  let inbound = EMPTY_FRAME_BUFFER;
  let pathIndex = 0;
  let connectAttempts = 0;

  // What the game wants shown (null means "show nothing"), and what actually
  // went out on the current connection. lastSentActivity is undefined until a
  // write lands and is reset on every READY, because a fresh connection knows
  // nothing about what the last one was told.
  let desired = null;
  let lastSentActivity;
  let lastSendAt = 0;
  let pendingNonce = null;
  let nonceCounter = 0;
  let loggedActivityError = false;

  let backoffMs = 0;
  let retryTimer = null;
  let sendTimer = null;
  let answerTimer = null;

  const clearRetryTimer = () => {
    if (retryTimer === null) return;
    clearTimeoutFn(retryTimer);
    retryTimer = null;
  };

  const clearSendTimer = () => {
    if (sendTimer === null) return;
    clearTimeoutFn(sendTimer);
    sendTimer = null;
  };

  const clearAnswerTimer = () => {
    if (answerTimer === null) return;
    clearTimeoutFn(answerTimer);
    answerTimer = null;
  };

  // Drop the live socket without letting its own teardown events act: the
  // reference is cleared FIRST, so the handlers below see a socket that is no
  // longer ours and return.
  const destroySocket = () => {
    if (socket === null) return;
    const dead = socket;
    socket = null;
    inbound = EMPTY_FRAME_BUFFER;
    pendingNonce = null;
    // The answer wait belongs to the socket it was armed for; a dead socket
    // owes nothing, and a stale expiry must never tear down a successor.
    clearAnswerTimer();
    try {
      dead.destroy();
    } catch {
      // A socket that refuses to be destroyed is already gone as far as we care.
    }
  };

  // One bounded wait for the peer's next REQUIRED answer: READY after the
  // handshake, then the nonce echo after each SET_ACTIVITY. Re-armed per
  // question, disarmed when the answer arrives or the socket goes; expiry is
  // treated exactly like a hangup, so it lands in the ordinary retry/backoff
  // path (which, unforgiven, keeps escalating against a peer that never
  // answers anything).
  const armAnswerTimer = () => {
    clearAnswerTimer();
    answerTimer = setTimeoutFn(() => {
      answerTimer = null;
      if (socket === null) return;
      log.debug('[discord] peer never answered within the timeout; reconnecting');
      destroySocket();
      scheduleRetry();
    }, answerTimeoutMs);
  };

  const write = (buffer) => {
    if (socket === null) return false;
    try {
      socket.write(buffer);
      return true;
    } catch {
      // A write that throws (a pipe closed between the check and the call) is
      // the same event as a close: drop back to the reconnect path.
      destroySocket();
      scheduleRetry();
      return false;
    }
  };

  // The trailing-edge rate limiter and the single-flight gate, in one place so
  // every path that could send (a new activity, a READY, a response, a timer)
  // asks the same question.
  const flush = () => {
    if (state !== 'ready' || socket === null) return;
    // One SET_ACTIVITY in flight at a time. Discord answers each with an echo of
    // its nonce; the response handler calls back here, so a desired value that
    // changed meanwhile is never lost, only deferred.
    if (pendingNonce !== null) return;
    if (sameActivity(desired, lastSentActivity)) return;
    const at = now();
    const waitMs = minSendIntervalMs - (at - lastSendAt);
    if (waitMs > 0) {
      // One timer, re-read at fire time: whatever `desired` holds THEN is what
      // goes out, so a burst of zone changes costs one write rather than a
      // queue the player watches replay.
      if (sendTimer === null) {
        sendTimer = setTimeoutFn(() => {
          sendTimer = null;
          flush();
        }, waitMs);
      }
      return;
    }
    clearSendTimer();
    nonceCounter += 1;
    const nonce = `woc-${nonceCounter}`;
    const activity = desired;
    if (!write(encodeSetActivity(nonce, pid, activity))) return;
    pendingNonce = nonce;
    lastSentActivity = activity;
    lastSendAt = at;
    // The peer now owes an echo of this nonce; bound the wait, or a peer that
    // never answers would gate this function forever.
    armAnswerTimer();
  };

  const onReady = () => {
    state = 'ready';
    // The walk starts over from the first candidate next time. The backoff is
    // deliberately NOT forgiven here: READY proves a peer speaks the protocol,
    // not that it is a working Discord (the win32 pipe namespace has no
    // ownership gate at all), and forgiving at READY handed a READY-then-drop
    // squatter a reset of the escalation every cycle, a one-to-two-second
    // redial loop for the whole session. Forgiveness waits for an
    // ACKNOWLEDGED SET_ACTIVITY (the nonce-echo arm in handleFrame), which
    // such a peer never produces.
    pathIndex = 0;
    // The handshake was answered; the next bounded wait is armed by the flush
    // write below, if anything actually goes out.
    clearAnswerTimer();
    pendingNonce = null;
    // A new connection has been told nothing, so even an unchanged activity has
    // to go out again; without this reset a reconnect would leave the presence
    // blank until the player changed zone.
    lastSentActivity = undefined;
    flush();
  };

  /**
   * Peer-written text on its way to the log. Everything that arrives on this
   * socket was written by another program, so it is bounded AND (with the real
   * clampText) stripped of control characters before it reaches a log file:
   * unbounded, a hostile peer could grow the log without limit, and with
   * newlines it could forge log lines around its own. A numeric code is not
   * text and rides as itself so the log stays readable.
   */
  const clampLogValue = (value) =>
    typeof value === 'number' ? value : clampText(String(value ?? ''), DISCORD_LOG_TEXT_MAX);

  const onInvalidClient = (payload) => {
    // Terminal, and the one line in this module that is worth a warning: it is
    // always a build or configuration mistake, and it is silent otherwise.
    log.warn(
      '[discord] presence refused by the client, disabling for this run:',
      clampLogValue(payload?.code),
      clampLogValue(payload?.message),
    );
    terminal = 'invalid-client';
    clearRetryTimer();
    clearSendTimer();
    destroySocket();
    desired = null;
  };

  const handleFrame = (frame) => {
    if (frame.opcode === OPCODES.PING) {
      write(encodePong(frame.payload ?? {}));
      return;
    }
    if (frame.opcode === OPCODES.CLOSE) {
      if (state !== 'ready') {
        // Only the probe-confirmed refusal shape is a verdict on the BUILD:
        // {"code":4000,"message":"Invalid Client ID"} before READY, or a
        // payload too mangled to carry a code at all (fail closed: a peer that
        // cannot say why it refused is not one to hot-loop against). Any OTHER
        // explicit code pre-READY is the daemon bowing out (a restart, a
        // shutdown), which is a reconnect, not a full stop for the run.
        const code = frame.payload?.code;
        if (!Number.isInteger(code) || code === 4000) {
          onInvalidClient(frame.payload);
          return;
        }
        log.debug('[discord] client closed during the handshake:', clampLogValue(code));
        // Advance the walk, symmetric with a pre-READY socket hangup: a peer
        // that answers CLOSE has spoken the protocol but has NOT proven it is
        // Discord, and backing off here would restart every retry at slot 0,
        // pinned to a CLOSE-answering squatter. Real Discord bowing out costs
        // only the remaining stat-fail candidates before the same backoff.
        destroySocket();
        state = 'connecting';
        connectNextPath();
        return;
      }
      // A CLOSE on a connection that was working is Discord shutting down, not
      // a refusal: reconnect like any other drop.
      destroySocket();
      scheduleRetry();
      return;
    }
    if (frame.opcode !== OPCODES.FRAME) return;
    const payload = frame.payload;
    if (payload === null || typeof payload !== 'object') return;
    if (payload.evt === 'READY') {
      onReady();
      return;
    }
    if (pendingNonce !== null && payload.nonce === pendingNonce) {
      // The echo is the proof a working Discord sits at the far end (a
      // squatter can parrot READY; answering a COMMAND it would have to
      // implement the protocol), so this is where the reconnect backoff is
      // forgiven: a later failure is a new problem. An ERROR echo forgives
      // too; the connection answered, only the payload was refused.
      backoffMs = 0;
      clearAnswerTimer();
      if (payload.evt === 'ERROR' && !loggedActivityError) {
        // Once per run. A rejected activity is reported and then treated as
        // delivered: retrying the payload Discord just refused would be a loop,
        // and the next real change goes out normally.
        loggedActivityError = true;
        log.warn('[discord] presence update rejected:', clampLogValue(payload.data?.message));
      }
      pendingNonce = null;
      flush();
    }
  };

  const attach = (candidate) => {
    // Guards every handler below: a socket that has been superseded (the walk
    // moved on, or the manager was disposed) must not be able to advance the
    // walk a second time or resurrect a torn-down connection.
    const isLive = () => socket === candidate;

    candidate.on('connect', () => {
      if (!isLive()) return;
      state = 'handshaking';
      inbound = EMPTY_FRAME_BUFFER;
      // The peer now owes a READY; bound the wait, so a squatter that accepts
      // and says nothing costs one answer window rather than the session.
      if (write(encodeHandshake(appId))) armAnswerTimer();
    });

    candidate.on('data', (chunk) => {
      if (!isLive()) return;
      // The accumulator is bounded by the decoder: anything claiming more than
      // MAX_FRAME_BYTES is an error rather than a payload to keep waiting for,
      // so this can never grow past one header plus one capped frame.
      inbound = inbound.length === 0 ? Buffer.from(chunk) : Buffer.concat([inbound, chunk]);
      const { frames, rest, error } = decodeFrames(inbound);
      inbound = rest;
      for (const frame of frames) {
        if (!isLive()) return;
        handleFrame(frame);
      }
      if (error === null || !isLive()) return;
      // The stream cannot be resynchronized (see the decoder), so the socket
      // goes rather than the shell reading whatever comes next as frames.
      log.debug('[discord] dropping a corrupt IPC stream:', error);
      destroySocket();
      scheduleRetry();
    });

    const onSocketGone = () => {
      if (!isLive()) return;
      socket = null;
      inbound = EMPTY_FRAME_BUFFER;
      pendingNonce = null;
      clearSendTimer();
      clearAnswerTimer();
      try {
        candidate.destroy();
      } catch {
        // Already gone; nothing to release.
      }
      if (terminal !== null || state === 'off') return;
      if (state === 'connecting' || state === 'handshaking') {
        // 'connecting': the socket never came up, the ordinary reading of
        // "Discord is not listening on THIS path". 'handshaking': it accepted
        // and hung up before READY, which proves something listens there but
        // not that it is Discord (a real client answers READY in one turn).
        // Either way the slot is treated as refused and the walk moves on in
        // the same pass; backing off here instead would restart every retry at
        // slot 0 and pin the walk to an accept-and-drop squatter forever (the
        // win32 pipe namespace has no ownership gate at all). The other two
        // squatter shapes are covered elsewhere: one that accepts and stays
        // SILENT is destroyed by the answer timeout (armed at the handshake
        // write) into this same backoff path, and one that parrots READY can
        // no longer reset the escalation, because backoff forgiveness is
        // gated on an acknowledged SET_ACTIVITY (see onReady and the
        // nonce-echo arm in handleFrame).
        state = 'connecting';
        connectNextPath();
        return;
      }
      // It was READY and then went away (Discord quit, a broken pipe): the
      // paths are not the problem, so back off rather than walking them again.
      scheduleRetry();
    };

    candidate.on('error', onSocketGone);
    candidate.on('close', onSocketGone);
  };

  /**
   * Whether a candidate path is safe to dial at all.
   *
   * The walk ends at /tmp, which is world-writable on every unix we ship to. A
   * second local account (or any process running as another user on a shared
   * machine) can create a listening socket at one of these names and answer the
   * handshake, at which point the shell would hand it the presence line, and
   * whatever the game reports would be readable by whoever planted it. So a
   * candidate is dialed only when the entry is really a SOCKET and really OURS.
   *
   * A stat that throws is the ordinary case (nothing at that path) and counts
   * exactly like a refused connect: walk on. Windows named pipes are skipped
   * because there is no meaningful stat for one, and their namespace is not a
   * world-writable directory to begin with.
   */
  const candidateIsOurs = (path) => {
    if (platform === 'win32') return true;
    let stats = null;
    try {
      stats = statPath(path);
    } catch {
      return false;
    }
    if (!stats || typeof stats.isSocket !== 'function' || !stats.isSocket()) return false;
    // A platform with no getuid (or a caller that passed none) cannot answer
    // the ownership question; the socket check above still stands.
    if (typeof uid !== 'number') return true;
    return stats.uid === uid;
  };

  function connectNextPath() {
    if (terminal !== null || !enabled) return;
    if (pathIndex >= paths.length) {
      // Every candidate refused us. This is what "the player does not run
      // Discord" looks like, so it stays at debug and turns into a backoff.
      pathIndex = 0;
      log.debug('[discord] no local IPC socket answered; retrying later');
      scheduleRetry();
      return;
    }
    const path = paths[pathIndex];
    pathIndex += 1;
    // Not counted as an attempt: nothing was dialed.
    if (!candidateIsOurs(path)) {
      connectNextPath();
      return;
    }
    connectAttempts += 1;
    let candidate = null;
    try {
      candidate = connect(path);
    } catch {
      candidate = null;
    }
    if (!candidate) {
      connectNextPath();
      return;
    }
    socket = candidate;
    attach(candidate);
  }

  function scheduleRetry() {
    if (terminal !== null || retryTimer !== null) return;
    state = 'backoff';
    // The ceiling caps the FIRST delay too, so an injected ceiling below the
    // base cannot produce a backoff longer than the caller asked for.
    backoffMs =
      backoffMs === 0
        ? Math.min(DISCORD_BASE_BACKOFF_MS, maxBackoffMs)
        : Math.min(backoffMs * 2, maxBackoffMs);
    // Jittered so a machine that suspended with the game open does not have
    // every reconnect land on the same instant as every other client's.
    const delayMs = Math.max(1, Math.round(backoffMs * (0.5 + random() * 0.5)));
    retryTimer = setTimeoutFn(() => {
      retryTimer = null;
      if (terminal !== null || state !== 'backoff') return;
      // Only reconnect for something worth showing. A player who turned the
      // setting off, or who is at a screen with no activity, gets no socket.
      if (!enabled || desired === null) {
        state = 'idle';
        return;
      }
      state = 'connecting';
      pathIndex = 0;
      connectNextPath();
    }, delayMs);
  }

  const beginConnect = () => {
    if (terminal !== null || !enabled) return;
    if (state !== 'idle' && state !== 'off') return;
    state = 'connecting';
    pathIndex = 0;
    connectNextPath();
  };

  return {
    /**
     * What the game wants Discord to show, or null for nothing. The FIRST
     * non-null activity is what opens the connection: until the player is in
     * the world there is nothing to report, and a shell that dialed at boot
     * would pay the walk (and Discord would show the game as running) for a
     * player still sitting at the login screen.
     */
    setActivity: (activity) => {
      if (terminal !== null) return;
      desired = activity === null || activity === undefined ? null : activity;
      if (!enabled) return;
      if (desired !== null) beginConnect();
      flush();
    },

    /**
     * The player's setting. Turning it off clears the presence on the way out,
     * because leaving a stale line in Discord's UI would be the opposite of
     * what the toggle promises. Turning it back on connects nothing by itself:
     * the next activity does that, the same way the first one did.
     */
    setEnabled: (nextEnabled) => {
      if (terminal === 'disposed') return;
      const on = nextEnabled === true;
      if (on === enabled) return;
      enabled = on;
      if (on) {
        if (state === 'off') state = 'idle';
        return;
      }
      if (state === 'ready' && socket !== null) {
        nonceCounter += 1;
        write(encodeSetActivity(`woc-${nonceCounter}`, pid, null));
        try {
          socket.end();
        } catch {
          // The clear may not have reached Discord; destroying below is what
          // matters, and Discord drops the presence when the socket closes.
        }
      }
      clearRetryTimer();
      clearSendTimer();
      clearAnswerTimer();
      destroySocket();
      desired = null;
      lastSentActivity = undefined;
      state = 'off';
    },

    /** App shutdown. Terminal: nothing may reconnect behind a quitting process. */
    dispose: () => {
      if (terminal === 'disposed') return;
      terminal = 'disposed';
      clearRetryTimer();
      clearSendTimer();
      clearAnswerTimer();
      destroySocket();
      desired = null;
    },

    /** The lifecycle readout the tests assert on, without reaching into privates. */
    stateForTest: () => ({
      state: terminal ?? state,
      enabled,
      desiredActivity: desired,
      lastSentActivity,
      pendingNonce,
      backoffMs,
      connectAttempts,
    }),
  };
}

module.exports = {
  DEFAULT_DISCORD_APP_ID,
  DISCORD_ANSWER_TIMEOUT_MS,
  DISCORD_BASE_BACKOFF_MS,
  DISCORD_DETAILS_MAX,
  DISCORD_LOG_TEXT_MAX,
  DISCORD_MAX_BACKOFF_MS,
  DISCORD_MIN_SEND_INTERVAL_MS,
  DISCORD_PIPE_SLOTS,
  candidatePipePaths,
  createDiscordPresence,
  resolveDiscordClientId,
  sanitizeDiscordActivity,
};
