export const MODERATION_COMMAND_REASON_MAX = 500;
export const MODERATION_COMMAND_MINUTES_MAX = 10 * 365 * 24 * 60;

const DEFAULT_REASON = 'No reason specified';

export type ModerationChatCommand =
  | { kind: 'kick'; name: string | null; reason: string }
  | { kind: 'kill'; name: string | null; reason: string }
  | { kind: 'forcerename'; name: string | null; reason: string }
  | { kind: 'mute'; name: string | null; minutes: number | null; reason: string }
  | { kind: 'ban'; name: string | null; reason: string }
  | { kind: 'suspend'; name: string | null; minutes: number | null; reason: string }
  | { kind: 'spectate'; name: string | null }
  | { kind: 'unspectate' };

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
  return null;
}
