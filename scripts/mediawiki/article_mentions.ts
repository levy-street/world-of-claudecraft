interface Article {
  title: string;
  text: string;
}

interface Target {
  title: string;
  name: string;
  category: string;
  scope: string[];
}

function key(text: string) {
  return text.toLowerCase().replaceAll('’', "'");
}

// Preserve literal parentheses in player names, e.g. Membership Token (30 Days).
const qualifier =
  / \((?:Ability|Talent|Deed|Recipe|NPC|Mob|Equipment set|World Quest|Enchant|Collection|Weapon skin|Contract|Specialization|Augment|Mount|Hoard encounter|Crop|Rift floor|Combat pet|Work order|Clue hunt|Rift|Mount skin|Companion|Hoard|Power-up|Weekly Quest|Faction|Pet family|Delve companion|Delve|Ferry|(?:NPCs|Items|Enemies|Abilities) index)\)$/;
const numbered = / \(\d+\)$/;
const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Terms such as "Fire" name an index as well as a damage school. A plain
// mention of the school is not a reference to that directory. Likewise "Raid"
// is usually an activity rather than the title of a particular weekly quest.
const needsContext = new Set([
  'Portals',
  'Book of Deeds',
  'The Reliquary',
  'Weekly quests',
  'Fiesta augments',
  'Fiesta power-ups',
  'Rift floors',
  'Hunter pets',
]);
const ordinary = new Set(
  (
    'anointing avatar bewitch blizzard bloodbath bold boot champion charge contingency consume courier ' +
    'coven dash doctrine execution handaxe headbutt ignition intervene ' +
    'lunge mayhem menace overdrive overload pursuit quickening recklessness revenge ' +
    'rewind sap scald scratch sear sentence slumber stampede veteran warded zeal'
  ).split(' '),
);

const givenNames = new Set(
  'Amos Cham Garrick Grissel Hesper Hester Maben Marla Maudie Mira Ned Ondrel Saul Tobias'.split(
    ' ',
  ),
);
const genericNpcWords = new Set(
  'the of card master vault keeper muster commander dispatch guard lantern sentry watchman projection pale quartermaster'.split(
    ' ',
  ),
);

function viableMention(
  t: Target,
  label: string,
  wanted: string,
  context: string,
  page: Article,
  linked: Set<string>,
) {
  if (label === t.title && (qualifier.test(label) || numbered.test(label))) return true;
  const alias = key(label);
  if (t.name === t.name.toUpperCase() && label !== t.name && alias === key(t.name)) return false;
  if (t.category === 'NPCs' && alias !== key(t.name)) {
    return (
      /^[A-Z]/.test(label) &&
      (wanted === 'NPCs' || linked.has(t.title) || page.text.includes(t.name))
    );
  }
  if (t.category === 'NPCs' && !/[A-Z]/.test(label.replace(/^the /i, ''))) return false;
  if (wanted === t.category) return true;
  if (t.title.endsWith(' index)')) return /\b(?:browse|catalog|directory|index)\b/i.test(context);
  if (t.category === 'Weekly quests') return /\bweekly (?:quest|objective)\b/i.test(context);
  if (t.category === 'The Reliquary')
    return /\b(?:shelf|reliquary|illuminate|collection)\b/i.test(context);
  if (t.category === 'Book of Deeds')
    return label === t.name && /\b(?:deed|renown|earned|unlocks?|awards?)\b/i.test(context);
  if (alias === 'mail' && t.category === 'Systems')
    return (
      !/\b(?:armor|armour|leather|plate)\b/i.test(context) &&
      /\b(?:send|sent|letter|mailbox|ravenpost|inbox|parcel|receive|delivered|by mail|in the mail)\b/i.test(
        context,
      )
    );
  if (label.includes(' ')) {
    if (['Abilities', 'Talent choices', 'Quests', 'Fiesta augments'].includes(t.category))
      return label !== label.toLowerCase();
    return true;
  }
  if (needsContext.has(t.category) && t.name !== t.title) return false;
  if (ordinary.has(alias)) {
    return (
      label === t.name &&
      ['Abilities', 'Talent choices'].includes(t.category) &&
      /\b(?:cooldown|costs?|casts?|damage|ability|ability rank|talents?|spells?|mana|rage|energy)\b/i.test(
        context,
      )
    );
  }
  return label === t.name || ['Systems', 'Classes'].includes(t.category);
}

