export const WARRIOR_SHOUT_COLORS = {
  battle_shout: 0xff2a1a,
  demoralizing_shout: 0x9a5df0,
  emboldening_roar: 0xff5470,
  defiant_bellow: 0xff8c2a,
  rallying_cry: 0xffe9a0,
  intimidating_shout: 0x7f8ad0,
} as const;

export type WarriorCastVisualPlan =
  // A shout = a coloured ground shockwave PLUS the ability's dedicated gesture
  // clip (Battlecry, via attackByAbility) played once. NOT an emote: emotes are
  // reserved for actual emoting. A rig without the clip just shows the shockwave.
  | { kind: 'shout'; color: number; ringRadius: 8; abilityId: string | undefined }
  | { kind: 'gesture'; abilityId: string };

export function warriorCastVisualPlan(
  fx: string,
  abilityId?: string,
): WarriorCastVisualPlan | null {
  if (fx === 'shout') {
    return {
      kind: 'shout',
      color: WARRIOR_SHOUT_COLORS[abilityId as keyof typeof WARRIOR_SHOUT_COLORS] ?? 0xff3220,
      ringRadius: 8,
      abilityId,
    };
  }
  // 'gesture' is the generic dedicated-clip cue (any class); 'weaponAura'/'flourish'
  // are the warrior aura/guard cues. All resolve to the ability's attackByAbility
  // clip, played once or not at all (playGesture, never a fallback swing).
  if ((fx === 'gesture' || fx === 'weaponAura' || fx === 'flourish') && abilityId) {
    return { kind: 'gesture', abilityId };
  }
  return null;
}
