import {
  GUILD_TREND_LETTERS,
  HEROIC_MARK_LETTER,
  type LetterDef,
  MASTER_TIER_LETTERS,
  MASTERY_RESET_LETTER,
  QUEST_LETTERS,
  WELCOME_LETTER,
} from '../sim/content/letters';
import {
  ABILITIES,
  CLASSES,
  DELVES,
  DUNGEONS,
  ITEM_SETS,
  ITEMS,
  MOBS,
  NPCS,
  QUESTS,
  ZONES,
} from '../sim/data';
import type { ItemDef, PlayerClass } from '../sim/types';
import {
  en,
  getLanguage,
  hasTranslation,
  type InterpolationValues,
  type SupportedLanguage,
  supportedLanguages,
  t,
  tOptional,
} from './i18n';
import { ownEntry } from './known_item';

export type EntityTranslationGroup = 'classAbility' | 'item' | 'itemSet' | 'world';
export type EntityTranslationKind =
  | 'class'
  | 'ability'
  | 'item'
  | 'mob'
  | 'npc'
  | 'quest'
  | 'questObjective'
  | 'zone'
  | 'zonePoi'
  | 'dungeon'
  | 'delve'
  | 'itemSet'
  | 'letter';
/** An item set's per-tier bonus field, keyed by the tier's PIECE COUNT rather
 *  than a fixed 2/3/4 triple. Every shipped set used 2, 3 and 4 pieces, and that
 *  assumption was hard coded here, in the i18n catalog builder, and in the
 *  tooltip's field selection, so a set authored with any other breakpoint (the
 *  WARFARE families' 2/4/7) rendered the WRONG tier's text instead of failing.
 *  Generalizing keeps every existing entities.itemSets.*.bonus2/bonus3/bonus4
 *  key byte-stable in the locale overlays and mints only the new counts. */
export type ItemSetBonusField = `bonus${number}`;

/** The piece count a bonus field names, or null when the field is not a bonus
 *  field at all. The ONE place the field-to-count mapping lives. */
export function itemSetBonusPieces(field: string): number | null {
  const matched = /^bonus([1-9][0-9]*)$/.exec(field);
  return matched ? Number(matched[1]) : null;
}

/** The bonus field naming a tier of `pieces` pieces. */
export function itemSetBonusField(pieces: number): ItemSetBonusField {
  return `bonus${pieces}`;
}

export type EntityTranslationField =
  | 'name'
  | 'description'
  | 'title'
  | 'text'
  | 'completion'
  | 'greeting'
  | 'label'
  | 'welcome'
  | 'enterText'
  | 'leaveText'
  | ItemSetBonusField
  | 'sender'
  | 'subject'
  | 'body'
  | AbilitySpecNoteField;

/** Per-spec tooltip note fields (spec-aware ability tooltips): rendered only
 *  for the player's current specialization. One literal per spec that carries
 *  notes today, so a typo'd spec id fails the type check. */
export type AbilitySpecNoteField =
  | 'specNote_assassination'
  | 'specNote_combat'
  | 'specNote_subtlety'
  | 'specNote_balance'
  | 'specNote_feral'
  | 'specNote_restoration';

export type EntityTranslationRequest =
  | { kind: 'class'; id: PlayerClass; field: 'name' | 'description'; values?: InterpolationValues }
  | {
      kind: 'ability';
      id: string;
      field: 'name' | 'description' | AbilitySpecNoteField;
      values?: InterpolationValues;
    }
  | { kind: 'item'; id: string; field: 'name'; values?: InterpolationValues }
  | {
      kind: 'itemSet';
      id: string;
      field: 'name' | ItemSetBonusField;
      values?: InterpolationValues;
    }
  | { kind: 'mob'; id: string; field: 'name'; values?: InterpolationValues }
  | { kind: 'npc'; id: string; field: 'name' | 'title' | 'greeting'; values?: InterpolationValues }
  | {
      kind: 'quest';
      id: string;
      field: 'title' | 'text' | 'completion';
      values?: InterpolationValues;
    }
  | {
      kind: 'questObjective';
      questId: string;
      objectiveIndex: number;
      field: 'label';
      values?: InterpolationValues;
    }
  | { kind: 'zone'; id: string; field: 'name' | 'welcome'; values?: InterpolationValues }
  | {
      kind: 'zonePoi';
      zoneId: string;
      poiIndex: number;
      field: 'label';
      values?: InterpolationValues;
    }
  | {
      kind: 'dungeon';
      id: string;
      field: 'name' | 'enterText' | 'leaveText';
      values?: InterpolationValues;
    }
  | {
      kind: 'delve';
      id: string;
      field: 'name' | 'enterText' | 'leaveText';
      values?: InterpolationValues;
    }
  | {
      kind: 'letter';
      id: string;
      field: 'sender' | 'subject' | 'body';
      values?: InterpolationValues;
    };

