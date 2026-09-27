// King of the Hill: the `/dev hill ...` argument grammar, pure so a test can pin
// it without a Sim. src/sim/dev_commands.ts dispatches the parsed command to the
// hill.ts dev arms (spawnHillNow, riseHillNow, endHillNow, warnNextHillNow).
//
//   /dev hill [zone]                  a risen hill now, the caller on its rim
//   /dev hill warn [zone] [seconds]   a countdown now (full warning by default)
//   /dev hill rise                    skip the countdown of the announced hill
//   /dev hill end                     end the announced or standing hill now
//   /dev hill next                    the real schedule's next hill, warned now

export type HillDevCommand =
  | { kind: 'now'; zoneId?: string }
  | { kind: 'warn'; zoneId?: string; seconds?: number }
  | { kind: 'rise' }
  | { kind: 'end' }
  | { kind: 'next' };

/** The one-line usage the dev log prints for a malformed `/dev hill`. */
export const HILL_DEV_USAGE =
  '[dev] Usage: /dev hill [zone] | /dev hill warn [zone] [seconds] | /dev hill rise | /dev hill end | /dev hill next';

const HILL_DEV_RE = /^\/(?:dev\s+hill|devhill)\b(.*)$/i;
const ZONE_TOKEN = /^[a-z_]+$/;
const SECONDS_TOKEN = /^\d{1,5}$/;

/** Is this chat line a `/dev hill` command at all (valid or not)? */
export function isHillDevCommand(raw: string): boolean {
  return HILL_DEV_RE.test(raw.trim());
}

/** Parse a `/dev hill` line, or null when its arguments are malformed. Zone ids
 *  are returned lowercased and unvalidated (spawnHill refuses an unknown one). */
export function parseHillDevCommand(raw: string): HillDevCommand | null {
  const m = HILL_DEV_RE.exec(raw.trim());
  if (!m) return null;
  const args = m[1].trim().toLowerCase().split(/\s+/).filter(Boolean);
  const [head, ...rest] = args;
  if (head === undefined) return { kind: 'now' };
  if (head === 'rise' || head === 'end' || head === 'next') {
    return rest.length === 0 ? { kind: head } : null;
  }
  if (head === 'warn') {
    let zoneId: string | undefined;
    let seconds: number | undefined;
    for (const arg of rest) {
      if (SECONDS_TOKEN.test(arg) && seconds === undefined) seconds = Math.max(1, Number(arg));
      else if (ZONE_TOKEN.test(arg) && zoneId === undefined) zoneId = arg;
      else return null;
    }
    return { kind: 'warn', zoneId, seconds };
  }
  if (rest.length === 0 && ZONE_TOKEN.test(head)) return { kind: 'now', zoneId: head };
  return null;
}
