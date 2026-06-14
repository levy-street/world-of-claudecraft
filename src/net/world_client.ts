import type { SimEvent } from '../sim/types';
import type { IWorld } from '../world_api';

// Shared shape for online world mirrors. ClientWorld speaks the Node websocket
// protocol today; SpacetimeWorld will use SpacetimeDB subscriptions/reducers.
export interface OnlineWorldClient extends IWorld {
  readonly characterId: number;
  connected: boolean;
  onDisconnect: ((reason: string) => void) | null;
  lastSnapAt: number;
  snapInterval: number;
  pendingFacingDelta: number;
  close(): void;
  drainEvents(): SimEvent[];
  setMouselookFacing(facing: number | null): void;
  consumeInventoryChanged(): boolean;
}
