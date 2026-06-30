// Client for the game server's secret-gated /internal/discord/* endpoints. The
// bot reads flex/role data and pushes presence + reward grants; it authenticates
// with the shared DISCORD_BOT_SECRET (x-woc-discord-secret), NOT a user bearer.
import type { ActivityItem, FlexData, RelayItem } from './logic';

interface Envelope<T> {
  success: boolean;
  data: T;
  error: string | null;
}

export interface RolesData {
  linked: boolean;
  statusTier: number;
  points: number;
  lifetimePoints: number;
}

export interface VoiceMemberPush {
  id: string;
  name: string;
  speaking: boolean;
  selfMute: boolean;
}

export class ServerClient {
  constructor(
    private baseUrl: string,
    private secret: string,
  ) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const resp = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'x-woc-discord-secret': this.secret,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      if (!resp.ok) {
        console.error(`[bot] server ${method} ${path} -> ${resp.status}`);
        return null;
      }
      const env = (await resp.json()) as Envelope<T>;
      return env.success ? env.data : null;
    } catch (err) {
      console.error(`[bot] server ${method} ${path} failed`, err);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  flex(discordUserId: string): Promise<(FlexData & { linked: boolean }) | null> {
    return this.call(
      'GET',
      `/internal/discord/flex?discord_user_id=${encodeURIComponent(discordUserId)}`,
    );
  }

  roles(discordUserId: string): Promise<RolesData | null> {
    return this.call(
      'GET',
      `/internal/discord/roles?discord_user_id=${encodeURIComponent(discordUserId)}`,
    );
  }

  pushPresence(snapshot: {
    onlineCount: number;
    memberTotal: number;
    voiceChannelName: string | null;
    voice: VoiceMemberPush[];
  }): Promise<unknown> {
    return this.call('POST', '/internal/discord/presence', snapshot);
  }

  grant(
    discordUserId: string,
    reason: string,
    points: number,
    dedupeKey?: string,
  ): Promise<unknown> {
    return this.call('POST', '/internal/discord/grant', {
      discord_user_id: discordUserId,
      reason,
      points,
      dedupeKey,
    });
  }

  setMember(discordUserId: string, guildMember: boolean): Promise<unknown> {
    return this.call('POST', '/internal/discord/member', {
      discord_user_id: discordUserId,
      guildMember,
    });
  }

  /** Drain queued in-game "!" community posts for delivery to Discord. */
  async drainRelay(): Promise<RelayItem[]> {
    const data = await this.call<{ items: RelayItem[] }>('GET', '/internal/discord/relay');
    return data?.items ?? [];
  }

  /** Drain the significant-activity feed (level-ups, rare drops, duels, arena). */
  async drainActivity(): Promise<ActivityItem[]> {
    const data = await this.call<{ items: ActivityItem[] }>('GET', '/internal/discord/activity');
    return data?.items ?? [];
  }

  /** Push guild metadata (nickname + server join date + top special role). */
  pushMembersMeta(
    members: {
      discord_user_id: string;
      name: string | null;
      joinedAtMs: number | null;
      role: string | null;
    }[],
  ): Promise<unknown> {
    return this.call('POST', '/internal/discord/members-meta', { members });
  }
}
