// First-time Discord login chooser persistence (moved out of src/main.ts by
// the monolith ratchet; the #discord-choice-panel chooser consumes it).

// ── First-time Discord login chooser persistence (#discord-choice-panel) ─────
// The OAuth bounce page parks a single-use link token + Discord name here when a
// first-time login has no account yet; main.ts reads it on boot to show the
// chooser. Stale/expired/garbled entries are cleared so they never trap a visitor.
export const DISCORD_CHOICE_KEY = 'woc_discord_choice';
const DISCORD_CHOICE_TTL_MS = 15 * 60 * 1000;

export interface ExternalAuthLoginChoice {
  provider: 'apple' | 'discord';
  linkToken: string;
  username: string;
}

export function readDiscordChoice(): ExternalAuthLoginChoice | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(DISCORD_CHOICE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as {
      linkToken?: unknown;
      username?: unknown;
      ts?: unknown;
    };
    const fresh = typeof d.ts === 'number' && Date.now() - d.ts < DISCORD_CHOICE_TTL_MS;
    if (typeof d.linkToken === 'string' && d.linkToken && fresh) {
      return {
        provider: 'discord',
        linkToken: d.linkToken,
        username: typeof d.username === 'string' ? d.username : '',
      };
    }
  } catch {
    /* fall through to clear a garbled entry */
  }
  clearDiscordChoice();
  return null;
}

export function clearDiscordChoice(): void {
  try {
    localStorage.removeItem(DISCORD_CHOICE_KEY);
  } catch {
    /* storage disabled */
  }
}
