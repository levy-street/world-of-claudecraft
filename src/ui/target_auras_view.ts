import type { AuraSlotState, AurasState } from './auras_view';

export interface TargetAuraWindowRow {
  key: string;
  iconKey: string;
  school: string;
  durationText: string;
  stacksText: string;
  name: string;
  sourceName: string;
  remaining: number;
  remainingFraction: number;
  effectHtml: string;
  own: boolean;
  expiring: boolean;
}

export interface TargetAurasWindowView {
  debuffs: TargetAuraWindowRow[];
  buffs: TargetAuraWindowRow[];
  debuffCount: number;
  buffCount: number;
  debuffTotal: number;
  buffTotal: number;
}

export type TargetAuraFilter = 'all' | 'debuffs' | 'buffs';

function remainingFraction(slot: AuraSlotState): number {
  const duration = slot.duration;
  if (duration === undefined || !Number.isFinite(duration)) return 1;
  if (duration <= 0) return 0;
  return Math.min(1, Math.max(0, slot.remaining / duration));
}

function makeRow(): TargetAuraWindowRow {
  return {
    key: '',
    iconKey: '',
    school: '',
    durationText: '',
    stacksText: '',
    name: '',
    sourceName: '',
    remaining: 0,
    remainingFraction: 0,
    effectHtml: '',
    own: false,
    expiring: false,
  };
}

function updateRow(
  row: TargetAuraWindowRow,
  slot: AuraSlotState,
  sourceName: (sourceId: number | undefined) => string,
): void {
  row.key = slot.key;
  row.iconKey = slot.iconKey;
  row.school = slot.school;
  row.durationText = slot.durationText;
  row.stacksText = slot.stacksText;
  row.name = slot.name;
  row.sourceName = sourceName(slot.sourceId);
  row.remaining = slot.remaining;
  row.remainingFraction = remainingFraction(slot);
  row.effectHtml = slot.effectHtml;
  row.own = slot.own;
  row.expiring = slot.expiring;
}

export interface TargetAurasWindowViewCore {
  tick(
    state: AurasState,
    sourceName: (sourceId: number | undefined) => string,
    filter?: TargetAuraFilter,
  ): TargetAurasWindowView;
}

/** Resolve an aura caster without inventing attribution when an older wire or
 * interest scope does not provide the entity. */
export function targetAuraSourceName<T>(
  sourceId: number | undefined,
  entityById: (id: number) => T | undefined,
  displayName: (entity: T) => string,
): string {
  if (!sourceId) return '';
  const source = entityById(sourceId);
  return source === undefined ? '' : displayName(source);
}

/** Create the allocation-light derivation for both panel sections. Two stable
 * passes promote local-player auras before the raid's. Every aura remains
 * available through the section scroller; arrays and row objects grow only to
 * their high-water marks. */
export function createTargetAurasWindowView(): TargetAurasWindowViewCore {
  const debuffs: TargetAuraWindowRow[] = [];
  const buffs: TargetAuraWindowRow[] = [];
  const view: TargetAurasWindowView = {
    debuffs,
    buffs,
    debuffCount: 0,
    buffCount: 0,
    debuffTotal: 0,
    buffTotal: 0,
  };

  return {
    tick(state, sourceName, filter = 'all'): TargetAurasWindowView {
      let debuffCount = 0;
      let buffCount = 0;
      let debuffTotal = 0;
      let buffTotal = 0;
      for (let i = 0; i < state.count; i++) {
        if (state.slots[i].isDebuff) debuffTotal++;
        else buffTotal++;
      }
      for (let ownershipPass = 0; ownershipPass < 2; ownershipPass++) {
        const own = ownershipPass === 0;
        for (let i = 0; i < state.count; i++) {
          const slot = state.slots[i];
          if (slot.own !== own) continue;
          if (slot.isDebuff) {
            if (filter === 'buffs') continue;
            if (debuffCount >= debuffs.length) debuffs.push(makeRow());
            updateRow(debuffs[debuffCount++], slot, sourceName);
          } else {
            if (filter === 'debuffs') continue;
            if (buffCount >= buffs.length) buffs.push(makeRow());
            updateRow(buffs[buffCount++], slot, sourceName);
          }
        }
      }
      view.debuffCount = debuffCount;
      view.buffCount = buffCount;
      view.debuffTotal = debuffTotal;
      view.buffTotal = buffTotal;
      return view;
    },
  };
}