export interface EntityTranslationManifestEntry {
  kind: EntityTranslationKind;
  id: string;
  field: EntityTranslationField;
  key: string;
  source: string;
  group: EntityTranslationGroup;
}

export interface MissingEntityTranslation extends EntityTranslationManifestEntry {
  missingLocales: SupportedLanguage[];
}

export interface EntityTranslationFallback extends EntityTranslationManifestEntry {
  language: SupportedLanguage;
  value: string;
}

const CLASS_NAME_KEYS: Record<PlayerClass, string> = {
  warrior: 'classes.warrior',
  paladin: 'classes.paladin',
  hunter: 'classes.hunter',
  rogue: 'classes.rogue',
  priest: 'classes.priest',
  shaman: 'classes.shaman',
  mage: 'classes.mage',
  warlock: 'classes.warlock',
  druid: 'classes.druid',
};

const CLASS_DESCRIPTION_KEYS: Record<PlayerClass, string> = {
  warrior: 'classDetails.lore.warrior',
  paladin: 'classDetails.lore.paladin',
  hunter: 'classDetails.lore.hunter',
  rogue: 'classDetails.lore.rogue',
  priest: 'classDetails.lore.priest',
  shaman: 'classDetails.lore.shaman',
  mage: 'classDetails.lore.mage',
  warlock: 'classDetails.lore.warlock',
  druid: 'classDetails.lore.druid',
};

const fallbackLog = new Map<string, EntityTranslationFallback>();

// Ravenpost authored letters by letterId (the welcome letter, the Heroic Marks
// reward letter, the quest thank-you letters, and the Guild trend letters), the
// canonical English source the 'letter' kind reads.
const LETTERS_BY_ID: Record<string, LetterDef> = {
  [WELCOME_LETTER.letterId]: WELCOME_LETTER,
  [HEROIC_MARK_LETTER.letterId]: HEROIC_MARK_LETTER,
  [MASTERY_RESET_LETTER.letterId]: MASTERY_RESET_LETTER,
};
for (const letter of Object.values(QUEST_LETTERS)) LETTERS_BY_ID[letter.letterId] = letter;
for (const letter of Object.values(GUILD_TREND_LETTERS)) LETTERS_BY_ID[letter.letterId] = letter;
for (const byTier of Object.values(MASTER_TIER_LETTERS)) {
  for (const letter of Object.values(byTier)) LETTERS_BY_ID[letter.letterId] = letter;
}

/** Whether THIS bundle ships the authored letter (stale-client guard, R34):
 *  the mail window falls back to the WIRE-shipped sender/subject/body for an
 *  id this bundle predates, instead of rendering the raw letter id. */
export function knownLetterId(letterId: string): boolean {
  return Object.hasOwn(LETTERS_BY_ID, letterId);
}

function entityPathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, '_');
}

function entry(
  kind: EntityTranslationKind,
  id: string,
  field: EntityTranslationField,
  source: string,
  group: EntityTranslationGroup,
  key: string,
): EntityTranslationManifestEntry {
  return { kind, id, field, source, group, key };
}

function compareById<T extends { id: string }>(a: T, b: T): number {
  return a.id.localeCompare(b.id);
}

