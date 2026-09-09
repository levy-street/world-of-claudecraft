// Public surface of the aura-tracks HUD domain: the derived catalog, the six
// track descriptors, the shared selection core and its painter. The Hud composes
// one view + one painter per descriptor and owns the container ids.

export {
  AURA_TRACK_CATALOG,
  AURA_TRACK_DURATION_CEILING_SEC,
  type AuraTrackCategory,
  type AuraTrackEntry,
  type AuraTrackRowShape,
  auraTrackEntry,
  DEFENSIVE_COOLDOWN_SEC,
} from './aura_track_catalog';
export {
  AURA_TRACK_FRAME_PREFIX,
  AURA_TRACKS,
  type AuraTrackDescriptor,
  type AuraTrackSettingKey,
  auraTrackDescriptor,
  auraTrackForFrameId,
} from './aura_track_descriptors';
export {
  AuraTrackFamily,
  type AuraTrackHostDeps,
  type ComposedAuraTrack,
} from './aura_track_host';
export { AuraTrackPainter, type AuraTrackPainterDeps } from './aura_track_painter';
export {
  AURA_TRACK_DECIMAL_BELOW_SEC,
  AURA_TRACK_ROW_CAP,
  type AuraTrackAuraInput,
  type AuraTrackDeps,
  type AuraTrackEntityInput,
  type AuraTrackInput,
  type AuraTrackRow,
  type AuraTrackState,
  type AuraTrackViewCore,
  createAuraTrackView,
} from './aura_track_view';
