// STUB (RFC) — lifecycle state machine across all hosted agents.
// created -> entitled -> playing -> idle -> stopped. Bounds LLM fan-out with a concurrency cap.
// TODO(eliza): persistence of AgentRecord rows; horizontal sharding by agentId hash.

import { AgentHost } from './AgentHost.js';

export interface BridgeConfig {
  wocServerUrl: string;
  payCluster: string;
  skipPayment: boolean;
}

export type AgentState = 'created' | 'entitled' | 'playing' | 'idle' | 'stopped' | 'blocked';

export interface AgentRecord {
  id: string;
  characterId: number; // WoC character id
  wocToken: string; // bearer token for REST + WS
  address: string; // Solana pubkey
  mode: 'player' | 'familiar';
  ownerPid?: number; // familiar: the human player's pid to assist
  state: AgentState;
}

export class AgentManager {
  private hosts = new Map<string, AgentHost>();

  constructor(private readonly cfg: BridgeConfig) {}

  async start(): Promise<void> {
    // TODO(eliza): load roster -> for each: provision wallet -> pay/entitle -> AgentHost.start
    void this.cfg;
    throw new Error('TODO(eliza): AgentManager.start');
  }

  async createAgent(_spec: Partial<AgentRecord>): Promise<AgentRecord> {
    throw new Error('TODO(eliza): AgentManager.createAgent');
  }

  async stop(_id: string): Promise<void> {
    throw new Error('TODO(eliza): AgentManager.stop');
  }

  async stopAll(): Promise<void> {
    for (const host of this.hosts.values()) await host.stop();
    this.hosts.clear();
  }
}
