import type { RuntimeKey, RuntimeKind } from './contract';

const SEGMENT_RE = /^[A-Za-z0-9._:-]{1,128}$/;

function validateSegment(name: string, value: string): string {
  if (!SEGMENT_RE.test(value)) throw new RangeError(`${name} is not a valid runtime key segment`);
  return value;
}

export function runtimeKey(input: RuntimeKey): string {
  const realm = validateSegment('realm', input.realm);
  const claimId = validateSegment('claimId', input.claimId);
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
  const [realm, kind, claimId] = parts;
  if (kind !== 'overworld' && kind !== 'dungeon' && kind !== 'delve' && kind !== 'arena') {
    throw new RangeError('runtime key has an unknown kind');
  }
  const parsed = {
    realm: validateSegment('realm', realm!),
    kind,
    claimId: validateSegment('claimId', claimId!),
  } satisfies RuntimeKey;
  if (kind === 'overworld' && parsed.claimId !== 'world' && !parsed.claimId.startsWith('zone:')) {
    throw new RangeError('overworld runtime key must use the world or a zone claim');
  }
  return parsed;
}
