import type { MoveInput } from '../sim/types';

export interface OnlineMovementFrameClient {
  movementWireVersion: 1 | 2;
  setMouselookFacing(facing: number | null): void;
  flushInput(now: number): boolean;
}

export interface MovementFrameSampler<Client> {
  advance(
    client: Client,
    frameDtSec: number,
    mi: MoveInput,
    facing: number | null,
    now: number,
    turnEngageEdge: boolean,
  ): boolean;
}

export function sendOnlineMovementFrame<Client>(
  client: Client & OnlineMovementFrameClient,
  sampler: MovementFrameSampler<Client>,
  frameDtSec: number,
  mi: MoveInput,
  facing: number | null,
  now: number,
  turnEngageEdge: boolean,
): boolean {
  client.setMouselookFacing(facing);
  const legacyEmitted = client.movementWireVersion !== 2 && client.flushInput(now);
  return sampler.advance(client, frameDtSec, mi, facing, now, turnEngageEdge) || legacyEmitted;
}
