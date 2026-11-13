import { systemIntroduction } from './article_editorial';
import { systemWalkthrough } from './play_path';
import { activityNotice } from './system_availability';
import { systemDirectory } from './system_directory';
import { systemRouteMap } from './system_routes';

/** A system and its entries share one index. Existing game entities resolve through the seed's title maps. */
export interface SystemWikiContext {
  add(title: string, text: string, categories: string[]): void;
  unique(title: string, hint?: string): string;
  titleBy: Record<'item' | 'npc' | 'mob' | 'zone' | 'dungeon', Map<string, string>> &
    Partial<Record<'recipe' | 'deed' | 'companion' | 'quest', Map<string, string>>>;
}

export function words(id: string): string {
  return id
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
}

export function list(lines: string[]): string {
  return lines.map((line) => `* ${line}`).join('\n');
}

export function heading(name: string, body: string): string {
  return `\n\n== ${name} ==\n${body}`;
}

export function percent(value: number): string {
  return `${Number((value * 100).toFixed(5))}%`;
}

export function systemWriter(ctx: SystemWikiContext) {
  const add = (title: string, body: string, categories: string[]) =>
    ctx.add(title, body.replace(/\s*[\u2013\u2014\u2015]\s*/g, ', '), categories);
  const groups = new Map<
    string,
    { name: string; title: string; body: string; entries: Map<string, string[]> }
  >();
  const group = (name: string) => {
    let found = groups.get(name);
    if (!found) {
      found = { name, title: ctx.unique(name, 'Guide'), body: '', entries: new Map() };
      groups.set(name, found);
    }
    return found;
  };
  return {
    describe(name: string, ...paragraphs: string[]) {
      group(name).body += `${paragraphs.filter(Boolean).join('\n\n')}\n\n`;
    },
    registerArt(kind: 'recipe' | 'deed' | 'companion', id: string, title: string) {
      ctx.titleBy[kind] ??= new Map();
      ctx.titleBy[kind].set(id, title);
    },
    reserveArticle(name: string, suffix: string) {
      return ctx.unique(`${name} (${suffix})`);
    },
    entity(
      type: 'item' | 'npc' | 'mob' | 'zone' | 'dungeon' | 'quest' | 'deed',
      id: string,
      label?: string,
    ) {
      const title = ctx.titleBy[type]?.get(id);
      return title
        ? `[[${title}${label && label !== title ? `|${label}` : ''}]]`
        : (label ?? words(id));
    },
    article(
      grouping: string | { owner: string; section: string; title?: string; retired?: boolean },
      name: string,
      suffix: string,
      ...paragraphs: string[]
    ) {
      const groupName = typeof grouping === 'string' ? grouping : grouping.owner;
      const section = typeof grouping === 'string' ? 'Entries' : grouping.section;
      const owner = group(groupName);
      const title =
        (typeof grouping === 'string' ? undefined : grouping.title) ??
        ctx.unique(`${name} (${suffix})`);
      const notice = activityNotice(groupName);
      const guide =
        notice.startsWith("'''Retired") || (typeof grouping !== 'string' && grouping.retired)
          ? `See [[${owner.title}]] for the activity's history or availability.`
          : `Related guide: [[${owner.title}]].`;
      add(title, [notice, ...paragraphs, guide].filter(Boolean).join('\n\n'), [groupName]);
      const entries = owner.entries.get(section) ?? [];
      const retired = typeof grouping !== 'string' && grouping.retired;
      entries.push(`[[${title}|${name}]]` + (retired ? ' (retired)' : ''));
      owner.entries.set(section, entries);
      return title;
    },
    finish() {
      const index = [...groups.values()].sort((a, b) => a.title.localeCompare(b.title, 'en'));
      for (const page of index) {
        const notice = activityNotice(page.name);
        const walkthrough = systemWalkthrough(page.name, notice);
        const routeMap = systemRouteMap(page.name, notice);
        const { lead, rest } = walkthrough
          ? systemIntroduction(page.body, page.name)
          : { lead: '', rest: page.body };
        const rulesHeading =
          walkthrough && rest.trim() && !rest.trimStart().startsWith('==')
            ? '== Rules and details ==\n'
            : '';
        const categories = ['Systems', 'Gameplay Systems'];
        const sections = [...page.entries].sort(([a], [b]) => a.localeCompare(b, 'en'));
        if (sections.some(([name]) => name !== 'Entries'))
          categories.push('Collection directories');
        add(
          page.title,
          (notice ? notice + '\n\n' : '') +
            (walkthrough
              ? lead + walkthrough + routeMap + rulesHeading + rest
              : page.body + routeMap) +
            sections.map(([name, entries]) => heading(name, list(entries.sort()))).join(''),
          categories,
        );
      }
      ctx.add('Gameplay Systems', systemDirectory(groups), ['Systems']);
      return index.map((page) => page.title);
    },
  };
}

export type SystemWriter = ReturnType<typeof systemWriter>;
