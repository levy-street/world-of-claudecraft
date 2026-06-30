export const MODERATION_COMMAND_REASON_MAX = 500;
export const MODERATION_COMMAND_MINUTES_MAX = 10 * 365 * 24 * 60;

const DEFAULT_REASON = 'No reason specified';

export type ModerationChatCommand =
  | { kind: 'kick'; reason: string }
  | { kind: 'kill'; reason: string }
  | { kind: 'forcerename'; reason: string }
  | { kind: 'mute'; minutes: number | null; reason: string }
  | { kind: 'ban'; reason: string }
  | { kind: 'suspend'; minutes: number | null; reason: string }
  | { kind: 'spectate'; name: string }
  | { kind: 'unspectate' };

function cleanReason(raw: string): string {
  const reason = raw.trim().slice(0, MODERATION_COMMAND_REASON_MAX);
  return reason || DEFAULT_REASON;
}

function parseTimed(rest: string): { minutes: number | null; reason: string } {
  const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(rest.trim());
  if (!match) return { minutes: null, reason: DEFAULT_REASON };
  const parsed = /^\d+$/.test(match[1]) ? Number(match[1]) : null;
  const minutes =
    parsed !== null &&
    Number.isSafeInteger(parsed) &&
    parsed >= 1 &&
    parsed <= MODERATION_COMMAND_MINUTES_MAX
      ? parsed
      : null;
  return { minutes, reason: cleanReason(match[2] ?? '') };
}

// Invalid arguments remain parsed commands so they are intercepted instead of
// leaking into ordinary chat. The policy service returns the usage notice.
export function parseModerationChatCommand(text: string): ModerationChatCommand | null {
  const trimmed = text.trim();
  const kick = /^\/kick(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (kick) {
    return { kind: 'kick', reason: cleanReason(kick[1] ?? '') };
  }
  const kill = /^\/kill(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (kill) {
    return { kind: 'kill', reason: cleanReason(kill[1] ?? '') };
  }
  const forceRename = /^\/forcerename(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (forceRename) {
    return { kind: 'forcerename', reason: cleanReason(forceRename[1] ?? '') };
  }
  const mute = /^\/mute(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (mute) {
    return { kind: 'mute', ...parseTimed(mute[1] ?? '') };
  }
  const ban = /^\/ban(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (ban) {
    return { kind: 'ban', reason: cleanReason(ban[1] ?? '') };
  }
  const suspend = /^\/suspend(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (suspend) {
    return { kind: 'suspend', ...parseTimed(suspend[1] ?? '') };
  }
  const spectate = /^\/spectate(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (spectate) {
    return { kind: 'spectate', name: (spectate[1] ?? '').trim() };
  }
  if (/^\/unspectate$/i.test(trimmed)) return { kind: 'unspectate' };
  return null;
}
