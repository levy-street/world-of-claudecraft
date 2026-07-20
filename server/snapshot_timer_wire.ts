import type { Aura, Entity } from '../src/sim/types';
import type { StableCooldownWire } from '../src/world_api';

export interface SerializedTimerWire {
  json: string;
  revision: number;
}

export function jsonWithField(objectJson: string, key: string, valueJson: string): string {
  const separator = objectJson === '{}' ? '' : ',';
  return `${objectJson.slice(0, -1)}${separator}"${key}":${valueJson}}`;
}

type CooldownDeadline = StableCooldownWire;

interface StableAuraRecord {
  id: string;
  name: string;
  kind: string;
  duration: number;
  value: number;
  value2: number | undefined;
  value3: number | undefined;
  tickInterval: number | undefined;
  school: string;
  stacks: number | undefined;
  charges: number | undefined;
  empowerAbilities: readonly string[] | undefined;
  sourceId: number;
  unbreakableControl: boolean;
  paused: boolean;
  deadline: number;
}

interface StableAuraWire {
  id: string;
  name: string;
  kind: string;
  dur: number;
  exp?: number;
  rem?: number;
  value?: number;
  value2?: number;
  value3?: number;
  tickInterval?: number;
  school?: string;
  stacks?: number;
  charges?: number;
  emp?: readonly string[];
  src?: number;
  ub?: 1;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function sameStringList(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function auraMatches(
  record: StableAuraRecord,
  aura: Aura,
  simTime: number,
  paused: boolean,
): boolean {
  const deadline = round2(paused ? aura.remaining : simTime + aura.remaining);
  return (
    record.id === aura.id &&
    record.name === aura.name &&
    record.kind === aura.kind &&
    record.duration === aura.duration &&
    record.value === aura.value &&
    record.value2 === aura.value2 &&
    record.value3 === aura.value3 &&
    record.tickInterval === aura.tickInterval &&
    record.school === aura.school &&
    record.stacks === (aura.stacks && aura.stacks > 1 ? aura.stacks : undefined) &&
    record.charges === aura.charges &&
    sameStringList(record.empowerAbilities, aura.empowerAbilities) &&
    record.sourceId === aura.sourceId &&
    record.unbreakableControl === (aura.unbreakableControl === true) &&
    record.paused === paused &&
    record.deadline === deadline
  );
}

function auraRecord(aura: Aura, simTime: number, paused: boolean): StableAuraRecord {
  return {
    id: aura.id,
    name: aura.name,
    kind: aura.kind,
    duration: aura.duration,
    value: aura.value,
    value2: aura.value2,
    value3: aura.value3,
    tickInterval: aura.tickInterval,
    school: aura.school,
    stacks: aura.stacks && aura.stacks > 1 ? aura.stacks : undefined,
    charges: aura.charges,
    empowerAbilities: aura.empowerAbilities ? [...aura.empowerAbilities] : undefined,
    sourceId: aura.sourceId,
    unbreakableControl: aura.unbreakableControl === true,
    paused,
    deadline: round2(paused ? aura.remaining : simTime + aura.remaining),
  };
}

function auraWire(record: StableAuraRecord): StableAuraWire {
  const wire: StableAuraWire = {
    id: record.id,
    name: record.name,
    kind: record.kind,
    dur: record.duration,
  };
  if (record.paused) wire.rem = record.deadline;
  else wire.exp = record.deadline;
  if (record.value !== 0) wire.value = record.value;
  if (record.value2 !== undefined) wire.value2 = record.value2;
  if (record.value3 !== undefined) wire.value3 = record.value3;
  if (record.tickInterval !== undefined) wire.tickInterval = record.tickInterval;
  if (record.school !== 'physical') wire.school = record.school;
  if (record.stacks !== undefined) wire.stacks = record.stacks;
  if (record.charges !== undefined) wire.charges = record.charges;
  if (record.empowerAbilities !== undefined) wire.emp = record.empowerAbilities;
  if (record.sourceId) wire.src = record.sourceId;
  if (record.unbreakableControl) wire.ub = 1;
  return wire;
}

/**
 * Per-entity v2 aura cache. Live countdowns are represented as absolute expiry
 * times, so an ordinary tick does not allocate or stringify a new aura list.
 */
export class StableAuraWireCache {
  private records: StableAuraRecord[] = [];
  private result: SerializedTimerWire | null = null;
  rebuilds = 0;

  encode(auras: readonly Aura[], simTime: number, paused: boolean): SerializedTimerWire {
    let changed = this.records.length !== auras.length;
    if (!changed) {
      for (let i = 0; i < auras.length; i++) {
        if (!auraMatches(this.records[i], auras[i], simTime, paused)) {
          changed = true;
          break;
        }
      }
    }
    if (!changed && this.result) return this.result;

    this.records = auras.map((aura) => auraRecord(aura, simTime, paused));
    this.rebuilds++;
    this.result = {
      json: JSON.stringify(this.records.map(auraWire)),
      revision: this.rebuilds,
    };
    return this.result;
  }
}

function findProtectiveHourglass(auras: readonly Aura[]): Aura | null {
  for (const aura of auras) {
    if (
      aura.id === 'temporal_hourglass' &&
      aura.kind === 'stasis' &&
      aura.remaining > 0 &&
      aura.value > 1
    ) {
      return aura;
    }
  }
  return null;
}

function cooldownDeadline(
  abilityId: string,
  remaining: number,
  simTime: number,
  hourglass: Aura | null,
  dead: boolean,
): CooldownDeadline {
  if (abilityId === 'temporal_hourglass' || !hourglass) return round2(simTime + remaining);
  const rate = hourglass.value;
  const acceleratedFor = dead ? remaining / rate : Math.min(hourglass.remaining, remaining / rate);
  const normalWork = Math.max(0, remaining - acceleratedFor * rate);
  return [round2(simTime + acceleratedFor + normalWork), rate, round2(simTime + acceleratedFor)];
}

function cooldownDeadlineMatches(
  prior: CooldownDeadline | undefined,
  abilityId: string,
  remaining: number,
  simTime: number,
  hourglass: Aura | null,
  dead: boolean,
): boolean {
  if (abilityId === 'temporal_hourglass' || !hourglass) {
    return prior === round2(simTime + remaining);
  }
  if (!Array.isArray(prior)) return false;
  const rate = hourglass.value;
  const acceleratedFor = dead ? remaining / rate : Math.min(hourglass.remaining, remaining / rate);
  const normalWork = Math.max(0, remaining - acceleratedFor * rate);
  return (
    prior[0] === round2(simTime + acceleratedFor + normalWork) &&
    prior[1] === rate &&
    prior[2] === round2(simTime + acceleratedFor)
  );
}

function deadlineMapJson(deadlines: ReadonlyMap<string, CooldownDeadline>): string {
  return JSON.stringify(Object.fromEntries(deadlines));
}

/** Per-recipient cache for v2 self timers. A spectator owner change resets it. */
export class StableSelfTimerWireCache {
  private ownerId: number | null = null;
  private cooldowns = new Map<string, CooldownDeadline>();
  private cooldownResult: SerializedTimerWire | null = null;
  private nodes = new Map<string, number>();
  private nodeResult: SerializedTimerWire | null = null;
  private charges = new Map<string, number>();
  private chargeResult: SerializedTimerWire | null = null;
  cooldownRebuilds = 0;
  nodeCooldownRebuilds = 0;
  chargeRebuilds = 0;

  private setOwner(ownerId: number): void {
    if (this.ownerId === ownerId) return;
    this.ownerId = ownerId;
    this.cooldowns.clear();
    this.cooldownResult = null;
    this.nodes.clear();
    this.nodeResult = null;
    this.charges.clear();
    this.chargeResult = null;
  }

  encodeCooldowns(
    ownerId: number,
    entity: Pick<Entity, 'cooldowns' | 'auras' | 'dead'>,
    simTime: number,
  ): SerializedTimerWire {
    this.setOwner(ownerId);
    const hourglass = findProtectiveHourglass(entity.auras);
    let count = 0;
    let changed = false;
    for (const [abilityId, remaining] of entity.cooldowns) {
      if (!(remaining > 0) || !Number.isFinite(remaining)) continue;
      count++;
      if (
        !cooldownDeadlineMatches(
          this.cooldowns.get(abilityId),
          abilityId,
          remaining,
          simTime,
          hourglass,
          entity.dead,
        )
      ) {
        changed = true;
      }
    }
    if (count !== this.cooldowns.size) changed = true;
    if (!changed && this.cooldownResult) return this.cooldownResult;

    const next = new Map<string, CooldownDeadline>();
    for (const [abilityId, remaining] of entity.cooldowns) {
      if (!(remaining > 0) || !Number.isFinite(remaining)) continue;
      next.set(abilityId, cooldownDeadline(abilityId, remaining, simTime, hourglass, entity.dead));
    }
    this.cooldowns = next;
    this.cooldownRebuilds++;
    this.cooldownResult = {
      json: deadlineMapJson(next),
      revision: this.cooldownRebuilds,
    };
    return this.cooldownResult;
  }

  encodeNodeCooldowns(
    ownerId: number,
    readyAt: Readonly<Record<string, number>>,
    simTime: number,
  ): SerializedTimerWire {
    this.setOwner(ownerId);
    let count = 0;
    let changed = false;
    for (const key in readyAt) {
      const value = readyAt[key];
      if (!(value > simTime) || !Number.isFinite(value)) continue;
      count++;
      if (this.nodes.get(key) !== round2(value)) changed = true;
    }
    if (count !== this.nodes.size) changed = true;
    if (!changed && this.nodeResult) return this.nodeResult;

    const next = new Map<string, number>();
    for (const key in readyAt) {
      const value = readyAt[key];
      if (value > simTime && Number.isFinite(value)) next.set(key, round2(value));
    }
    this.nodes = next;
    this.nodeCooldownRebuilds++;
    this.nodeResult = {
      json: JSON.stringify(Object.fromEntries(next)),
      revision: this.nodeCooldownRebuilds,
    };
    return this.nodeResult;
  }

  encodeCharges(ownerId: number, abilityCharges: Entity['abilityCharges']): SerializedTimerWire {
    this.setOwner(ownerId);
    let count = 0;
    let changed = false;
    if (abilityCharges) {
      for (const key in abilityCharges) {
        count++;
        if (this.charges.get(key) !== abilityCharges[key].charges) changed = true;
      }
    }
    if (count !== this.charges.size) changed = true;
    if (!changed && this.chargeResult) return this.chargeResult;

    const next = new Map<string, number>();
    if (abilityCharges) {
      for (const key in abilityCharges) next.set(key, abilityCharges[key].charges);
    }
    this.charges = next;
    this.chargeRebuilds++;
    this.chargeResult = {
      json: JSON.stringify(Object.fromEntries(next)),
      revision: this.chargeRebuilds,
    };
    return this.chargeResult;
  }
}
