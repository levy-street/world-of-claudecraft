// Page titles for things that share a name. Instead of "The Wreck Line (2)", a duplicate
// says what it is: "The Wreck Line (Quest)", or "The Wreck Line (Quest, The Farshore)"
// when two quests share the name.

export interface TitleEntry {
  /** Stable key for the result map, such as "quest/q_wreck_line". */
  key: string;
  /** The name with its usual suffix, such as "Wild Boar (Mob)". */
  base: string;
  /** Qualifiers to try in order when the base is shared. '' means "keep the bare name". */
  hints: string[];
}

/** "Name (Mob)" + "Warrior" becomes "Name (Mob, Warrior)"; "Name" + "Quest" "Name (Quest)". */
export function qualify(base: string, hint: string): string {
  if (!hint) return base;
  return base.endsWith(')') && / \([^()]+\)$/.test(base)
    ? base.slice(0, -1) + ', ' + hint + ')'
    : base + ' (' + hint + ')';
}

/** Words of an id that the name does not already say, as a last-resort qualifier. */
export function idQualifier(id: string, name: string): string {
  const said = new Set(name.toLowerCase().split(/[^a-z0-9]+/));
  return id
    .split('_')
    .filter((word) => word && !said.has(word))
    .join(' ');
}

function numbered(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(base + ' (' + i + ')')) i++;
  return base + ' (' + i + ')';
}

/** Gives every entry a title that is unique in `used`, and records it there. */
export function assignTitles(entries: TitleEntry[], used: Set<string>): Map<string, string> {
  const titles = new Map<string, string>();
  const groups = new Map<string, TitleEntry[]>();
  for (const e of entries) groups.set(e.base, [...(groups.get(e.base) ?? []), e]);
  for (const [base, group] of groups) {
    let open = group;
    if (group.length === 1 && !used.has(base)) {
      titles.set(group[0].key, base);
      used.add(base);
      continue;
    }
    const depth = Math.max(...group.map((e) => e.hints.length));
    for (let level = 0; level < depth && open.length; level++) {
      const candidates = open.map((e) =>
        level < e.hints.length ? qualify(base, e.hints[level]) : null,
      );
      const next: TitleEntry[] = [];
      open.forEach((e, i) => {
        const title = candidates[i];
        if (title && !used.has(title) && candidates.filter((c) => c === title).length === 1) {
          titles.set(e.key, title);
        } else next.push(e);
      });
      for (const e of open) if (titles.has(e.key)) used.add(titles.get(e.key)!);
      open = next;
    }
    for (const e of open) {
      const title = numbered(base, used);
      titles.set(e.key, title);
      used.add(title);
    }
  }
  return titles;
}
