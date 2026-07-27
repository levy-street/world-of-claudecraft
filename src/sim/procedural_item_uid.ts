import { formatProceduralItemUid } from './loot/procedural/item_seed';

const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;

export interface ProceduralItemUidLease {
  readonly realmNamespace: string;
  readonly startSerial: string;
  readonly endExclusive: string;
}

function parseSerial(value: string, field: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${field} must contain decimal digits`);
  }
  const parsed = BigInt(value);
  if (parsed < 1n || parsed > MAX_POSTGRES_BIGINT) {
    throw new Error(`${field} is outside the positive Postgres BIGINT range`);
  }
  return parsed;
}

export function deterministicOfflineProceduralItemUidLease(
  worldSeed: number,
): ProceduralItemUidLease {
  const normalizedSeed = Number.isFinite(worldSeed) ? Math.trunc(worldSeed) >>> 0 : 0;
  return {
    realmNamespace: `offline_${normalizedSeed}`,
    startSerial: '1',
    endExclusive: MAX_POSTGRES_BIGINT.toString(),
  };
}

export class ProceduralItemUidAllocator {
  private readonly realmNamespace: string;
  private readonly endExclusive: bigint;
  private nextSerial: bigint;
  private allocated = 0n;

  constructor(lease: ProceduralItemUidLease) {
    const startSerial = parseSerial(lease.startSerial, 'startSerial');
    const endExclusive = parseSerial(lease.endExclusive, 'endExclusive');
    if (startSerial >= endExclusive) {
      throw new Error('procedural item UID lease must contain at least one serial');
    }
    formatProceduralItemUid(lease.realmNamespace, startSerial.toString());
    this.realmNamespace = lease.realmNamespace;
    this.nextSerial = startSerial;
    this.endExclusive = endExclusive;
  }

  get allocatedCount(): bigint {
    return this.allocated;
  }

  allocate(): string {
    if (this.nextSerial >= this.endExclusive) {
      throw new Error('procedural item UID lease exhausted');
    }
    const uid = formatProceduralItemUid(this.realmNamespace, this.nextSerial.toString());
    this.nextSerial++;
    this.allocated++;
    return uid;
  }
}
