// STUB (RFC) — the persistent connection + control loop for one agent.
// Holds the WebSocket to a WoC realm, the WorldMirror, and the 20Hz steering loop (Clock A).
// Actions call setGoal()/cmd(); the LLM (Clock B) is invoked elsewhere by the elizaOS runtime.
// TODO(eliza): extends @elizaos/core Service; register the 'woc' service type via module augmentation.

import type { Goal, ConnectMode } from '../types.js';
import { WorldMirror } from '../lib/worldMirror.js';
import { tick as steer } from '../lib/steering.js';

// import { Service, type IAgentRuntime } from '@elizaos/core';
// declare module '@elizaos/core' { interface ServiceTypeRegistry { woc: WocConnectionService } }

const TICK_MS = 50; // 20 Hz — matches the server loop

export class WocConnectionService /* extends Service */ {
  static serviceType = 'woc' as const;
  capabilityDescription = 'Live connection to a World of Claudecraft realm: world mirror + control loop.';

  world = new WorldMirror();
  private goal: Goal = { kind: 'idle' };
  private mode: ConnectMode = 'player';
  private ws: unknown = null; // WebSocket
  private loop: ReturnType<typeof setInterval> | null = null;

  // static async start(runtime: IAgentRuntime): Promise<WocConnectionService> { ... }

  /** REST auth (or reuse token) -> WS auth -> {hello}, then begin the control loop. */
  async connect(_mode: ConnectMode): Promise<void> {
    // TODO(eliza): wocClient.authWs({ t:'auth', token, character, mode, ownerCharacter? }) -> {hello}
    throw new Error('TODO(eliza): WocConnectionService.connect');
  }

  /** Clock A: 20Hz — drain WS, update mirror, steer toward the current goal. */
  private startControlLoop(): void {
    this.loop = setInterval(() => {
      const self = this.world.self;
      if (!self) return;
      const frame = steer(this.goal, self, (id) => this.world.entities.get(id));
      this.send({ t: 'input', ...frame });
    }, TICK_MS);
  }

  /** Actions set goals; they never emit raw input. */
  setGoal(goal: Goal): void {
    this.goal = goal;
  }

  /** One-shot command forwarded straight to the server's dispatchMessage. */
  cmd(payload: Record<string, unknown>): void {
    this.send({ t: 'cmd', ...payload });
  }

  private send(_obj: Record<string, unknown>): void {
    // TODO(eliza): this.ws.send(JSON.stringify(_obj))
    void this.ws;
  }

  async stop(): Promise<void> {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    // TODO(eliza): close ws
  }
}
