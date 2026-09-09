import type { IWorld } from '../world_api';
import {
  decodeBlizzards,
  decodeConsecrations,
  decodeFrostRings,
  decodeHunterTraps,
  decodeIgnivarMeteors,
  decodeRunesOfPower,
  decodeTemporalHourglasses,
  decodeVarkhulForgestormWarnings,
} from './ground_telegraph_wire';
import { decodeVarkhulAnvilMeteors, decodeVarkhulAssemblies } from './varkhul_assembly_wire';
import {
  decodeVarkhulCinderFires,
  decodeVarkhulCinderOrbProjectiles,
} from './varkhul_cinder_orb_wire';

type GroundTarget = Pick<
  IWorld,
  | 'activeBlizzards'
  | 'activeFrostRings'
  | 'activeHunterTraps'
  | 'activeIgnivarMeteors'
  | 'activeVarkhulForgestormWarnings'
  | 'activeVarkhulCinderFires'
  | 'activeVarkhulCinderOrbProjectiles'
  | 'activeVarkhulAnvilMeteors'
  | 'activeVarkhulAssemblies'
  | 'activeTemporalHourglasses'
  | 'activeRunesOfPower'
  | 'activeConsecrations'
>;
type GroundSnapshot = {
  blizzards?: unknown;
  rings?: unknown;
  hunterTraps?: unknown;
  ignivarMeteors?: unknown;
  varkhulForgestorm?: unknown;
  varkhulCinderFires?: unknown;
  varkhulCinderOrbs?: unknown;
  varkhulAnvilMeteors?: unknown;
  varkhulAssemblies?: unknown;
  hourglasses?: unknown;
  runesOfPower?: unknown;
  consecrations?: unknown;
};

/** Replace every persistent field, including absent arrays, through strict wire decoders. */
export function applyGroundTelegraphSnapshot(target: GroundTarget, snap: GroundSnapshot): void {
  target.activeBlizzards = decodeBlizzards(snap.blizzards);
  target.activeFrostRings = decodeFrostRings(snap.rings);
  target.activeHunterTraps = decodeHunterTraps(snap.hunterTraps);
  target.activeIgnivarMeteors = decodeIgnivarMeteors(snap.ignivarMeteors);
  target.activeVarkhulForgestormWarnings = decodeVarkhulForgestormWarnings(snap.varkhulForgestorm);
  target.activeVarkhulCinderFires = decodeVarkhulCinderFires(snap.varkhulCinderFires);
  target.activeVarkhulCinderOrbProjectiles = decodeVarkhulCinderOrbProjectiles(
    snap.varkhulCinderOrbs,
  );
  target.activeVarkhulAnvilMeteors = decodeVarkhulAnvilMeteors(snap.varkhulAnvilMeteors);
  target.activeVarkhulAssemblies = decodeVarkhulAssemblies(snap.varkhulAssemblies);
  target.activeTemporalHourglasses = decodeTemporalHourglasses(snap.hourglasses);
  target.activeRunesOfPower = decodeRunesOfPower(snap.runesOfPower);
  target.activeConsecrations = decodeConsecrations(snap.consecrations);
}
