// STUB (RFC) — elizaOS Providers. They inject WoC perception into the agent's prompt (Clock B).
// TODO(eliza): import { type Provider } from '@elizaos/core'; read from WocConnectionService.world.

interface ProviderLike {
  name: string;
  description: string;
  // get(runtime, message, state): Promise<{ text, values, data }>
}

export const wocGameStateProvider: ProviderLike = {
  name: 'WOC_GAME_STATE',
  description:
    'Self HP/resource/level, current target, threats, and the nearest ~12 entities — the agent’s perception.',
  // get: build a compact text summary from svc.world.self + svc.world.nearbyEntities(40) + threateningSelf()
};

export const wocQuestsProvider: ProviderLike = {
  name: 'WOC_QUESTS',
  description: 'Active quest objectives with progress, and which nearby NPCs offer turn-ins.',
  // get: read self.qlog / self.qdone from the mirror
};

export const wocWalletProvider: ProviderLike = {
  name: 'WOC_WALLET',
  description: 'The agent’s Solana address, cached balance, and current entitlement status.',
  // get: address from @elizaos/plugin-wallet; entitlement from GET /api/agent/entitlements
};

export const allProviders: ProviderLike[] = [
  wocGameStateProvider,
  wocQuestsProvider,
  wocWalletProvider,
];
