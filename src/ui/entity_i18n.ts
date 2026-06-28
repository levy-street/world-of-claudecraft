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
  tOptional,
} from './i18n';

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
  | 'itemSet';
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
  | 'bonus2'
  | 'bonus3';

export type EntityTranslationRequest =
  | { kind: 'class'; id: PlayerClass; field: 'name' | 'description'; values?: InterpolationValues }
  | { kind: 'ability'; id: string; field: 'name' | 'description'; values?: InterpolationValues }
  | { kind: 'item'; id: string; field: 'name'; values?: InterpolationValues }
  | {
      kind: 'itemSet';
      id: string;
      field: 'name' | 'bonus2' | 'bonus3';
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
    .replace(/\$d/g, String(values.damage ?? values.d ?? '$d'));
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
    case 'itemSet': {
      const set = ITEM_SETS[request.id];
      if (!set) return request.id;
      if (request.field === 'name') return set.name;
      const pieces = request.field === 'bonus2' ? 2 : 3;
      return set.bonuses.find((b) => b.pieces === pieces)?.text ?? request.id;
    }
    case 'mob':
      return MOBS[request.id]?.name ?? request.id;
    case 'npc': {
      const npc = NPCS[request.id];
      if (!npc) return request.id;
      if (request.field === 'title') return npc.title;
      if (request.field === 'greeting') return npc.greeting;
      return npc.name;
    }
    case 'quest': {
      const quest = QUESTS[request.id];
      if (!quest) return request.id;
      if (request.field === 'text') return quest.text;
      if (request.field === 'completion') return quest.completionText;
      return quest.name;
    }
    case 'questObjective':
      return (
        QUESTS[request.questId]?.objectives[request.objectiveIndex]?.label ??
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
  }
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
  const key = entityTranslationKey(request);
  const translated = tOptional(key, request.values);
  if (translated !== null) return translated;
  const fallback = interpolateSource(canonicalEntityText(request), request.values);
  recordFallback(request, fallback);
  return fallback;
}

export function itemDisplayName(item: ItemDef): string {
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
  }
  for (const item of Object.values(ITEMS).sort(compareById)) {
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
    const fields: ('name' | 'bonus2' | 'bonus3')[] = ['name', 'bonus2', 'bonus3'];
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
