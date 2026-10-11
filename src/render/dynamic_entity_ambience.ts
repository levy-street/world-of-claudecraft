import type { Entity } from '../sim/types';
import type { AmbientPointSource } from './audio_sink';
import { HoardAmbienceSources } from './hoard_ambience';
import { RiftAmbienceSources } from './rift_ambience';

/** Compose distinct world sound identities without changing the rift collector. */
export class DynamicEntityAmbienceSources {
  private readonly rifts = new RiftAmbienceSources();
  private readonly hoards = new HoardAmbienceSources();
  private readonly scratch: AmbientPointSource[] = [];

  collect(
    world: { entities: ReadonlyMap<number, Entity>; entityRosterVersion: number },
    playerX: number,
    out: AmbientPointSource[],
  ): void {
    this.rifts.collect(world, playerX, out);
    this.hoards.collect(world, this.scratch);
    for (const source of this.scratch) out.push(source);
  }
}
