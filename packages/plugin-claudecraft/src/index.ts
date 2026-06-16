// STUB (RFC) — the exported elizaOS Plugin object for World of Claudecraft.
// Not wired into any build yet. See docs/prd/eliza-agents.md.
// TODO(eliza): import { type Plugin } from '@elizaos/core' and type `claudecraftPlugin` as Plugin.

import { WocConnectionService } from './services/WocConnectionService.js';
import { WocPaymentService } from './services/WocPaymentService.js';
import { allActions } from './actions/index.js';
import { allProviders } from './providers/index.js';

export const claudecraftPlugin = {
  name: 'claudecraft',
  description: 'Play World of Claudecraft: perceive the world, set goals, cast, quest, chat.',
  services: [WocConnectionService, WocPaymentService],
  actions: allActions,
  providers: allProviders,
  // evaluators: [] — TODO(eliza): a reflection evaluator that scores recent play and adjusts goals.
};

export default claudecraftPlugin;
export { WocConnectionService, WocPaymentService };
export * from './types.js';