function interpolateSource(source: string, values?: InterpolationValues): string {
  if (!values) return source;
  const className = values.classNameLower ?? values.className ?? '$C';
  const legacy = source
    .replace(/\$N/g, String(values.playerName ?? values.name ?? '$N'))
    .replace(/\$C/g, String(className))
    .replace(/\$d/g, String(values.damage ?? values.d ?? '$d'))
    // Ability-description placeholders beyond the damage number: a hybrid's
    // over-time total ($o), the first buff's resolved value ($b), the first
    // timed effect's resolved duration ($t); hud.ts supplies all three.
    .replace(/\$o/g, String(values.overTime ?? '$o'))
    .replace(/\$b/g, String(values.buff ?? '$b'))
    .replace(/\$t/g, String(values.duration ?? '$t'))
    .replace(/\$h/g, String(values.healing ?? '$h'))
    .replace(/\$e/g, String(values.hostilePveDuration ?? '$e'))
    .replace(/\$p/g, String(values.hostilePvpDuration ?? '$p'))
    .replace(/\$g/g, String(values.groundDuration ?? '$g'))
    .replace(/\$s/g, String(values.selfCooldownRecovery ?? '$s'))
    .replace(/\$a/g, String(values.allyCooldownRecovery ?? '$a'));
  return legacy.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name: string) => {
    const value = values[name];
    return value === undefined ? match : String(value);
  });
}

function classDescriptionSource(id: PlayerClass): string {
  return en.classDetails.lore[id];
}

function canonicalEntityText(request: EntityTranslationRequest): string {
  switch (request.kind) {
    case 'class':
      return request.field === 'name'
        ? (CLASSES[request.id]?.name ?? request.id)
        : classDescriptionSource(request.id);
    case 'ability': {
      const ability = ABILITIES[request.id];
      if (!ability) return request.id;
      return request.field === 'name' ? ability.name : ability.description;
    }
    case 'item':
      return ITEMS[request.id]?.name ?? request.id;
    // Every Record-indexed arm below reads through ownEntry (known_item.ts):
    // these ids can arrive from the wire (the quest log, chat links, snapshot
    // template ids), and on a prototype-bearing Record a bare truthiness test
    // sends 'constructor' down the known arm, where the Function's missing
    // fields render as "Object"/undefined or throw (set.bonuses.find). The
    // raw-id fallback is the R34 contract for every unknown id, prototype
    // keys included.
    case 'itemSet': {
      const set = ownEntry(ITEM_SETS, request.id);
      if (!set) return request.id;
      if (request.field === 'name') return set.name;
      // Piece-count agnostic (see ItemSetBonusField): the field NAMES its tier,
      // so a 7-piece breakpoint resolves without a fifth ternary arm, and an
      // unknown field falls back to the raw id like every other R34 miss.
      const pieces = itemSetBonusPieces(request.field);
      if (pieces === null) return request.id;
      return set.bonuses.find((b) => b.pieces === pieces)?.text ?? request.id;
    }
    case 'mob':
      return ownEntry(MOBS, request.id)?.name ?? request.id;
    case 'npc': {
      const npc = ownEntry(NPCS, request.id);
      if (!npc) return request.id;
      if (request.field === 'title') return npc.title;
      if (request.field === 'greeting') return npc.greeting;
      return npc.name;
    }
    case 'quest': {
      const quest = ownEntry(QUESTS, request.id);
      if (!quest) return request.id;
      if (request.field === 'text') return quest.text;
      if (request.field === 'completion') return quest.completionText;
      return quest.name;
    }
    case 'questObjective':
      return (
        ownEntry(QUESTS, request.questId)?.objectives[request.objectiveIndex]?.label ??
        `${request.questId}.${request.objectiveIndex}`
      );
    case 'zone': {
      const zone = ZONES.find((candidate) => candidate.id === request.id);
      if (!zone) return request.id;
      return request.field === 'welcome' ? zone.welcome : zone.name;
    }
    case 'zonePoi': {
      const zone = ZONES.find((candidate) => candidate.id === request.zoneId);
      return zone?.pois[request.poiIndex]?.label ?? `${request.zoneId}.pois.${request.poiIndex}`;
    }
    case 'dungeon': {
      const dungeon = DUNGEONS[request.id];
      if (!dungeon) return request.id;
      if (request.field === 'enterText') return dungeon.enterText;
      if (request.field === 'leaveText') return dungeon.leaveText;
      return dungeon.name;
    }
    case 'delve': {
      const delve = DELVES[request.id];
      if (!delve) return request.id;
      if (request.field === 'enterText') return delve.enterText;
      if (request.field === 'leaveText') return delve.leaveText;
      return delve.name;
    }
    case 'letter': {
      const letter = LETTERS_BY_ID[request.id];
      if (!letter) return request.id;
      if (request.field === 'sender') return letter.senderName;
      if (request.field === 'body') return letter.body;
      return letter.subject;
    }
  }
}

