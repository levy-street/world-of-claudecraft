import type { MoveInput } from '../sim/types';

export interface OnlineMovementFrameClient {
  setMouselookFacing(facing: number | null): void;
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
  return sampler.advance(client, frameDtSec, mi, facing, now, turnEngageEdge);
}
