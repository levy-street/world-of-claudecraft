import type { RuntimeKey, RuntimeKind } from './contract';

// Keep the realm vocabulary byte-compatible with server/realm.ts. Realm names
// are player-visible deployment identifiers and already permit spaces and
// apostrophes, unlike opaque runtime claim ids.
const REALM_RE = /^[A-Za-z0-9][A-Za-z0-9 '_-]{0,23}$/;
const CLAIM_RE = /^[A-Za-z0-9._:-]{1,128}$/;

function validateSegment(name: string, value: string, pattern: RegExp): string {
  if (!pattern.test(value)) throw new RangeError(`${name} is not a valid runtime key segment`);
  return value;
}

export function runtimeKey(input: RuntimeKey): string {
  const realm = validateSegment('realm', input.realm, REALM_RE);
  const claimId = validateSegment('claimId', input.claimId, CLAIM_RE);
  return `${realm}/${input.kind}/${claimId}`;
}

export function overworldRuntimeKey(realm: string, zoneId = 'world'): string {
  const claimId = zoneId === 'world' ? zoneId : `zone:${zoneId}`;
  return runtimeKey({ realm, kind: 'overworld', claimId });
}

export function instanceRuntimeKey(
  realm: string,
  kind: Exclude<RuntimeKind, 'overworld'>,
  claimId: string | number,
): string {
  return runtimeKey({ realm, kind, claimId: String(claimId) });
}

export function parseRuntimeKey(value: string): RuntimeKey {
  const parts = value.split('/');
  if (parts.length !== 3) throw new RangeError('runtime key must have three segments');
  const realm = parts[0];
  const kind = parts[1];
  const claimId = parts[2];
  if (realm === undefined || kind === undefined || claimId === undefined) {
    throw new RangeError('runtime key must have three segments');
  }
  if (kind !== 'overworld' && kind !== 'dungeon' && kind !== 'delve' && kind !== 'arena') {
    throw new RangeError('runtime key has an unknown kind');
  }
  const parsed = {
    realm: validateSegment('realm', realm, REALM_RE),
    kind,
    claimId: validateSegment('claimId', claimId, CLAIM_RE),
  } satisfies RuntimeKey;
  if (kind === 'overworld' && parsed.claimId !== 'world' && !parsed.claimId.startsWith('zone:')) {
    throw new RangeError('overworld runtime key must use the world or a zone claim');
  }
  return parsed;
}