export function entityTranslationKey(request: EntityTranslationRequest): string {
  switch (request.kind) {
    case 'class':
      return request.field === 'name'
        ? CLASS_NAME_KEYS[request.id]
        : CLASS_DESCRIPTION_KEYS[request.id];
    case 'ability':
      return `entities.abilities.${entityPathSegment(request.id)}.${request.field}`;
    case 'item':
      return `entities.items.${entityPathSegment(request.id)}.name`;
    case 'itemSet':
      return `entities.itemSets.${entityPathSegment(request.id)}.${request.field}`;
    case 'mob':
      return `entities.mobs.${entityPathSegment(request.id)}.name`;
    case 'npc':
      return `entities.npcs.${entityPathSegment(request.id)}.${request.field}`;
    case 'quest':
      return `entities.quests.${entityPathSegment(request.id)}.${request.field}`;
    case 'questObjective':
      return `entities.quests.${entityPathSegment(request.questId)}.objectives.${request.objectiveIndex}.label`;
    case 'zone':
      return `entities.zones.${entityPathSegment(request.id)}.${request.field}`;
    case 'zonePoi':
      return `entities.zones.${entityPathSegment(request.zoneId)}.pois.${request.poiIndex}.label`;
    case 'dungeon':
      return `entities.dungeons.${entityPathSegment(request.id)}.${request.field}`;
    case 'delve':
      return `entities.delves.${entityPathSegment(request.id)}.${request.field}`;
    case 'letter':
      return `entities.letters.${entityPathSegment(request.id)}.${request.field}`;
  }
}

// tEntity sits on per-frame paths (nameplates, aura names, HUD frames), and
// entityTranslationKey allocates a template literal plus runs the
// entityPathSegment regex on EVERY call for ids that never change
// (hitch-elimination B3). The nested memo serves a stable (kind, id, field)
// triple with three Map reads and zero allocation. Keys derive only from
// static content ids, never from the locale, so the memo never invalidates
// (the localized TEXT memo lives in i18n.ts behind the resolution revision).
// The compound kinds (questObjective, zonePoi) carry an index and stay on the
// direct builder: their surfaces (quest log, map POIs) are cold.
// No eviction on purpose: the ids that arrive at runtime (loot and mail entity
// ids, wire snapshots) all name entities shipped in src/sim/content, so the
// memo stays bounded by the static content catalog.
const entityKeyMemo = new Map<EntityTranslationKind, Map<string, Map<string, string>>>();

function cachedEntityTranslationKey(request: EntityTranslationRequest): string {
  if (request.kind === 'questObjective' || request.kind === 'zonePoi') {
    return entityTranslationKey(request);
  }
  let byId = entityKeyMemo.get(request.kind);
  if (!byId) {
    byId = new Map();
    entityKeyMemo.set(request.kind, byId);
  }
  let byField = byId.get(request.id);
  if (!byField) {
    byField = new Map();
    byId.set(request.id, byField);
  }
  let key = byField.get(request.field);
  if (key === undefined) {
    key = entityTranslationKey(request);
    byField.set(request.field, key);
  }
  return key;
}

