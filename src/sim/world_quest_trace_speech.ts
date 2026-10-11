import { WORLD_QUEST_CALLIGRAPHY_NPC_IDS } from './content/world_quest_calligraphy';
import { emitMobYell } from './mob/yells';
import type { SimContext } from './sim_context';

export function emitWorldQuestTraceRoundSpeech(ctx: SimContext, round: number, gold = false): void {
  const say = (id: string, text: string) => {
    const npc = ctx.entities.get(WORLD_QUEST_CALLIGRAPHY_NPC_IDS[id]);
    if (npc && !npc.dead) emitMobYell(ctx, npc, text, 35);
  };
  if (round === 0) say('calligraphy_apprentice_1', 'Three corners, and every one in its place!');
  else if (round === 1) {
    say('calligraphy_apprentice_2', 'Four sides! I think I can do that too!');
    say(
      'calligraphy_instructor',
      'Final rune. A line may cross or revisit a point; follow the bright marker to the next corner.',
    );
  } else if (gold)
    say(
      'calligraphy_instructor',
      'Beautifully traced! Your steps have earned their place in gold.',
    );
  else
    say(
      'calligraphy_instructor',
      'A complete rune! Care and practice will make your next one even finer.',
    );
}
