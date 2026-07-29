// Which per-ability audio moments a hand-recorded studio cue already carries.
//
// Two independent systems sound the same instant. The older one is the recorded
// cue pack: src/ui/combat_sfx.ts resolves a key per sim event and hud.ts plays
// it (proj_<school> at the caster when a spell launches, impact_<school> or a
// material impact where it lands, combat_crit on a crit, heal_impact,
// buff_apply). Those keys are Jamie's studio recordings, marked `custom: true`
// in scripts/sfx/sfx_prompts.mjs. The newer one is the ability-VFX engine's
// procedural layer (sfx.ts abilityAudio), which fires release/impact moments
// from src/render/ability_vfx/sequencer.ts for all 294 spec'd abilities.
//
// They were never reconciled, so a Fireball played the recording AND a
// synthetic whoosh + boom on top of it, at the same instant and position. The
// synth masked the recordings rather than replacing them. This module is the
// reconciliation: the procedural layer asks first, and stays silent wherever a
// recording already speaks. It keeps its voice only where no recording exists,
// which is what the VFX work genuinely adds.
//
// Pure and host-agnostic on purpose (no DOM, no AudioContext, no sim import):
// the caller resolves the ability's school and archetype and passes them in.

/** The moments src/render/audio_sink.ts can ask the audio engine for. */
export type AbilityAudioMoment =
  | 'windup'
  | 'release'
  | 'impact'
  | 'pulse'
  | 'crit'
  | 'spirit'
  | 'motif';

export interface AbilityMomentContext {
  /** ABILITIES[id].school: the six magic schools or 'physical'. */
  school?: string;
  /** The VFX spec archetype (ability_vfx_core.ts AbilityVfxArchetype). */
  archetype?: string;
  /** ABILITIES[id].projectile. Every non-physical spell is a projectile by
   *  convention (types.ts AbilityDef.projectile, keyed off school in
   *  casting_lifecycle), so omitting this means "follows the convention".
   *  Pass `false` for the explicit opt-outs (Fire Blast resolves instantly at
   *  cast completion): those emit no projectile spellfx, so no proj_ recording
   *  sounds and the procedural whoosh must keep carrying their launch. */
  isProjectile?: boolean;
  /** The casting ability's id, needed only for the narrow per-ability
   *  overrides below (FEAR_IMPACT_ABILITIES); every other check reads purely
   *  off school/archetype. */
  abilityId?: string;
}

/** The fear-family abilities whose landed-fear moment now has a dedicated
 *  recording (the 'fear' cue, effect_dispatch.ts's fx:'fearImpact'), even
 *  though their archetype is 'cc' (normally uncovered, see
 *  RECORDED_IMPACT_ARCHETYPES): Harrow (single-target), plus the three AoE
 *  fear shouts (Terror Canticle, Dread Chorus, Intimidating Shout, archetype
 *  'shout', also normally uncovered). */
export const FEAR_IMPACT_ABILITIES: ReadonlySet<string> = new Set([
  'fear',
  'psychic_scream',
  'howl_of_terror',
  'intimidating_shout',
]);

/** Plain (non-fear) cc abilities whose landed moment now has a dedicated
 *  recording (fx:'ccImpact'): Sundering Gavel/hammer_of_justice (stun),
 *  Gripping Roots/entangling_roots (root), Dirt Toss/blind (incapacitate),
 *  Gut Punch/cheap_shot (stun, the stealth opener). All four are archetype
 *  'cc' (normally uncovered). */
export const CC_IMPACT_ABILITIES: ReadonlySet<string> = new Set([
  'hammer_of_justice',
  'entangling_roots',
  'blind',
  'cheap_shot',
  'sap',
]);

/** The six schools with a recorded launch whoosh (combat_sfx.ts SCHOOL_CUES
 *  .projectile: proj_fire, proj_frost, proj_arcane, proj_shadow, proj_holy,
 *  proj_nature). There is deliberately no 'physical' member: a physical
 *  projectile plays melee_bow, and a physical melee ability launches nothing,
 *  so its release moment has no recording to collide with. */
export const RECORDED_PROJECTILE_SCHOOLS: ReadonlySet<string> = new Set([
  'fire',
  'frost',
  'arcane',
  'shadow',
  'holy',
  'nature',
]);

/** Archetypes whose landing moment a recording already carries.
 *  - The six damage-landers (bolt, burst, strike, nova, beam, dot) always
 *    resolve one: impactCueForDamage returns impact_<school> for a magic
 *    school and a material impact (impact_flesh/metal/leather/bone) for
 *    physical or schoolless damage, so there is no uncovered damage case.
 *  - heal lands heal_impact, buff lands buff_apply.
 *  Deliberately absent: 'cc' (debuff_apply plays only for your OWN debuffs,
 *  hud.ts returns early for any other target, so an enemy cc lands on
 *  nothing recorded), plus 'summon', 'shout' and 'dash', which deal no damage
 *  and so fire no impact cue at all. Those four keep their procedural read. */
export const RECORDED_IMPACT_ARCHETYPES: ReadonlySet<string> = new Set([
  'bolt',
  'burst',
  'strike',
  'nova',
  'beam',
  'dot',
  'heal',
  'buff',
]);

/** True when a hand-recorded cue already sounds this moment, so the procedural
 *  ability layer must stay silent rather than double it. */
export function isAbilityMomentRecorded(
  moment: AbilityAudioMoment,
  ctx: AbilityMomentContext,
): boolean {
  switch (moment) {
    // proj_<school> fires from the spellfx projectile event at the caster, the
    // same instant and position the sequencer asks for its release whoosh.
    // No projectile event means no recording, hence the opt-out check.
    case 'release':
      return (
        ctx.isProjectile !== false && !!ctx.school && RECORDED_PROJECTILE_SCHOOLS.has(ctx.school)
      );
    case 'impact':
      // The per-ability overrides win regardless of archetype: Harrow's is
      // 'cc', the fear shouts' is 'shout', the plain cc trio's is 'cc' too
      // (all normally uncovered), and all now have a real recording for
      // this moment (see FEAR_IMPACT_ABILITIES / CC_IMPACT_ABILITIES).
      if (ctx.abilityId && FEAR_IMPACT_ABILITIES.has(ctx.abilityId)) return true;
      if (ctx.abilityId && CC_IMPACT_ABILITIES.has(ctx.abilityId)) return true;
      return !!ctx.archetype && RECORDED_IMPACT_ARCHETYPES.has(ctx.archetype);
    // combat_crit is a recording and plays on every crit against a non-boss.
    // A boss is exempt by design (a crit sting is the wrong beat mid-boss
    // fight, see shouldPlayCritSfxForTarget), and staying silent here honors
    // that intent instead of sneaking a synthetic sting back in.
    case 'crit':
      return true;
    // No recording covers a cast-windup bed, a zone re-hit pulse, a creature
    // apparition call, or set-piece motif foley: these are what the ability
    // VFX work actually adds, so they keep their procedural voice.
    default:
      return false;
  }
}