function requestManifestEntry(request: EntityTranslationRequest): EntityTranslationManifestEntry {
  const id =
    request.kind === 'questObjective'
      ? `${request.questId}.objectives.${request.objectiveIndex}`
      : request.kind === 'zonePoi'
        ? `${request.zoneId}.pois.${request.poiIndex}`
        : request.id;
  const group: EntityTranslationGroup =
    request.kind === 'class' || request.kind === 'ability'
      ? 'classAbility'
      : request.kind === 'itemSet'
        ? 'itemSet'
        : request.kind === 'item'
          ? 'item'
          : 'world';
  return entry(
    request.kind,
    id,
    request.field,
    canonicalEntityText(request),
    group,
    entityTranslationKey(request),
  );
}

function recordFallback(request: EntityTranslationRequest, value: string): void {
  const manifestEntry = requestManifestEntry(request);
  const language = getLanguage();
  fallbackLog.set(`${language}:${manifestEntry.key}`, { ...manifestEntry, language, value });
}

export function tEntity(request: EntityTranslationRequest): string {
  const key = cachedEntityTranslationKey(request);
  const translated = tOptional(key, request.values);
  if (translated !== null) return translated;
  const fallback = interpolateSource(canonicalEntityText(request), request.values);
  recordFallback(request, fallback);
  return fallback;
}

export function itemDisplayName(item: ItemDef): string {
  // Heroic upgraded variants share the base item's name (classic behavior: a heroic
  // drop reads the same as its normal counterpart). The heroic distinction shows as
  // an "[HEROIC]" tag on the tooltip's quality/kind line, not in the name, so a
  // variant never needs its own translated name key.
  if (item.heroicOf) {
    const base = ITEMS[item.heroicOf];
    return base ? itemDisplayName(base) : item.heroicOf;
  }
  return tEntity({ kind: 'item', id: item.id, field: 'name' });
}

// Thin tEntity wrappers for the display helpers that several windows + painters each
// re-declared (class/zone/poi/dungeon names). Mirroring itemDisplayName above, these are
// the single shared home so hud.ts, the cold windows, and map_window_painter import one
// definition instead of redefining it per module.
export function classDisplayName(cls: PlayerClass): string {
  return tEntity({ kind: 'class', id: cls, field: 'name' });
}

export function zoneDisplayName(zoneId: string): string {
  return tEntity({ kind: 'zone', id: zoneId, field: 'name' });
}

export function zonePoiLabel(zoneId: string, poiIndex: number): string {
  return tEntity({ kind: 'zonePoi', zoneId, poiIndex, field: 'label' });
}

export function dungeonDisplayName(dungeonId: string): string {
  return tEntity({ kind: 'dungeon', id: dungeonId, field: 'name' });
}

/** The label a live rift floor (IWorld.riftFloor) shows wherever a surface needs
 *  display text for it: the generated floor name, plus its C/B/A/S rank in
 *  parens (omitted for a dev-portal run, whose tier is null). Not a tEntity
 *  wrapper (the name/rank come from the generated RiftFloorView, not a content
 *  id lookup); the single shared home so the minimap, the world map, and the
 *  map-window summary format it identically instead of each re-declaring the
 *  same rank ? label ternary. */
export function riftFloorLabel(name: string, rank: string | null): string {
  return rank ? t('hud.core.riftLabelRanked', { name, rank }) : t('hud.core.riftLabel', { name });
}

export function resetEntityTranslationFallbackLog(): void {
  fallbackLog.clear();
}

