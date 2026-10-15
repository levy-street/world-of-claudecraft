export const MODERATION_COMMAND_REASON_MAX = 500;
export const MODERATION_COMMAND_MINUTES_MAX = 10 * 365 * 24 * 60;
// A realm announcement is one chat line, so it shares the chat line cap
// (src/sim/sim.ts MAX_CHAT_MESSAGE_LEN; not imported to keep this parser
// free of the sim graph).
export const ANNOUNCE_TEXT_MAX = 255;
export const WATCH_NOTE_MAX = 200;

const DEFAULT_REASON = 'No reason specified';

export type ModerationChatCommand =
  | { kind: 'kick'; name: string | null; reason: string }
  | { kind: 'kill'; name: string | null; reason: string }
  | { kind: 'forcerename'; name: string | null; reason: string }
  | { kind: 'mute'; name: string | null; minutes: number | null; reason: string }
  | { kind: 'ban'; name: string | null; reason: string }
  | { kind: 'suspend'; name: string | null; minutes: number | null; reason: string }
  | { kind: 'spectate'; name: string | null }
  | { kind: 'unspectate' }
  | {
      kind: 'jail';
      name: string | null;
      minutes: number | null;
      reason: string | null;
      malformed: boolean;
    }
  | { kind: 'unjail'; name: string | null; malformed: boolean }
  // GM presence: on = seen by everyone (the default), off = invisible and
  // untargetable. null is a malformed argument (the usage notice).
  | { kind: 'visible'; on: boolean | null }
  // Staff watchlist. A bare /watch lists the entries; a malformed name is
  // kept as name null so the service answers with the usage notice.
  | { kind: 'watch'; name: string | null; note: string | null; list: boolean }
  | { kind: 'unwatch'; name: string | null }
  | { kind: 'announce'; text: string | null };

function cleanReason(raw: string): string {
  const reason = raw.trim().slice(0, MODERATION_COMMAND_REASON_MAX);
  return reason || DEFAULT_REASON;
}

function cleanName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, ' ');
  return name || null;
}

function parseQuotedName(rest: string): { name: string | null; rest: string } | null {
  const match = /^"([^"]*)"(?:\s+([\s\S]*))?$/.exec(rest.trim());
  if (!match) return null;
  return { name: cleanName(match[1]), rest: (match[2] ?? '').trim() };
}

function parseNamed(rest: string): { name: string | null; reason: string } {
  const parsed = parseQuotedName(rest);
  if (!parsed) return { name: null, reason: DEFAULT_REASON };
  return { name: parsed.name, reason: cleanReason(parsed.rest) };
}

function parseNamedTimed(rest: string): {
  name: string | null;
  minutes: number | null;
  reason: string;
} {
  const named = parseQuotedName(rest);
  if (!named) return { name: null, minutes: null, reason: DEFAULT_REASON };
  const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(named.rest);
  if (!match) return { name: named.name, minutes: null, reason: DEFAULT_REASON };
  const parsed = /^\d+$/.test(match[1]) ? Number(match[1]) : null;
  const minutes =
    parsed !== null &&
    Number.isSafeInteger(parsed) &&
    parsed >= 1 &&
    parsed <= MODERATION_COMMAND_MINUTES_MAX
      ? parsed
      : null;
  return { name: named.name, minutes, reason: cleanReason(match[2] ?? '') };
}

function parseSpectateName(rest: string): string | null {
  const trimmed = rest.trim();
  if (!trimmed.startsWith('"')) return cleanName(trimmed);
  const parsed = parseQuotedName(trimmed);
  return parsed?.rest === '' ? parsed.name : null;
}

function parseOptionalQuotedName(rest: string): { name: string | null; malformed: boolean } {
  const trimmed = rest.trim();
  if (!trimmed) return { name: null, malformed: false };
  const parsed = parseQuotedName(trimmed);
  if (!parsed || parsed.rest !== '') return { name: null, malformed: true };
  return { name: parsed.name, malformed: parsed.name === null };
}

