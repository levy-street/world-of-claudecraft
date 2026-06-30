// Bot configuration from env. All secrets are server-side env only (never
// committed). Missing-required values throw at boot with a clear message.

export interface BotConfig {
  /** Discord bot token (Bot <token>). */
  token: string;
  /** Discord application (client) id, for slash-command registration. */
  clientId: string;
  /** The official guild id the bot operates in. */
  guildId: string;
  /** Base URL of the game server (for /internal/discord/* calls). */
  gameServerUrl: string;
  /** Shared secret matching the server's DISCORD_BOT_SECRET. */
  botSecret: string;
  /** Featured voice channel id surfaced in the game HUD (optional). */
  voiceChannelId: string;
  /** Channel id for welcome messages on member join (optional). */
  welcomeChannelId: string;
  /** Channel id for a startup "bot online" announcement / test posts (optional). */
  testChannelId: string;
  /** Channel id the in-game "!" community posts (LFG etc.) are delivered to. */
  relayChannelId: string;
  /** Channel id the significant-activity feed (level-ups, drops, ...) posts to. */
  activityChannelId: string;
  /** Public game URL shown in bot replies. */
  gameUrl: string;
  /** Sync each linked member's Discord nickname to include their in-game level. */
  syncNicknames: boolean;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[bot] missing required env ${name}`);
  return v;
}

export function loadConfig(): BotConfig {
  return {
    token: required('DISCORD_BOT_TOKEN'),
    clientId: required('DISCORD_CLIENT_ID'),
    guildId: required('DISCORD_GUILD_ID'),
    gameServerUrl: process.env.GAME_SERVER_URL || 'http://127.0.0.1:8787',
    botSecret: required('DISCORD_BOT_SECRET'),
    voiceChannelId: process.env.DISCORD_VOICE_CHANNEL_ID || '',
    welcomeChannelId: process.env.DISCORD_WELCOME_CHANNEL_ID || '',
    testChannelId: process.env.DISCORD_TEST_CHANNEL_ID || '',
    // Relay posts default to the test/announce channel when not set separately.
    relayChannelId:
      process.env.DISCORD_RELAY_CHANNEL_ID || process.env.DISCORD_TEST_CHANNEL_ID || '',
    // Activity feed defaults to the relay channel (then test) when not set.
    activityChannelId:
      process.env.DISCORD_ACTIVITY_CHANNEL_ID ||
      process.env.DISCORD_RELAY_CHANNEL_ID ||
      process.env.DISCORD_TEST_CHANNEL_ID ||
      '',
    gameUrl: process.env.PUBLIC_GAME_URL || 'https://worldofclaudecraft.com',
    syncNicknames: process.env.DISCORD_SYNC_NICKNAMES !== '0',
  };
}
