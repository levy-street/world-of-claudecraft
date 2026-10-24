// Per-player crafting identity view: skills, active archetype/pair/hobby,
// known recipes, and cadence-blocked work orders. Extracted from sim.ts's
// craftingIdentityFor (Modularity: a natural existing seam, moved verbatim).
import type { CraftingIdentityView } from '../../world_api';
import { repeatBlockedQuestIds } from '../quests/quest_commands';
import type { SimContext } from '../sim_context';
import { archetypeStateFor, requiredAmendsProgress } from './archetype';
import { craftSkillsFor } from './wheel';

export function craftingIdentityFor(ctx: SimContext, pid: number): CraftingIdentityView {
  const state = archetypeStateFor(ctx, pid);
  const meta = ctx.players.get(pid);
  return {
    version: 1,
    synced: true,
    craftSkills: craftSkillsFor(ctx, pid),
    activeArchetype: state.activeArchetype,
    pairedMajor: state.pairedMajor,
    hobbyCraft: state.hobbyCraft,
    attunedPairs: [...state.attunedPairs],
    switchCount: state.switchCount,
    amendsProgress: state.amendsProgress,
    amendsRequired: requiredAmendsProgress(state.switchCount),
    // SORTED so the view's JSON form is a stable signature: the server's
    // cprof delta diff (server/game.ts maybe()) re-emits exactly when the
    // set actually changes, never on Set iteration order.
    knownRecipes: [...(meta?.knownRecipes ?? [])].sort(),
    // Work orders on cooldown, resolved against THIS host's tickCount, plus
    // weekly quests locked until the weekly reset (quests/weekly_quest_lock.ts).
    // Sorted, so the cprof diff re-emits only on arm/expiry, and the
    // online client feeds it into its local computeQuestState.
    cadenceBlockedQuests: meta ? [...(repeatBlockedQuestIds(ctx, meta) ?? [])].sort() : [],
    // Quested-hobby record (professions/hobby_memory.ts), KEY-SORTED for a
    // stable cprof signature and omitted while empty, so the delta diff
    // never fires for characters without the feature.
    ...(() => {
      const quested = meta?.questedHobbies;
      if (!quested || quested.size === 0) return {};
      return {
        questedHobbies: Object.fromEntries(
          [...quested.entries()].sort(([a], [b]) => (a < b ? -1 : 1)),
        ),
      };
    })(),
  };
}
