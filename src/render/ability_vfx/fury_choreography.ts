import { harvestBeat } from './harvest_choreography';
import type { SeqSlot, SequencerHost } from './sequencer';
import { twinstrikeBeat } from './twinstrike_choreography';

/** Each Fury signature owns its collision assembly; the physical sequencer
 * remains the authority for component timing and retirement. */
export function furyBeat(host: SequencerHost, slot: SeqSlot, beat: number): boolean {
  return harvestBeat(host, slot, beat) || twinstrikeBeat(host, slot, beat);
}
