import type { ProceduralLegendaryPowerId } from './procedural_legendary_powers';

// A signature source is deliberately strong but never exclusive. One fixed
// selection draw chooses the signature branch 80% of the time and the global
// compatible branch 20% of the time, preserving deterministic draw counts.
export const PROCEDURAL_LEGENDARY_SIGNATURE_SHARE = 0.8;

export const PROCEDURAL_BOSS_LEGENDARY_SIGNATURES = {
  deacon_varric: ['bell_of_the_ninth_peal'],
  morthen: ['greyjaws_edge'],
  vael_the_mistcaller: ['hushwood_longbow', 'boots_of_the_unbroken_road'],
  sister_nhalia_drowned_canticle: ['nightglass_fang', 'mantle_of_borrowed_time'],
  ysolei: ['ysoleis_vigil', 'stormwake_idol'],
  korzul_the_gravewyrm: ['crown_last_pyre', 'ashbinders_seal'],
  nythraxis_scourge_of_thornpeak: ['dawnward_signet', 'feral_moonclasp'],
} as const satisfies Readonly<Record<string, readonly ProceduralLegendaryPowerId[]>>;

const NO_SIGNATURES = Object.freeze([]) as readonly ProceduralLegendaryPowerId[];

export function proceduralBossLegendarySignatures(
  sourceTemplateId: string | undefined,
): readonly ProceduralLegendaryPowerId[] {
  if (!sourceTemplateId) return NO_SIGNATURES;
  return (
    PROCEDURAL_BOSS_LEGENDARY_SIGNATURES[
      sourceTemplateId as keyof typeof PROCEDURAL_BOSS_LEGENDARY_SIGNATURES
    ] ?? NO_SIGNATURES
  );
}
