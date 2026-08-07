// Streetlamp emission is AUTHORED IN THE GLB, not inferred at runtime.
//
// Each fixture carries two named materials beside its untouched housing
// material: `LAMP_GLASS` (the pane/crystal shell, alpha-blended, faintly
// emissive) and `LAMP_SOURCE` (the flame, bulb, crystal core or wisp inside
// it, fully emissive). Every fixture's emissive factor was normalized to a
// constant Rec.709 luminance when it was authored, so a purple crystal and an
// amber pane read as equally lit; this module only scales what is already
// there, which is why one gain per role holds across all fourteen styles.
//
// This replaces a runtime heuristic that guessed which pixels were "the light"
// from texture colour affinity and a hand-tuned box around a per-model socket.
// It could not tell a lantern pane from a ghost rag painted the same teal, it
// needed a per-model volume and surface bias to suppress the housing, and it
// varied lamp to lamp exactly where it most needed to be uniform. The authored
// material split answers the same question exactly, in the asset.
import type * as THREE from 'three';

/** Authored material names; the loader classifies purely on these. */
export const LAMP_GLASS_MATERIAL = 'LAMP_GLASS';
export const LAMP_SOURCE_MATERIAL = 'LAMP_SOURCE';
/** A modelled or authored fire, animated at runtime by streetlamp_flame.ts. */
export const LAMP_FLAME_MATERIAL = 'LAMP_FLAME';

export type StreetlampEmissiveRole = 'glass' | 'source' | 'flame';

/**
 * Runtime gain per role, applied on top of the authored emissive factor.
 *
 * These are calibrated against the composer, not chosen by eye. Bloom is a
 * high-pass at BLOOM_THRESHOLD = 1.32 luma in linear HDR, and the tonemap is
 * ACES, which DESATURATES as it compresses: drive a warm emissive far past the
 * knee and every channel saturates, so the "hot amber flame" renders as a white
 * blob with a warm rim. That is exactly what a first pass at gain 7.5 did.
 *
 * So the emitter sits above the bloom knee (authored ~0.46 luma times 5.0 lands
 * near 2.3) where it blooms warm but keeps its hue, and the glass sits
 * deliberately just BELOW it (~1.1) so a pane glows without the housing washing
 * out. Both were stepped up once from 4.0 / 1.6 (near 1.8 and 0.73): the
 * lantern read as a lit shape rather than as the thing lighting the road, and
 * the headroom is there, since the pass that washed out to white was 7.5
 * (near 3.5), well above where these now sit.
 */
const ROLE_GAIN: Readonly<Record<StreetlampEmissiveRole, number>> = {
  glass: 2.4,
  source: 5.0,
  flame: 5.0,
};

export interface StreetlampEmissiveState {
  readonly role: StreetlampEmissiveRole;
  /** emissiveIntensity at full glow, authored intensity times the role gain. */
  readonly litIntensity: number;
  readonly material: THREE.Material & { emissiveIntensity: number };
}

/** The authored role of a material, or null when it is ordinary housing. */
export function streetlampEmissiveRole(name: string): StreetlampEmissiveRole | null {
  if (name === LAMP_SOURCE_MATERIAL) return 'source';
  if (name === LAMP_FLAME_MATERIAL) return 'flame';
  if (name === LAMP_GLASS_MATERIAL) return 'glass';
  return null;
}

/**
 * Bind a converted material to its authored role. Returns null for housing, so
 * a post, roof or frame can never be driven emissive by accident.
 */
export function captureStreetlampEmissive(
  sourceName: string,
  material: THREE.Material & { emissiveIntensity: number },
): StreetlampEmissiveState | null {
  const role = streetlampEmissiveRole(sourceName);
  if (!role) return null;
  // The authored intensity is whatever the GLB declared (1 unless the asset
  // carries KHR_materials_emissive_strength); read it BEFORE the first frame
  // drives it, because from then on the field holds our scaled value.
  const authored = Number.isFinite(material.emissiveIntensity) ? material.emissiveIntensity : 1;
  const state: StreetlampEmissiveState = {
    role,
    litIntensity: Math.max(authored, 0) * ROLE_GAIN[role],
    material,
  };
  material.emissiveIntensity = 0;
  return state;
}

/** Drive one authored emitter from the frame's lamp glow (0 = out, 1 = full). */
export function updateStreetlampEmissive(state: StreetlampEmissiveState, glow: number): void {
  state.material.emissiveIntensity = state.litIntensity * Math.max(glow, 0);
}

export const streetlampEmissiveInternalsForTest = {
  roleGain: ROLE_GAIN,
};
