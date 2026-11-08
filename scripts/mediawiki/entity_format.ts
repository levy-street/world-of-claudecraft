import { ENCHANTS } from '../../src/sim/content/enchants';
import {
  ABILITIES,
  ALL_RECIPES,
  CLASSES,
  DUNGEONS,
  ITEMS,
  MOBS,
  NPCS,
  QUESTS,
  ZONES,
} from '../../src/sim/data';
import type { QuestRoute } from './quest_route';

export type ArticleKind =
  | 'class'
  | 'ability'
  | 'zone'
  | 'dungeon'
  | 'npc'
  | 'quest'
  | 'mob'
  | 'item';
export interface ArticleTools {
  questMap?(route: QuestRoute): string;
  titleBy: Record<ArticleKind, Map<string, string>> & {
    companion?: Map<string, string>;
    worldQuest?: Map<string, string>;
    weekly?: Map<string, string>;
  };
  add(title: string, body: string, categories: string[]): void;
  section(title: string, body: string): string;
  table(rows: [string, string][]): string;
  bullets(lines: string[]): string;
  link(title: string, label?: string): string;
  money(copper?: number): string;
}
const names: Partial<Record<ArticleKind, Record<string, { name: string }>>> = {
  ability: ABILITIES,
  mob: MOBS,
  item: ITEMS,
  quest: QUESTS,
  npc: NPCS,
  dungeon: DUNGEONS,
  class: CLASSES,
  zone: Object.fromEntries(ZONES.map((z) => [z.id, z])),
};
export const words = (s: string): string =>
  s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase();
export const pct = (n: number): string => Number((100 * n).toFixed(6)) + '%';
export function ref(w: ArticleTools, kind: ArticleKind, id: string) {
  const title = w.titleBy[kind].get(id);
  const name = names[kind]?.[id]?.name ?? words(id);
  return title ? w.link(title, name) : name;
}
export function lines(w: ArticleTools, heading: string, entries: string[]): string {
  return entries.length ? w.section(heading, w.bullets(entries)) : '';
}
export const recipes = new Map(ALL_RECIPES.map((r) => [r.id, r]));
export function recipeLabel(w: ArticleTools, id: string): string {
  const r = recipes.get(id);
  return r
    ? ref(w, 'item', r.resultItemId) + ' (' + words(r.professionId) + ', skill ' + r.skillReq + ')'
    : (ENCHANTS[id]?.name ?? words(id));
}
export function append(index: Map<string, Set<string>>, id: string, text: string) {
  let entries = index.get(id);
  if (!entries) {
    entries = new Set();
    index.set(id, entries);
  }
  entries.add(text);
}
