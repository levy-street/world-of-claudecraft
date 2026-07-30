import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AUGMENTS } from '../src/sim/content/augments';
import { CHOICE_ROWS } from '../src/sim/content/choice_rows';
import { ROW_TREES, TALENTS } from '../src/sim/content/talents';
import { ABILITIES, DUNGEONS, ITEM_SETS, ITEMS, MOBS, NPCS, QUESTS, ZONES } from '../src/sim/data';
import { en } from '../src/ui/i18n.resolved.generated/en';

// The de-IP gate (session G0 of the IP pivot, ip-refactor/G0-deip-gates.md).
//
// A deterministic static scanner over the two English source layers - the sim
// content `.name` fields (the source of truth) AND the resolved English i18n
// table (so a name is caught whether or not the resolved table has been
// regenerated) - asserting that NO entry of a curated verbatim-WoW /
// Blizzard-coined DENYLIST appears in a player-visible display-name field.
//
// THIS GATE LANDS RED ON PURPOSE. Today's violations ARE the rename worklist
// (seeded into ip-refactor/02-WORKING-MEMORY.md); the V/C/W/T rename tracks
// turn entries green by applying the LOCKED NAME-MAP, and Z1 requires the
// whole scan green with zero residual. Never `.skip`, `.only`, loosen a match,
// or delete a denylist entry to make this pass - the only legitimate way an
// entry goes green is a track actually renaming the display string.
//
// Matching rules (see the G0 brief):
// - Display-NAME fields get whole-name (word-boundary phrase) matching, never
//   a substring scan of prose. Generic English inside descriptions ("a bolt of
//   fire", "strike the target") must not trip.
// - Spec/tree names from the NAME-MAP (`kind: tree` - Arcane, Fire, Frost,
//   Holy, ...) are single generic words, so they arm ONLY as whole-value
//   matches on the spec-name fields, never as tokens inside other names.
// - A small explicit PROSE-SCAN set (the coined words C1 scrubs from flavor
//   text: murloc, bristleback, and the kobold candle flavor) is word-boundary
//   matched over quest/greeting prose fields only.
// - The denylist is seeded from the NAME-MAP `old` column (rows flagged
//   `rename`/`coined-id`/`pairing`/`rename?`; `generic-keep?` rows are
//   EXCLUDED so Charge/Cleave/Taunt/Execute/... never trip unless the operator
//   flips that row to `rename` in the locked map, which arms it here
//   automatically) PLUS a hardcoded verbatim-WoW list (belt-and-braces,
//   independent of the map, so a missed map row still fails).
//
// Determinism: a pure data scan - static imports + a committed-file read +
// string comparison. No wall-clock, no network, no randomness. A second run
// over an unchanged tree produces the byte-identical violation list.

interface Violation {
  denylistEntry: string;
  field: string;
  id: string;
  value: string;
}

