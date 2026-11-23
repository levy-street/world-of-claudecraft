// The townsfolk verb a player sends (IWorldSeasonal.trickOrTreat): a knock, or with
// `boo` the Boo! daily's costumed fright. One entry so the Sim and the server keep one
// command for both (the server re-validates everything inside each).
import type { SimContext } from '../sim_context';
import { booTownsfolk } from './gourdlight_dailies';
import { trickOrTreat } from './trick_or_treat';

export function knockOrBoo(ctx: SimContext, npcId: number, boo: boolean, pid?: number): void {
  if (boo) booTownsfolk(ctx, npcId, pid);
  else trickOrTreat(ctx, npcId, pid);
}
