// Thin Discord REST client (bot-token authed). Just the calls the bot needs:
// gateway URL, slash-command registration, interaction responses, guild roles +
// member role edits, and posting messages. Naive about rate limits (low volume):
// on a 429 it waits the returned retry_after once and retries.

const API = 'https://discord.com/api/v10';

export class DiscordApi {
  constructor(private token: string) {}

  private async request(
    method: string,
    path: string,
    body?: unknown,
    retry = true,
  ): Promise<unknown> {
    const resp = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bot ${this.token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'WorldOfClaudeCraftBot (https://worldofclaudecraft.com, 1.0)',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (resp.status === 429 && retry) {
      const data = (await resp.json().catch(() => ({}))) as { retry_after?: number };
      const waitMs = Math.min(10_000, Math.max(500, (data.retry_after ?? 1) * 1000));
      await new Promise((r) => setTimeout(r, waitMs));
      return this.request(method, path, body, false);
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`[bot] discord ${method} ${path} -> ${resp.status} ${text.slice(0, 200)}`);
    }
    if (resp.status === 204) return null;
    return resp.json().catch(() => null);
  }

  async gatewayUrl(): Promise<string> {
    const data = (await this.request('GET', '/gateway/bot')) as { url?: string };
    return data?.url || 'wss://gateway.discord.gg';
  }

  async registerGuildCommands(
    clientId: string,
    guildId: string,
    commands: unknown[],
  ): Promise<void> {
    await this.request('PUT', `/applications/${clientId}/guilds/${guildId}/commands`, commands);
  }

  // Acknowledge + reply to a slash command (type 4 = channel message with source).
  async respondInteraction(
    interactionId: string,
    interactionToken: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.request('POST', `/interactions/${interactionId}/${interactionToken}/callback`, {
      type: 4,
      data,
    });
  }

  // Defer a slash command (type 5 = "Bot is thinking..."), buying up to 15 minutes
  // to produce the real reply. Used for commands that hit the game server first, so
  // a slow round-trip never blows Discord's 3-second initial-response deadline.
  async deferInteraction(
    interactionId: string,
    interactionToken: string,
    ephemeral: boolean,
  ): Promise<void> {
    await this.request('POST', `/interactions/${interactionId}/${interactionToken}/callback`, {
      type: 5,
      data: ephemeral ? { flags: 64 } : {},
    });
  }

  // Edit the deferred response with the real content (webhook on the app id).
  async editOriginalResponse(
    appId: string,
    interactionToken: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.request('PATCH', `/webhooks/${appId}/${interactionToken}/messages/@original`, data);
  }

  async guildRoles(guildId: string): Promise<{ id: string; name: string }[]> {
    const roles = (await this.request('GET', `/guilds/${guildId}/roles`)) as
      | { id: string; name: string }[]
      | null;
    return Array.isArray(roles) ? roles : [];
  }

  // Create a guild role (needs MANAGE_ROLES). `color` is a 24-bit RGB int (0 =
  // no color). Used to auto-provision the WoC status-tier roles on boot.
  async createGuildRole(
    guildId: string,
    name: string,
    color = 0,
  ): Promise<{ id: string; name: string }> {
    return (await this.request('POST', `/guilds/${guildId}/roles`, {
      name,
      color,
      mentionable: false,
      hoist: false,
    })) as { id: string; name: string };
  }

  async addMemberRole(guildId: string, userId: string, roleId: string): Promise<void> {
    await this.request('PUT', `/guilds/${guildId}/members/${userId}/roles/${roleId}`);
  }

  async removeMemberRole(guildId: string, userId: string, roleId: string): Promise<void> {
    await this.request('DELETE', `/guilds/${guildId}/members/${userId}/roles/${roleId}`);
  }

  // Set a member's server nickname (needs MANAGE_NICKNAMES; cannot rename the
  // guild owner). Used to attach the in-game level to their Discord name.
  async setNickname(guildId: string, userId: string, nick: string): Promise<void> {
    await this.request('PATCH', `/guilds/${guildId}/members/${userId}`, { nick });
  }

  async createMessage(channelId: string, payload: Record<string, unknown>): Promise<void> {
    await this.request('POST', `/channels/${channelId}/messages`, payload);
  }
}
