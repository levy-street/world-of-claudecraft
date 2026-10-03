// A standing body whose idle is replaced while it is stunned (ClipMap.stunned).
//
// The Fanglord's Great Jaguar is the reference: its control windows (a stun lands,
// then the jaguar shrugs off stuns for a while) are a mechanic the group plays
// around, so a stunned jaguar must LOOK stunned, head hanging and legs splayed,
// not stand in its alert idle. Any stun counts, whatever ability laid it: the
// aura KIND is the fact, never an id list. The base machine keeps its states (a
// stunned body does not walk, swing or cast anyway); only the clip the idle
// states resolve to changes while the stun holds.
//
// Data, not a jaguar branch: another creature earns a dazed loop by naming one.
// Node-only (RENDER_PURE_CORES): no three.js, no DOM.

/** The aura facts this reads: a structural subset of a sim `Aura`. */
export interface StunAuraFact {
  kind?: string;
  remaining?: number;
}

/** The aura kinds that hold a body dazed in place. */
const DAZED_KINDS: ReadonlySet<string> = new Set(['stun', 'incapacitate']);

/**
 * The dazed loop to hold, or null for the rig's ordinary idle. Allocation-free:
 * this runs once per rig per frame.
 */
export function stunIdleClip(
  clip: string | undefined,
  auras: readonly StunAuraFact[] | undefined,
): string | null {
  if (!clip || !auras || auras.length === 0) return null;
  for (let i = 0; i < auras.length; i++) {
    const a = auras[i];
    if (a.kind && DAZED_KINDS.has(a.kind) && (a.remaining ?? 1) > 0) return clip;
  }
  return null;
}