function contextCategory(before: string, after: string) {
  if (
    /^\s+(?:raid|dungeon|instance)\b/i.test(after) ||
    /\b(?:raid|dungeon|entrance to|enter the instance)\s*[:“"' ]*$/i.test(before)
  )
    return 'Dungeons';
  if (/\b(?:quest|turn in|complete quest|hand in)\s*[:“"' ]*$/i.test(before)) return 'Quests';
  if (/\b(?:recipe|pattern)(?: for)?\s*[:“"' ]*$/i.test(before) || /^\s+recipe\b/i.test(after))
    return 'Crafting recipes';
  if (
    /\b(?:cast|spell|ability|activate)\s*[:“"' ]*$/i.test(before) ||
    /^\s+(?:spell|ability)\b/i.test(after)
  )
    return 'Abilities';
  if (/\b(?:talent|talent choice)\s*[:“"' ]*$/i.test(before) || /^\s+talent\b/i.test(after))
    return 'Talent choices';
  if (/\b(?:deed|earn the deed)\s*[:“"' ]*$/i.test(before) || /^\s+deed\b/i.test(after))
    return 'Book of Deeds';
  if (/\b(?:talk|speak|return|hand it in) to\s*$/i.test(before)) return 'NPCs';
  if (/\b(?:kill|defeat|slay|tame)\s*$/i.test(before)) return 'Mobs';
  if (/\b(?:equip|buy|drink|consume|loot|use)\s*$/i.test(before)) return 'Items';
  return '';
}

// Verbatim islands and markup syntax must never become part of a link.
// Capturing a whole map also protects the SVG-style coordinates and pin badges.
const protectedMarkup =
  /<!--[\s\S]*?-->|<(code|pre|nowiki|syntaxhighlight)\b[^>]*>[\s\S]*?<\/\1>|^```[\s\S]*?^```[^\n]*|`[^`\n]*`|<div class="woc-map"[\s\S]*?<\/div>|<[^>\n]+>|\[\[[^\]]*\]\]|\[https?:\/\/[^\]]*\]|\{\{[^{}]*\}\}|https?:\/\/[^\s)\]]+|(?<![\w])\/[\w-]+(?:\/[\w.-]+)*|^[ \t]*={2,6}[^\n]*={2,6}[ \t]*$|^[ \t]*(?:\{\||!)[^\n]*|&(?:#\d+|\w+);/gim;

/** Link actual article names in visible wikitext, once the complete catalog
 * exists. Existing links stay authoritative for explicitly disambiguated names. */
export function linkArticleMentions(pages: Article[]): void {
  const aliases = new Map<string, Target[]>();
  const titles = new Map<string, Target>();
  function add(alias: string, target: Target) {
    const name = key(alias);
    const options = aliases.get(name) ?? [];
    if (!options.includes(target)) options.push(target);
    aliases.set(name, options);
  }
  for (const page of pages) {
    if (/^(?:Category|MediaWiki):/.test(page.title)) continue;
    const [category = '', ...scope] = [...page.text.matchAll(/\[\[Category:([^\]]+)\]\]/g)].map(
      (m) => m[1],
    );
    const base = page.title.replace(numbered, '').replace(qualifier, '');
    const target = { title: page.title, name: base, category, scope };
    titles.set(page.title, target);
    add(page.title, target);
    add(base, target);
    if (category === 'Classes') add(base + 's', target);
    if (category === 'Faction standing' && !base.startsWith('The ')) add('the ' + base, target);
    if (category === 'NPCs' && !base.includes("'") && !base.startsWith('The ')) {
      const parts = base.split(' ');
      const last = parts.at(-1)!;
      if (parts.length > 1 && !genericNpcWords.has(key(last))) add(last, target);
      // The character is often addressed by first name after an introduction.
      if (parts.length > 1 && givenNames.has(parts[0])) add(parts[0], target);
      if (parts.length > 2 && !genericNpcWords.has(key(parts[1])))
        add(parts.slice(1).join(' '), target);
    }
    if (/^(?:Zones|Dungeons)$/.test(category) && base.startsWith('The '))
      add(base.slice(4), target);
  }
  if (!aliases.size) return;
  // A single longest-first matcher means "Copper Ore" wins over "Copper".
  // Keep the match offset in the original text, including typographic apostrophes.
  const names = [...aliases.keys()]
    .sort((a, b) => b.length - a.length)
    .map((s) => literal(s).replaceAll("'", "['’]"));
  const pattern = new RegExp(
    '(?<![\\p{L}\\p{N}_-])(?:' + names.join('|') + ')(?![\\p{L}\\p{N}_-])',
    'giu',
  );
  for (const page of pages) {
    const current = titles.get(page.title);
    if (!current) continue;
    const linked = new Set(
      [...page.text.matchAll(/\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g)].map((m) => m[1]),
    );
    let ambiguous = false;
    const discovered = new Set<string>();
    let cursor = 0;
    function inProse(text: string) {
      return text.replace(pattern, (label: string, offset: number) => {
        const alias = key(label);
        const options = aliases.get(alias)!;
        const before = text.slice(Math.max(0, offset - 70), offset);
        const after = text.slice(offset + label.length, offset + label.length + 60);
        const wanted = contextCategory(before, after);
        // Keep cues in the same sentence/field as the mention.
        const context = before.split(/[.!?\n]/).at(-1) + label + after.split(/[.!?\n]/)[0];
        const viable = options.filter((t) =>
          viableMention(t, label, wanted, context, page, linked),
        );
        if (!viable.length) return label;
        // A boss's surname can also name an NPC incarnation of the same character.
        if (!wanted && current!.name.split(' ').some((part) => key(part) === alias)) return label;
        let choices = viable;
        const byKind = wanted && viable.filter((t) => t.category === wanted);
        if (byKind && byKind.length) choices = byKind;
        if (choices.length > 1) {
          const start = cursor + offset;
          const paragraph =
            page.text
              .slice(Math.max(0, start - 300), start)
              .split('\n\n')
              .at(-1)! + page.text.slice(start, start + 250).split('\n\n')[0];
          const local = choices.filter((t) => t.scope.some((s) => paragraph.includes(s)));
          if (local.length === 1) choices = local;
        }
        if (choices.length > 1) {
          const explicit = choices.filter((t) => linked.has(t.title));
          if (explicit.length === 1) choices = explicit;
        }
        if (choices.length > 1) {
          const sameScope = choices.filter((t) => t.scope.some((s) => current!.scope.includes(s)));
          if (sameScope.length === 1) choices = sameScope;
        }
        if (choices.length > 1) {
          const canonical = choices.find((t) => key(t.title) === alias);
          if (
            canonical &&
            !choices.some((t) => t !== canonical && t.category === canonical.category)
          )
            choices = [canonical];
        }
        if (choices.length !== 1) {
          ambiguous = true;
          return label;
        }
        const title = choices[0].title;
        if (title === page.title) return label;
        if (!linked.has(title)) discovered.add(title);
        return label === title ? '[[' + title + ']]' : '[[' + title + '|' + label + ']]';
      });
    }
    function render() {
      cursor = 0;
      const parts: string[] = [];
      for (const match of page.text.matchAll(protectedMarkup)) {
        let literalText = match[0];
        const heading = literalText.startsWith('=') && literalText.match(/^(={2,3}) (.+) \1$/);
        if (heading) {
          const subject = titles.get(heading[2]);
          if (
            subject &&
            subject.title !== page.title &&
            (['Zones', 'Classes', 'Dungeons'].includes(subject.category) ||
              (subject.title === 'Heroic difficulty' && current?.category === 'Dungeons'))
          ) {
            literalText = heading[1] + ' [[' + subject.title + ']] ' + heading[1];
          }
        }
        parts.push(inProse(page.text.slice(cursor, match.index)), literalText);
        cursor = match.index + match[0].length;
      }
      parts.push(inProse(page.text.slice(cursor)));
      return parts.join('');
    }
    let result = render();
    // A later full name or named location can settle an earlier ambiguous
    // reference. Use only evidence from this article, regardless of line order.
    if (ambiguous && discovered.size) {
      for (const title of discovered) linked.add(title);
      result = render();
    }
    page.text = result;
  }
}
