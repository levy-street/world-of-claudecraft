// STUB (RFC) — one elizaOS runtime + its WocConnectionService, supervised.
// Builds the character (with the provisioned wallet secret), registers @woc/plugin-claudecraft +
// @elizaos/plugin-wallet, runs the payment handshake, then connects the WS and begins play.
// TODO(eliza): import { AgentRuntime } from '@elizaos/core'.

import type { AgentRecord } from './AgentManager.js';

export class AgentHost {
  // private runtime: AgentRuntime;
  constructor(private readonly record: AgentRecord) {}

  async start(): Promise<void> {
    // const character = {
    //   name, system, bio,
    //   plugins: ['@woc/plugin-claudecraft', '@elizaos/plugin-wallet'],
    //   secrets: { SOLANA_PRIVATE_KEY: <from SecretVault> },
    //   settings: { WOC_SERVER_URL, WOC_PAY_RECIPIENT, WOC_PAY_CLUSTER },
    // };
    // this.runtime = new AgentRuntime({ character, plugins: [...] });
    // await this.runtime.initialize();
    // const svc = this.runtime.getService('woc'); await svc.connect(this.record.mode);
    void this.record;
    throw new Error('TODO(eliza): AgentHost.start');
  }

  async stop(): Promise<void> {
    // await this.runtime?.stop();
  }
}
