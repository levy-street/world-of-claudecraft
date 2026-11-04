import { systemDirectory } from './system_directory';

/** A system and its entries share one index. Existing game entities resolve through the seed's title maps. */
export interface SystemWikiContext {
  add(title: string, text: string, categories: string[]): void;
  unique(title: string): string;
  titleBy: Record<'item' | 'npc' | 'mob' | 'zone' | 'dungeon', Map<string, string>> &
    Partial<Record<'recipe' | 'deed' | 'companion', Map<string, string>>>;
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
  const groups = new Map<string, { title: string; body: string; entries: Map<string, string[]> }>();
  const group = (name: string) => {
    let found = groups.get(name);
    if (!found) {
      found = { title: ctx.unique(name), body: '', entries: new Map() };
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
    entity(type: 'item' | 'npc' | 'mob' | 'zone' | 'dungeon', id: string, label?: string) {
      const title = ctx.titleBy[type].get(id);
      return title
        ? `[[${title}${label && label !== title ? `|${label}` : ''}]]`
        : (label ?? words(id));
    },
    article(
      grouping: string | { owner: string; section: string },
      name: string,
      suffix: string,
      ...paragraphs: string[]
    ) {
      const groupName = typeof grouping === 'string' ? grouping : grouping.owner;
      const section = typeof grouping === 'string' ? 'Entries' : grouping.section;
      const owner = group(groupName);
      const title = ctx.unique(`${name} (${suffix})`);
      add(title, `${paragraphs.filter(Boolean).join('\n\n')}\n\nSee [[${owner.title}]].`, [
        groupName,
      ]);
      const entries = owner.entries.get(section) ?? [];
      entries.push(`[[${title}|${name}]]`);
      owner.entries.set(section, entries);
      return title;
    },
    finish() {
      const index = [...groups.values()].sort((a, b) => a.title.localeCompare(b.title, 'en'));
      for (const page of index) {
        const categories = ['Systems', 'Gameplay Systems'];
        const sections = [...page.entries].sort(([a], [b]) => a.localeCompare(b, 'en'));
        if (sections.some(([name]) => name !== 'Entries'))
          categories.push('Collection directories');
        add(
          page.title,
          page.body +
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
