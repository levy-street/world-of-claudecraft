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
  const groups = new Map<string, { title: string; body: string; entries: string[] }>();
  const group = (name: string) => {
    let found = groups.get(name);
    if (!found) {
      found = { title: ctx.unique(name), body: '', entries: [] };
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
    article(groupName: string, name: string, suffix: string, ...paragraphs: string[]) {
      const owner = group(groupName);
      const title = ctx.unique(`${name} (${suffix})`);
      add(title, `${paragraphs.filter(Boolean).join('\n\n')}\n\nSee [[${owner.title}]].`, [
        groupName,
      ]);
      owner.entries.push(`[[${title}|${name}]]`);
      return title;
    },
    finish() {
      const index = [...groups.values()].sort((a, b) => a.title.localeCompare(b.title, 'en'));
      for (const page of index) {
        add(
          page.title,
          page.body + (page.entries.length ? heading('Entries', list(page.entries.sort())) : ''),
          ['Systems'],
        );
      }
      ctx.add('Gameplay Systems', list(index.map((page) => `[[${page.title}]]`)), ['Systems']);
      return index.map((page) => page.title);
    },
  };
}

export type SystemWriter = ReturnType<typeof systemWriter>;