export function entityTranslationFallbackLog(): EntityTranslationFallback[] {
  return [...fallbackLog.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function entityTranslationManifest(): EntityTranslationManifestEntry[] {
  const entries: EntityTranslationManifestEntry[] = [];
  const classIds = Object.keys(CLASSES).sort() as PlayerClass[];
  for (const id of classIds) {
    entries.push(entry('class', id, 'name', CLASSES[id].name, 'classAbility', CLASS_NAME_KEYS[id]));
    entries.push(
      entry(
        'class',
        id,
        'description',
        classDescriptionSource(id),
        'classAbility',
        CLASS_DESCRIPTION_KEYS[id],
      ),
    );
  }
  for (const ability of Object.values(ABILITIES).sort(compareById)) {
    entries.push(
      entry(
        'ability',
        ability.id,
        'name',
        ability.name,
        'classAbility',
        entityTranslationKey({ kind: 'ability', id: ability.id, field: 'name' }),
      ),
    );
    entries.push(
      entry(
        'ability',
        ability.id,
        'description',
        ability.description,
        'classAbility',
        entityTranslationKey({ kind: 'ability', id: ability.id, field: 'description' }),
      ),
    );
    for (const [spec, note] of Object.entries(ability.specNotes ?? {}).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const field = `specNote_${spec}` as AbilitySpecNoteField;
      entries.push(
        entry(
          'ability',
          ability.id,
          field,
          note,
          'classAbility',
          entityTranslationKey({ kind: 'ability', id: ability.id, field }),
        ),
      );
    }
  }
  for (const item of Object.values(ITEMS).sort(compareById)) {
    // Heroic upgraded variants carry no name key: they share the base item's name
    // (see itemDisplayName), so they never enter the manifest.
    if (item.heroicOf) continue;
    entries.push(
      entry(
        'item',
        item.id,
        'name',
        item.name,
        'item',
        entityTranslationKey({ kind: 'item', id: item.id, field: 'name' }),
      ),
    );
  }
  for (const set of Object.values(ITEM_SETS).sort(compareById)) {
    // Only tiers the set actually has, at WHATEVER piece counts it authored:
    // the leveling haste kits carry a single 3-piece tier (so registering a
    // bonus2 row would emit an id-fallback string) and the WARFARE families
    // carry 2/4/7. Ascending and de-duplicated so the manifest order is stable.
    const fields: ('name' | ItemSetBonusField)[] = ['name'];
    for (const pieces of [...new Set(set.bonuses.map((b) => b.pieces))].sort((a, b) => a - b)) {
      fields.push(itemSetBonusField(pieces));
    }
    for (const field of fields) {
      entries.push(
        entry(
          'itemSet',
          set.id,
          field,
          canonicalEntityText({ kind: 'itemSet', id: set.id, field }),
          'itemSet',
          entityTranslationKey({ kind: 'itemSet', id: set.id, field }),
        ),
      );
    }
  }
  for (const mob of Object.values(MOBS).sort(compareById)) {
    entries.push(
      entry(
        'mob',
        mob.id,
        'name',
        mob.name,
        'world',
        entityTranslationKey({ kind: 'mob', id: mob.id, field: 'name' }),
      ),
    );
  }
  for (const npc of Object.values(NPCS).sort(compareById)) {
    entries.push(
      entry(
        'npc',
        npc.id,
        'name',
        npc.name,
        'world',
        entityTranslationKey({ kind: 'npc', id: npc.id, field: 'name' }),
      ),
    );
    entries.push(
      entry(
        'npc',
        npc.id,
        'title',
        npc.title,
        'world',
        entityTranslationKey({ kind: 'npc', id: npc.id, field: 'title' }),
      ),
    );
    entries.push(
      entry(
        'npc',
        npc.id,
        'greeting',
        npc.greeting,
        'world',
        entityTranslationKey({ kind: 'npc', id: npc.id, field: 'greeting' }),
      ),
    );
  }
  for (const quest of Object.values(QUESTS).sort(compareById)) {
    entries.push(
      entry(
        'quest',
        quest.id,
        'title',
        quest.name,
        'world',
        entityTranslationKey({ kind: 'quest', id: quest.id, field: 'title' }),
      ),
    );
    entries.push(
      entry(
        'quest',
        quest.id,
        'text',
        quest.text,
        'world',
        entityTranslationKey({ kind: 'quest', id: quest.id, field: 'text' }),
      ),
    );
    entries.push(
      entry(
        'quest',
        quest.id,
        'completion',
        quest.completionText,
        'world',
        entityTranslationKey({ kind: 'quest', id: quest.id, field: 'completion' }),
      ),
    );
    quest.objectives.forEach((objective, objectiveIndex) => {
      entries.push(
        entry(
          'questObjective',
          `${quest.id}.objectives.${objectiveIndex}`,
          'label',
          objective.label,
          'world',
          entityTranslationKey({
            kind: 'questObjective',
            questId: quest.id,
            objectiveIndex,
            field: 'label',
          }),
        ),
      );
    });
  }
  for (const zone of [...ZONES].sort(compareById)) {
    entries.push(
      entry(
        'zone',
        zone.id,
        'name',
        zone.name,
        'world',
        entityTranslationKey({ kind: 'zone', id: zone.id, field: 'name' }),
      ),
    );
    entries.push(
      entry(
        'zone',
        zone.id,
        'welcome',
        zone.welcome,
        'world',
        entityTranslationKey({ kind: 'zone', id: zone.id, field: 'welcome' }),
      ),
    );
    zone.pois.forEach((poi, poiIndex) => {
      entries.push(
        entry(
          'zonePoi',
          `${zone.id}.pois.${poiIndex}`,
          'label',
          poi.label,
          'world',
          entityTranslationKey({ kind: 'zonePoi', zoneId: zone.id, poiIndex, field: 'label' }),
        ),
      );
    });
  }
  for (const dungeon of Object.values(DUNGEONS).sort(compareById)) {
    entries.push(
      entry(
        'dungeon',
        dungeon.id,
        'name',
        dungeon.name,
        'world',
        entityTranslationKey({ kind: 'dungeon', id: dungeon.id, field: 'name' }),
      ),
    );
    entries.push(
      entry(
        'dungeon',
        dungeon.id,
        'enterText',
        dungeon.enterText,
        'world',
        entityTranslationKey({ kind: 'dungeon', id: dungeon.id, field: 'enterText' }),
      ),
    );
    entries.push(
      entry(
        'dungeon',
        dungeon.id,
        'leaveText',
        dungeon.leaveText,
        'world',
        entityTranslationKey({ kind: 'dungeon', id: dungeon.id, field: 'leaveText' }),
      ),
    );
  }
  for (const delve of Object.values(DELVES).sort(compareById)) {
    entries.push(
      entry(
        'delve',
        delve.id,
        'name',
        delve.name,
        'world',
        entityTranslationKey({ kind: 'delve', id: delve.id, field: 'name' }),
      ),
    );
    entries.push(
      entry(
        'delve',
        delve.id,
        'enterText',
        delve.enterText,
        'world',
        entityTranslationKey({ kind: 'delve', id: delve.id, field: 'enterText' }),
      ),
    );
    entries.push(
      entry(
        'delve',
        delve.id,
        'leaveText',
        delve.leaveText,
        'world',
        entityTranslationKey({ kind: 'delve', id: delve.id, field: 'leaveText' }),
      ),
    );
  }
  for (const letter of Object.values(LETTERS_BY_ID).sort((a, b) =>
    a.letterId.localeCompare(b.letterId),
  )) {
    const fields: ('sender' | 'subject' | 'body')[] = ['sender', 'subject', 'body'];
    for (const field of fields) {
      entries.push(
        entry(
          'letter',
          letter.letterId,
          field,
          canonicalEntityText({ kind: 'letter', id: letter.letterId, field }),
          'world',
          entityTranslationKey({ kind: 'letter', id: letter.letterId, field }),
        ),
      );
    }
  }
  return entries;
}

export function missingEntityTranslationsForGroups(
  completedGroups: readonly EntityTranslationGroup[],
): MissingEntityTranslation[] {
  const groupSet = new Set(completedGroups);
  return entityTranslationManifest()
    .filter((manifestEntry) => groupSet.has(manifestEntry.group))
    .map((manifestEntry) => ({
      ...manifestEntry,
      missingLocales: supportedLanguages.filter((lang) => !hasTranslation(manifestEntry.key, lang)),
    }))
    .filter((manifestEntry) => manifestEntry.missingLocales.length > 0);
}

export function assertEntityTranslationsReady(
  completedGroups: readonly EntityTranslationGroup[],
): void {
  const missing = missingEntityTranslationsForGroups(completedGroups);
  if (missing.length === 0) return;
  const preview = missing
    .slice(0, 5)
    .map((entry) => entry.key)
    .join(', ');
  throw new Error(
    `Missing entity translations: ${missing.length} keys. First missing keys: ${preview}`,
  );
}
