export const WARRIOR_SHOUT_COLORS = {
  battle_shout: 0xff2a1a,
  demoralizing_shout: 0x9a5df0,
  emboldening_roar: 0xff5470,
  defiant_bellow: 0xff8c2a,
  rallying_cry: 0xffe9a0,
  intimidating_shout: 0x7f8ad0,
} as const;

export type WarriorCastVisualPlan =
  | {
      kind: 'shout';
      color: number;
      ringRadius: 8;
      emote: 'cheer';
      repeats: 1;
    }
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
      emote: 'cheer',
      repeats: 1,
    };
  }
  if ((fx === 'weaponAura' || fx === 'flourish') && abilityId) {
    return { kind: 'gesture', abilityId };
  }
  return null;
}