// /jail: no arguments = the moderator's own jail visit. Jailing a player
// REQUIRES a quoted name and a sentence length in minutes (there is no
// indefinite form; that ambiguity invited mistakes), then an optional reason,
// quoted or bare. Anything else is malformed (the usage notice).
function parseJailArguments(rest: string): {
  name: string | null;
  minutes: number | null;
  reason: string | null;
  malformed: boolean;
} {
  const trimmed = rest.trim();
  if (!trimmed) return { name: null, minutes: null, reason: null, malformed: false };
  const invalid = { name: null, minutes: null, reason: null, malformed: true };
  const parsed = parseQuotedName(trimmed);
  if (!parsed || parsed.name === null) return invalid;
  const match = /^(\d+)(?:\s+([\s\S]*))?$/.exec(parsed.rest);
  const minutes = match ? Number(match[1]) : null;
  if (
    minutes === null ||
    !Number.isSafeInteger(minutes) ||
    minutes < 1 ||
    minutes > MODERATION_COMMAND_MINUTES_MAX
  ) {
    return invalid;
  }
  let reasonRaw = (match?.[2] ?? '').trim();
  const quoted = /^"([^"]*)"$/.exec(reasonRaw);
  if (quoted) reasonRaw = quoted[1].trim();
  return {
    name: parsed.name,
    minutes,
    reason: reasonRaw ? cleanReason(reasonRaw) : null,
    malformed: false,
  };
}

function parseVisibleArgument(rest: string): boolean | null {
  const arg = rest.trim().toLowerCase();
  if (arg === 'on') return true;
  if (arg === 'off') return false;
  return null;
}

// /watch "<name>" [note]: the note is free text (quoted or bare) shown to the
// GMs pinged on login. A bare /watch is the list form.
function parseWatchArguments(rest: string): {
  name: string | null;
  note: string | null;
  list: boolean;
} {
  const trimmed = rest.trim();
  if (!trimmed) return { name: null, note: null, list: true };
  const parsed = parseQuotedName(trimmed);
  if (!parsed) return { name: null, note: null, list: false };
  let noteRaw = parsed.rest;
  const quoted = /^"([^"]*)"$/.exec(noteRaw);
  if (quoted) noteRaw = quoted[1];
  const note = noteRaw.replace(/\s+/g, ' ').trim().slice(0, WATCH_NOTE_MAX);
  return { name: parsed.name, note: note || null, list: false };
}

// One line of free text: newlines and runs of whitespace fold to one space so
// a broadcast cannot forge extra chat-log lines.
function parseAnnounceText(rest: string): string | null {
  const text = rest.replace(/\s+/g, ' ').trim().slice(0, ANNOUNCE_TEXT_MAX);
  return text || null;
}

// Invalid arguments remain parsed commands so they are intercepted instead of
// leaking into ordinary chat. The policy service returns the usage notice.
export function parseModerationChatCommand(text: string): ModerationChatCommand | null {
  const trimmed = text.trim();
  const kick = /^\/kick(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (kick) {
    return { kind: 'kick', ...parseNamed(kick[1] ?? '') };
  }
  const kill = /^\/kill(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (kill) {
    return { kind: 'kill', ...parseNamed(kill[1] ?? '') };
  }
  const forceRename = /^\/forcerename(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (forceRename) {
    return { kind: 'forcerename', ...parseNamed(forceRename[1] ?? '') };
  }
  const mute = /^\/mute(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (mute) {
    return { kind: 'mute', ...parseNamedTimed(mute[1] ?? '') };
  }
  const ban = /^\/ban(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (ban) {
    return { kind: 'ban', ...parseNamed(ban[1] ?? '') };
  }
  const suspend = /^\/suspend(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (suspend) {
    return { kind: 'suspend', ...parseNamedTimed(suspend[1] ?? '') };
  }
  const spectate = /^\/spectate(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (spectate) {
    return { kind: 'spectate', name: parseSpectateName(spectate[1] ?? '') };
  }
  if (/^\/unspectate$/i.test(trimmed)) return { kind: 'unspectate' };
  const jail = /^\/jail(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (jail) {
    return { kind: 'jail', ...parseJailArguments(jail[1] ?? '') };
  }
  const unjail = /^\/unjail(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (unjail) {
    return { kind: 'unjail', ...parseOptionalQuotedName(unjail[1] ?? '') };
  }
  const visible = /^\/visible(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (visible) {
    return { kind: 'visible', on: parseVisibleArgument(visible[1] ?? '') };
  }
  const watch = /^\/watch(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (watch) {
    return { kind: 'watch', ...parseWatchArguments(watch[1] ?? '') };
  }
  const unwatch = /^\/unwatch(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (unwatch) {
    const parsed = parseOptionalQuotedName(unwatch[1] ?? '');
    return { kind: 'unwatch', name: parsed.malformed ? null : parsed.name };
  }
  const announce = /^\/announce(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (announce) {
    return { kind: 'announce', text: parseAnnounceText(announce[1] ?? '') };
  }
  return null;
}
