// Public surface of the per-ability spell VFX subsystem. The renderer
// constructs AbilityVfxFx (the Three-side pooled primitive engine) and
// AbilityVfx (the spec-driven painter that decides what to draw), wires them
// together, and forwards events plus the per-frame entity sync. Everything
// else in this directory is internal.
export { AbilityVfxFx } from './fx';
export {
  AbilityVfx,
  type AbilityVfxAuraEvent,
  type AbilityVfxDamageEvent,
  type AbilityVfxDeps,
  type AbilityVfxEntityState,
  type AbilityVfxPrimitives,
  type AbilityVfxSpellfxEvent,
  type AbilityVfxStat,
} from './painter';
export {
  type AbilityVfxCompileTarget,
  type AbilityVfxPrewarmTextureStep,
  abilityVfxTexturePrewarmSteps,
  collectAbilityVfxCompileTargets,
} from './prewarm';