interface DenyEntry {
  text: string;
  // Whole-value match on spec/tree name fields only (NAME-MAP `kind: tree`).
  treeOnly: boolean;
  // Map-derived SINGLE-WORD entry (a generic combat verb the operator renamed -
  // Charge/Vigor/Frenzy/Maul/Silence/...): whole-value match on any name field,
  // never a substring token (operator Z1 ruling, 2026-07-02). Distinctive
  // HARDCODED coinages (Imp/Murloc/Drakonid/...) keep substring matching so
  // "Imp Minion" / "Slimy Murloc Scale" still trip.
  singleWord: boolean;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAME_MAP_PATH = path.join(root, 'ip-refactor', 'NAME-MAP.md');

// The hardcoded verbatim-WoW / Blizzard-coined list from the G0 brief. Kept
// independent of the NAME-MAP so a missed or mangled map row still fails the
// gate. 'Mogger' was seeded here by G0 and REMOVED at NAME-MAP lock
// (2026-07-02): the operator decided to KEEP the Hogger parody, exercising the
// one operator-authorized scanner edit the briefs allow (the map rows flipped
// to generic-keep? in the same change, so the map and this list stay aligned).
const HARDCODED_VERBATIM: string[] = [
  'Heroic Strike',
  'Mortal Strike',
  'Sinister Strike',
  'Sunder Armor',
  'Frostbolt',
  'Fireball',
  'Pyroblast',
  'Polymorph',
  'Arcane Missiles',
  'Judgement',
  'Lay on Hands',
  'Consecration',
  'Mind Blast',
  'Devour Magic',
  'War Stomp',
  'Slice and Dice',
  'Eviscerate',
  'Voidwalker',
  'Felhunter',
  'Felguard',
  'Doomguard',
  'Murloc',
  'Bristleback',
  'Drakonid',
  'Shadowmeld',
  'Lightwell',
  // "The rest of the warlock demon-pet roster" (the C2 ownership seed): the
  // whole 7-slot lineup re-themes, so the non-coined three are armed here too.
  'Imp',
  'Succubus',
  'Infernal',
];

// The explicit PROSE-SCAN set (C1-owned flavor text): word-boundary regexes
// over quest text / completion text / objective labels / NPC greetings ONLY.
// Never widened to a general prose sweep.
const PROSE_SCAN: { entry: string; re: RegExp }[] = [
  { entry: 'murloc (prose)', re: /\bmurlocs?\b/i },
  { entry: 'bristleback (prose)', re: /\bbristlebacks?\b/i },
  { entry: 'candle-headed (prose)', re: /\bcandle-headed\b/i },
  { entry: 'Tallow Candle (prose)', re: /\btallow candles?\b/i },
  // Amendment #4 (2026-07-02): the Blizzard-coined 'Shadow Flame' effect, now
  // reworded to 'searing shadow'. Guards ability/talent description prose +
  // encounter/delve dialogue against its reintroduction.
  { entry: 'Shadow Flame (prose)', re: /\bshadow ?flame\b/i },
];

// Flags that ARM a NAME-MAP row for the scanner. `generic-keep?` rows are
// excluded by default; `rename?` (an undecided operator call, e.g. Mogger) is
// armed until the operator flips it to a keep. The map is currently
// PROPOSED/DRAFT with sample rows; G1's LOCK finalizes this source and any row
// it adds or flips arms/disarms here automatically with no scanner edit.
const ARMED_FLAGS = new Set(['rename', 'coined-id', 'pairing', 'rename?']);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Parse the NAME-MAP `old` column into denylist entries. Markdown table rows
// only; cells that are prose descriptions rather than display names (quoted
// strings, parenthetical meta like `(code id + quest word "murloc")`, code ids
// with underscores) are skipped - the hardcoded list covers those families.
function parseNameMapDenylist(markdown: string): DenyEntry[] {
  const entries: DenyEntry[] = [];
  for (const line of markdown.split('\n')) {
    if (!line.trimStart().startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    // | id | old | new | kind | flag |  ->  ['', id, old, new, kind, flag, '']
    if (cells.length < 7) continue;
    const [, , old, , kind, flag] = cells;
    if (!old || old === 'old' || /^[-\s:]+$/.test(old)) continue;
    if (!ARMED_FLAGS.has(flag)) continue;
    // A single map cell may carry several display names ("A / B / C").
    for (const rawPart of old.split(' / ')) {
      // Strip a trailing parenthetical annotation ("Mogger (Hogger parody)").
      const part = rawPart.replace(/\s*\(.*$/, '').trim();
      if (!part) continue;
      // Skip non-display cells: quoted prose, leftover parens, code ids.
      if (part.includes('"') || part.includes('(') || part.includes('_') || part.includes('`')) {
        continue;
      }
      entries.push({ text: part, treeOnly: kind === 'tree', singleWord: !part.includes(' ') });
    }
  }
  return entries;
}

// Names flagged `generic-keep?` in the map (Charge, Cleave, Execute, ...).
// The scanner must NOT arm these; a dedicated test below proves it.
function parseGenericKeep(markdown: string): string[] {
  const keep: string[] = [];
  for (const line of markdown.split('\n')) {
    if (!line.trimStart().startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 7) continue;
    const [, , old, , , flag] = cells;
    if (flag !== 'generic-keep?') continue;
    if (!old || old.includes('(') || old.includes('"')) continue;
    keep.push(old);
  }
  return keep;
}

const nameMapMarkdown = readFileSync(NAME_MAP_PATH, 'utf8');

function buildDenylist(): DenyEntry[] {
  const byKey = new Map<string, DenyEntry>();
  const add = (e: DenyEntry) => {
    const key = `${e.text.toLowerCase()}${e.treeOnly ? '|tree' : ''}`;
    if (!byKey.has(key)) byKey.set(key, e);
  };
  for (const text of HARDCODED_VERBATIM) add({ text, treeOnly: false, singleWord: false });
  for (const e of parseNameMapDenylist(nameMapMarkdown)) add(e);
  return [...byKey.values()];
}

const DENYLIST = buildDenylist();

const NAME_ENTRIES = DENYLIST.filter((e) => !e.treeOnly);
// Only multi-word / HARDCODED entries get a substring (word-boundary) regex;
// map-derived single words match whole-value (built inline in scanNameValue).
const NAME_ENTRY_RE = new Map<string, RegExp>(
  NAME_ENTRIES.filter((e) => !e.singleWord).map((e) => [
    e.text,
    new RegExp(`\\b${escapeRegExp(e.text)}\\b`, 'i'),
  ]),
);
const TREE_ENTRIES = DENYLIST.filter((e) => e.treeOnly);

// Operator-ruled intentional KEEPS of an armed display string (NAME-MAP
// Amendment #4 + the Z1 single-word ruling, 2026-07-02). The same string is
// renamed for one entity but deliberately kept for this specific field, exactly
// like the Mogger parody. A single-word whole-value rule cannot express these
// (the kept value EQUALS the armed word), so they are explicit per-field
// exemptions. `fieldIncludes` matches both the sim-side and resolved-table field
// paths (e.g. 'aug_toughness' hits augments.* AND i18n.en.fiesta.augment.*).
const KEEP_EXEMPTIONS: { entry: string; value: string; fieldIncludes: string }[] = [
  { entry: 'Weapon Mastery', value: 'Weapon Mastery', fieldIncludes: 'arms_tactical_mastery' },
  { entry: 'Weapon Mastery', value: 'Weapon Mastery', fieldIncludes: 'combat_weapon_mastery' },
  // The release handoff explicitly preserves the winning Warrior option's authored
  // stable name. Scope the exception to that one canonical option id; any other
  // reintroduction of the phrase must still fail this gate.
  { entry: 'Second Wind', value: 'Second Wind', fieldIncludes: 'war_row_second_wind' },
  { entry: 'Toughness', value: 'Toughness', fieldIncludes: 'aug_toughness' },
  { entry: 'Stormcaller', value: 'Stormcaller', fieldIncludes: 'holderTiers.stormcaller' },
  { entry: 'Berserker', value: 'Berserker', fieldIncludes: 'pow_berserker' },
  // Generic UI category/mechanic labels (damage-meter 'Heal' column; pet-command
  // 'Taunt'), operator-approved keeps, NOT the renamed priest/warrior abilities.
  { entry: 'Heal', value: 'Heal', fieldIncludes: 'meters.healingShort' },
  { entry: 'Taunt', value: 'Taunt', fieldIncludes: 'pet.taunt' },
];
function isKeptException(field: string, value: string, entry: string): boolean {
  return KEEP_EXEMPTIONS.some(
    (x) => x.entry === entry && x.value === value && field.includes(x.fieldIncludes),
  );
}

// Whole-name match of every armed denylist entry against ONE display-name
// value. `isSpecField` additionally arms the whole-value tree-name entries.
function scanNameValue(
  field: string,
  id: string,
  value: string,
  isSpecField: boolean,
  out: Violation[],
): void {
  for (const e of NAME_ENTRIES) {
    const hit = e.singleWord
      ? value.trim().toLowerCase() === e.text.toLowerCase()
      : NAME_ENTRY_RE.get(e.text)!.test(value);
    if (hit && !isKeptException(field, value, e.text)) {
      out.push({ denylistEntry: e.text, field, id, value });
    }
  }
  if (isSpecField) {
    for (const e of TREE_ENTRIES) {
      if (value.trim().toLowerCase() === e.text.toLowerCase()) {
        out.push({ denylistEntry: `${e.text} (tree)`, field, id, value });
      }
    }
  }
}

// Word-boundary match of the explicit prose set against ONE prose value.
function scanProseValue(field: string, id: string, value: string, out: Violation[]): void {
  for (const { entry, re } of PROSE_SCAN) {
    if (re.test(value)) out.push({ denylistEntry: entry, field, id, value });
  }
}

// Amendment #4: recursively PROSE-scan every `description` / `masteryDescription`
// string in a content tree (abilities, talents). Tooltip prose gets the small
// PROSE_SCAN set only - NEVER the name denylist, or generic armed verbs
// (Charge/Execute/Cleave) that live in tooltips legitimately would trip.
function scanDescriptions(node: unknown, prefix: string, out: Violation[]): void {
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if ((k === 'description' || k === 'masteryDescription') && typeof v === 'string') {
      scanProseValue(`${prefix}.${k}`, prefix, v, out);
    } else if (v && typeof v === 'object') {
      scanDescriptions(v, `${prefix}.${k}`, out);
    }
  }
}

// Amendment #4: scripted boss/delve dialogue lives inline in encounter functions
// (not exported data), so prose-scan the string literals of these source files.
const DIALOGUE_SOURCES = ['src/sim/encounters/nythraxis.ts', 'src/sim/delves/runs.ts'];
const STRING_LITERAL_RE = /(['"`])((?:\\.|(?!\1).)*)\1/g;

// Recursively scan the WHOLE resolved English table. EVERY string value gets
// the whole-NAME scan (`scanNameValue`, isSpecField=false): a display name can
// surface under a `name`/`title` key OR be quoted inside any other rendered
// UI/guide/tooltip string (e.g. "...then spend it with Judgement." in a guide
// hint, "Bear Form: ..." in an aura label). This is SAFE against generic prose
// because of the whole-value single-word rule - map-derived single armed words
// (Charge/Slam/Vigor/...) match only when they ARE the entire trimmed value, so
// they never trip inside a sentence; only distinctive MULTI-WORD names and the
// HARDCODED coinages substring-match, and those are exactly the stale
// old-name references we want caught wherever they appear. Additionally, inside
// the `entities` subtree the quest/NPC prose keys (`text`, `completion`,
// `greeting`, `label`) still get the explicit PROSE-SCAN pass, mirroring the
// sim-side prose scope. Returns the number of name/title string fields visited
// (unchanged semantics) so a teeth test can prove the walk is not vacuous (a
// renamed generated key must not silently no-op this layer).
function scanResolvedTable(
  node: unknown,
  prefix: string,
  inEntities: boolean,
  out: Violation[],
): number {
  if (node === null || typeof node !== 'object') return 0;
  let nameFields = 0;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const p = `${prefix}.${key}`;
    if (typeof value === 'string') {
      // Every string value is name-scanned (a name can hide in any prose).
      scanNameValue(p, prefix, value, false, out);
      if (key === 'name' || key === 'title') {
        nameFields += 1;
      } else if (
        inEntities &&
        (key === 'text' || key === 'completion' || key === 'greeting' || key === 'label')
      ) {
        scanProseValue(p, prefix, value, out);
      }
    } else if (typeof value === 'object') {
      nameFields += scanResolvedTable(value, p, inEntities || key === 'entities', out);
    }
  }
  return nameFields;
}

// The full scan: every player-visible display-NAME field in the sim content +
// the resolved English table, plus the explicit C1 prose fields.
function collectViolations(): Violation[] {
  const out: Violation[] = [];

  // Abilities (sim source of truth; the catalog copy is byte-identical and the
  // resolved-table walk below covers the rendered layer).
  for (const [id, a] of Object.entries(ABILITIES)) {
    scanNameValue(`abilities.${id}.name`, id, a.name, false, out);
  }

  // Talents: spec names, mastery names, and every canonical row-option name.
  for (const cls of Object.keys(TALENTS) as (keyof typeof TALENTS)[]) {
    const ct = TALENTS[cls];
    for (const spec of ct.specs) {
      scanNameValue(`talents.${cls}.specs.${spec.id}.name`, spec.id, spec.name, true, out);
      scanNameValue(
        `talents.${cls}.specs.${spec.id}.mastery.name`,
        spec.id,
        spec.mastery.name,
        false,
        out,
      );
    }
    for (const row of ROW_TREES[cls]) {
      for (const option of row.options) {
        scanNameValue(
          `talents.${cls}.rows.${row.level}.options.${option.id}.name`,
          option.id,
          option.name,
          false,
          out,
        );
      }
    }
  }
  // Choice rows replaced the node trees: every row option name is player-visible.
  for (const [cls, rows] of Object.entries(CHOICE_ROWS)) {
    for (const row of rows.rows) {
      for (const option of row.options) {
        scanNameValue(
          `choiceRows.${cls}.${row.level}.${option.id}.name`,
          option.id,
          option.name,
          false,
          out,
        );
      }
    }
  }

  // Mobs: display name + every inline mechanic/aura display name (any direct
  // sub-object carrying a string `name`, e.g. mortalStrike/stomp/petSpell/
  // purgeOnHit/aoePulse/venom/...).
  for (const [id, mob] of Object.entries(MOBS)) {
    scanNameValue(`mobs.${id}.name`, id, mob.name, false, out);
    for (const [key, sub] of Object.entries(mob as unknown as Record<string, unknown>)) {
      if (key === 'name' || sub === null || typeof sub !== 'object' || Array.isArray(sub)) continue;
      const mechName = (sub as { name?: unknown }).name;
      if (typeof mechName === 'string') {
        scanNameValue(`mobs.${id}.${key}.name`, id, mechName, false, out);
      }
    }
  }

  // Items, item sets, augments.
  for (const [id, item] of Object.entries(ITEMS)) {
    scanNameValue(`items.${id}.name`, id, item.name, false, out);
  }
  for (const [id, set] of Object.entries(ITEM_SETS)) {
    const name = (set as { name?: unknown }).name;
    if (typeof name === 'string') scanNameValue(`item_sets.${id}.name`, id, name, false, out);
  }
  for (const aug of AUGMENTS) {
    scanNameValue(`augments.${aug.id}.name`, aug.id, aug.name, false, out);
  }

  // World: NPC names/titles, quest names + objective labels, dungeons, zones.
  for (const [id, npc] of Object.entries(NPCS)) {
    scanNameValue(`npcs.${id}.name`, id, npc.name, false, out);
    scanNameValue(`npcs.${id}.title`, id, npc.title, false, out);
  }
  for (const [id, quest] of Object.entries(QUESTS)) {
    scanNameValue(`quests.${id}.name`, id, quest.name, false, out);
    quest.objectives.forEach((obj, i) => {
      scanNameValue(`quests.${id}.objectives.${i}.label`, id, obj.label, false, out);
    });
  }
  for (const [id, dungeon] of Object.entries(DUNGEONS)) {
    scanNameValue(`dungeons.${id}.name`, id, dungeon.name, false, out);
  }
  for (const zone of ZONES) {
    scanNameValue(`zones.${zone.id}.name`, zone.id, zone.name, false, out);
    scanNameValue(`zones.${zone.id}.hub.name`, zone.id, zone.hub.name, false, out);
    // Amendment #4: POI / map-point labels (short place names -> name-scan).
    (zone.pois ?? []).forEach((poi, i) => {
      scanNameValue(`zones.${zone.id}.pois.${i}.label`, zone.id, poi.label, false, out);
    });
  }

  // The explicit C1 prose fields (quest/greeting prose ONLY - see PROSE_SCAN).
  for (const [id, quest] of Object.entries(QUESTS)) {
    scanProseValue(`quests.${id}.text`, id, quest.text, out);
    scanProseValue(`quests.${id}.completionText`, id, quest.completionText, out);
    quest.objectives.forEach((obj, i) => {
      scanProseValue(`quests.${id}.objectives.${i}.label`, id, obj.label, out);
    });
  }
  for (const [id, npc] of Object.entries(NPCS)) {
    scanProseValue(`npcs.${id}.greeting`, id, npc.greeting, out);
  }

  // Amendment #4: ability/talent tooltip DESCRIPTION prose (PROSE_SCAN set).
  scanDescriptions(ABILITIES, 'abilities', out);
  scanDescriptions(TALENTS, 'talents', out);
  scanDescriptions(ROW_TREES, 'talentRows', out);

  // Amendment #4: scripted encounter/delve DIALOGUE (prose-scan the string
  // literals of the source files, since the lines are inline, not exported).
  for (const rel of DIALOGUE_SOURCES) {
    const src = readFileSync(path.join(root, rel), 'utf8');
    for (const m of src.matchAll(STRING_LITERAL_RE)) {
      scanProseValue(`dialogue:${rel}`, rel, m[2], out);
    }
  }

  // The resolved English i18n table, so a stale or hand-drifted resolved
  // layer is caught independently of the sim source.
  scanResolvedTable(en, 'i18n.en', false, out);

  return out;
}

describe('ip_scrub - verbatim-WoW denylist scanner (G0)', () => {
  it('arms a non-empty denylist seeded from the NAME-MAP old column plus the hardcoded verbatim list', () => {
    expect(DENYLIST.length).toBeGreaterThanOrEqual(HARDCODED_VERBATIM.length);
    // Map-derived sample rows present today (these three arm ONLY via the
    // NAME-MAP parse, so this also proves the parse is not silently broken;
    // G1's LOCK finalizes the source).
    const texts = DENYLIST.map((e) => e.text);
    expect(texts).toContain('Bloodthirst');
    expect(texts).toContain('Slimy Murloc Scale');
    expect(texts).toContain('Ice Barrier');
  });

  it('teeth: the resolved-table walk visits the generated English layer (not a silent no-op)', () => {
    const entities = (en as unknown as { entities?: unknown }).entities;
    expect(entities, 'resolved table lost its entities subtree').toBeTruthy();
    const nameFields = scanResolvedTable(en, 'i18n.en', false, []);
    // ~150 abilities + ~134 items + mobs + npcs + quests + more; a hard floor
    // well below reality but far above zero catches a broken walk.
    expect(nameFields).toBeGreaterThan(300);
  });

  it('teeth: the Amendment #4 category scans (POI labels, descriptions, dialogue) are non-vacuous', () => {
    const poiCount = ZONES.reduce((n, z) => n + (z.pois?.length ?? 0), 0);
    // ~28 map POIs across the zones today; a hard floor far above zero.
    expect(poiCount, 'POI labels vanished from ZONES - POI scan would be a no-op').toBeGreaterThan(
      15,
    );
    const descCount = Object.values(ABILITIES).filter(
      (a) => typeof (a as { description?: unknown }).description === 'string',
    ).length;
    expect(
      descCount,
      'ability descriptions vanished - description scan would be a no-op',
    ).toBeGreaterThan(50);
    for (const rel of DIALOGUE_SOURCES) {
      const src = readFileSync(path.join(root, rel), 'utf8');
      const literals = [...src.matchAll(STRING_LITERAL_RE)].length;
      expect(
        literals,
        `dialogue source ${rel} unreadable/empty - dialogue scan would be a no-op`,
      ).toBeGreaterThan(5);
    }
  });

  it('never arms a generic-keep? name (operator-controlled via the NAME-MAP flag)', () => {
    const genericKeep = parseGenericKeep(nameMapMarkdown);
    expect(genericKeep.length).toBeGreaterThan(0); // Charge, Execute, ...
    const armed = new Set(DENYLIST.map((e) => e.text.toLowerCase()));
    for (const name of genericKeep) {
      expect(armed.has(name.toLowerCase()), `generic-keep? name "${name}" must not be armed`).toBe(
        false,
      );
    }
  });

  it("teeth: reports ZERO hits on the game's own original names", () => {
    const fixture = [
      'Gravecaller',
      'Wyrmcult',
      'Nythraxis',
      'Korzul the Gravewyrm',
      'Voskar the Emberwing',
      'Eastbrook Vale',
      'Mirefen Marsh',
      'Thornpeak Heights',
      'Reaver Strike',
    ];
    const out: Violation[] = [];
    fixture.forEach((name, i) => {
      scanNameValue(`fixture.${i}.name`, `fixture_${i}`, name, true, out);
    });
    expect(out).toEqual([]);
  });

  it('teeth: fires exactly once when one denylisted name joins the original-name fixture', () => {
    const fixture = ['Gravecaller', 'Nythraxis', 'Reaver Strike', 'Frostbolt'];
    const out: Violation[] = [];
    fixture.forEach((name, i) => {
      scanNameValue(`fixture.${i}.name`, `fixture_${i}`, name, true, out);
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      denylistEntry: 'Frostbolt',
      field: 'fixture.3.name',
      id: 'fixture_3',
      value: 'Frostbolt',
    });
  });

  it('teeth: generic English prose does not trip the scanner', () => {
    const out: Violation[] = [];
    scanProseValue(
      'fixture.prose',
      'fixture',
      'Hurl a bolt of fire and strike the target on holy ground.',
      out,
    );
    scanNameValue('fixture.name', 'fixture', 'Firebrand of the Vale', true, out);
    expect(out).toEqual([]);
  });

  it('is deterministic: two scans over the same tree produce the identical violation list', () => {
    const a = collectViolations();
    const b = collectViolations();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  // THE GATE. RED today by design: this failing list is the rename worklist
  // (seeded in ip-refactor/02-WORKING-MEMORY.md). The V/C/W/T tracks turn it
  // green by applying the LOCKED NAME-MAP; Z1 requires zero residual.
  it('player-visible display fields contain no denylisted WoW name', () => {
    const violations = collectViolations();
    const byEntry = new Map<string, number>();
    for (const v of violations)
      byEntry.set(v.denylistEntry, (byEntry.get(v.denylistEntry) ?? 0) + 1);
    const summary = [...byEntry.entries()]
      .map(([entry, count]) => `  ${entry}: ${count}`)
      .join('\n');
    expect(
      violations,
      `${violations.length} denylisted name occurrence(s) in player-visible fields ` +
        `(the G0 baseline worklist - cleared by the V/C/W/T rename tracks):\n${summary}`,
    ).toEqual([]);
  });
});
