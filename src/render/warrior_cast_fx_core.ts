export const WARRIOR_SHOUT_COLORS = {
  battle_shout: 0xff2a1a,
  demoralizing_shout: 0x9a5df0,
  emboldening_roar: 0xff5470,
  defiant_bellow: 0xff8c2a,
  rallying_cry: 0xffe9a0,
  intimidating_shout: 0x7f8ad0,
} as const;

/**
 * Does a mob's OWN cue claim this spellfx, ahead of the warrior cast plan below?
 *
 * The dragonkin brood emits the only two of these today: a 'shout' (the rooted
 * engage bellow, which for a broodlord also cracks the clutch awake) and a
 * 'flourish' (a whelp's hatch pounce). Both play the visual's flourish one-shot.
 *
 * The discriminator is the SOURCE, deliberately, not the ability id. Players
 * reach the same two fx kinds through `ability.castFx` (the six warrior shouts
 * and raised_guard), and casting_lifecycle emits every player castFx WITH its
 * ability id, so an `ability === undefined` test would happen to work today. It
 * would be a trap: a mob one-shot may legitimately carry an ability id so the
 * renderer can pick its authored clip via attackByAbility (the brood's own
 * Cleave and Stun already do), and the day a brood shout wants that, the cue
 * would silently start falling through to the warrior plan. Source kind cannot
 * drift that way.
 *
 * Order is load-bearing in the other direction too: warriorCastVisualPlan claims
 * ANY 'shout' whatever the ability id, falling back to a default roar color, so
 * simply moving this branch below it would repaint every mob bellow as a warrior
 * shout. The dispatch contract is pinned in tests/warrior_render_contract.test.ts.
 */
export function isMobEngageCue(fx: string, sourceKind: string | undefined): boolean {
  return (fx === 'shout' || fx === 'flourish') && sourceKind === 'mob';
}

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
