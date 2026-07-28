export const SNAPSHOT_BINARY_WIRE_VERSION = 1 as const;

const MAGIC = [0x57, 0x4f, 0x43, 0x53] as const;

const TAG_NULL = 0;
const TAG_FALSE = 1;
const TAG_TRUE = 2;
const TAG_UINT = 3;
const TAG_SINT = 4;
const TAG_FLOAT64 = 5;
const TAG_STRING = 6;
const TAG_ARRAY = 7;
const TAG_OBJECT = 8;

const ROOT_KEYS = [
  'tick',
  'time',
  'tickHz',
  'timerWire',
  'self',
  'keep',
  'rings',
  'hourglasses',
] as const;
const ENTITY_KEYS = ['id', 'x', 'y', 'z', 'f', 'hp', 'mhp', 'k', 'tid', 'nm', 'lv'] as const;
const ROOT_KNOWN = new Set<string>(['t', 'ents', ...ROOT_KEYS]);
const ENTITY_KNOWN = new Set<string>(ENTITY_KEYS);

export interface SnapshotBinaryLimits {
  maxFrameBytes: number;
  maxStringBytes: number;
  maxCollectionEntries: number;
  maxDepth: number;
  maxValues: number;
}

export const DEFAULT_SNAPSHOT_BINARY_LIMITS: Readonly<SnapshotBinaryLimits> = {
  maxFrameBytes: 1024 * 1024,
  maxStringBytes: 64 * 1024,
  maxCollectionEntries: 16 * 1024,
  maxDepth: 16,
  maxValues: 128 * 1024,
};

export type SnapshotObject = Record<string, unknown> & {
  t?: unknown;
  ents?: unknown;
};

class SnapshotBinaryEntityFragmentValue {
  readonly #brand = this;

  isAuthentic(): boolean {
    return this.#brand === this;
  }
}

export type SnapshotBinaryEntityFragment = SnapshotBinaryEntityFragmentValue;

interface SnapshotBinaryEntityFragmentPayload {
  bytes: Uint8Array;
  limits: SnapshotBinaryLimits;
  valueCount: number;
}

const entityFragmentPayloads = new WeakMap<
  SnapshotBinaryEntityFragmentValue,
  SnapshotBinaryEntityFragmentPayload
>();

class Writer {
  private bytes = new Uint8Array(1024);
  length = 0;

  constructor(private readonly limits: SnapshotBinaryLimits) {}

  finish(): Uint8Array {
    return this.bytes.slice(0, this.length);
  }

  u8(value: number): void {
    this.reserve(1);
    this.bytes[this.length++] = value & 0xff;
  }

  u16(value: number): void {
    this.reserve(2);
    this.bytes[this.length++] = value & 0xff;
    this.bytes[this.length++] = (value >>> 8) & 0xff;
  }

  f64(value: number): void {
    this.reserve(8);
    new DataView(this.bytes.buffer).setFloat64(this.length, value, true);
    this.length += 8;
  }

  raw(value: Uint8Array): void {
    this.reserve(value.length);
    this.bytes.set(value, this.length);
    this.length += value.length;
  }

  varUint(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('invalid varuint');
    let remaining = value;
    while (remaining >= 128) {
      this.u8((remaining % 128) | 0x80);
      remaining = Math.floor(remaining / 128);
    }
    this.u8(remaining);
  }

  private reserve(count: number): void {
    const required = this.length + count;
    if (required > this.limits.maxFrameBytes) throw new RangeError('snapshot frame is too large');
    if (required <= this.bytes.length) return;
    let capacity = this.bytes.length;
    while (capacity < required) capacity *= 2;
    capacity = Math.min(capacity, this.limits.maxFrameBytes);
    const next = new Uint8Array(capacity);
    next.set(this.bytes);
    this.bytes = next;
  }
}

class Reader {
  offset = 0;
  values = 0;

  constructor(
    private readonly bytes: Uint8Array,
    private readonly limits: SnapshotBinaryLimits,
  ) {
    if (bytes.byteLength > limits.maxFrameBytes)
      throw new RangeError('snapshot frame is too large');
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  countValue(): void {
    this.values++;
    if (this.values > this.limits.maxValues) throw new RangeError('snapshot has too many values');
  }

  u8(): number {
    this.require(1);
    return this.bytes[this.offset++]!;
  }

  u16(): number {
    this.require(2);
    const value = this.bytes[this.offset]! | (this.bytes[this.offset + 1]! << 8);
    this.offset += 2;
    return value;
  }

  f64(): number {
    this.require(8);
    const value = new DataView(
      this.bytes.buffer,
      this.bytes.byteOffset + this.offset,
      8,
    ).getFloat64(0, true);
    this.offset += 8;
    return value;
  }

  raw(count: number): Uint8Array {
    this.require(count);
    const value = this.bytes.subarray(this.offset, this.offset + count);
    this.offset += count;
    return value;
  }

  varUint(): number {
    let value = 0;
    let multiplier = 1;
    for (let index = 0; index < 8; index++) {
      const byte = this.u8();
      value += (byte & 0x7f) * multiplier;
      if (!Number.isSafeInteger(value)) throw new RangeError('varuint exceeds safe integer range');
      if ((byte & 0x80) === 0) return value;
      multiplier *= 128;
    }
    throw new RangeError('varuint is too long');
  }

  collectionLength(): number {
    const length = this.varUint();
    if (length > this.limits.maxCollectionEntries) {
      throw new RangeError('snapshot collection is too large');
    }
    return length;
  }

  private require(count: number): void {
    if (count < 0 || this.offset + count > this.bytes.length) {
      throw new RangeError('truncated snapshot frame');
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeLimits(limits?: Partial<SnapshotBinaryLimits>): SnapshotBinaryLimits {
  const result = { ...DEFAULT_SNAPSHOT_BINARY_LIMITS, ...limits };
  for (const [name, value] of Object.entries(result)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`${name} must be a positive safe integer`);
    }
  }
  return result;
}

function limitsMatch(left: SnapshotBinaryLimits, right: SnapshotBinaryLimits): boolean {
  return (
    left.maxFrameBytes === right.maxFrameBytes &&
    left.maxStringBytes === right.maxStringBytes &&
    left.maxCollectionEntries === right.maxCollectionEntries &&
    left.maxDepth === right.maxDepth &&
    left.maxValues === right.maxValues
  );
}

function defineEnumerableDataProperty(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function encodeString(writer: Writer, value: string, limits: SnapshotBinaryLimits): void {
  const encoded = new TextEncoder().encode(value);
  if (encoded.length > limits.maxStringBytes) throw new RangeError('snapshot string is too large');
  writer.varUint(encoded.length);
  writer.raw(encoded);
}

function encodeValue(
  writer: Writer,
  value: unknown,
  limits: SnapshotBinaryLimits,
  state: { values: number },
  depth: number,
): void {
  state.values++;
  if (state.values > limits.maxValues) throw new RangeError('snapshot has too many values');
  if (depth > limits.maxDepth) throw new RangeError('snapshot nesting is too deep');

  if (value === null) {
    writer.u8(TAG_NULL);
    return;
  }
  if (value === false) {
    writer.u8(TAG_FALSE);
    return;
  }
  if (value === true) {
    writer.u8(TAG_TRUE);
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('snapshot numbers must be finite');
    if (Number.isSafeInteger(value) && value >= 0) {
      writer.u8(TAG_UINT);
      writer.varUint(value);
    } else if (Number.isSafeInteger(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER / 2) {
      writer.u8(TAG_SINT);
      writer.varUint(-value * 2 - 1);
    } else {
      writer.u8(TAG_FLOAT64);
      writer.f64(value);
    }
    return;
  }
  if (typeof value === 'string') {
    writer.u8(TAG_STRING);
    encodeString(writer, value, limits);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > limits.maxCollectionEntries) {
      throw new RangeError('snapshot collection is too large');
    }
    writer.u8(TAG_ARRAY);
    writer.varUint(value.length);
    for (const entry of value) encodeValue(writer, entry, limits, state, depth + 1);
    return;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    if (keys.length > limits.maxCollectionEntries) {
      throw new RangeError('snapshot collection is too large');
    }
    writer.u8(TAG_OBJECT);
    writer.varUint(keys.length);
    for (const key of keys) {
      encodeString(writer, key, limits);
      encodeValue(writer, value[key], limits, state, depth + 1);
    }
    return;
  }
  throw new TypeError('snapshot contains an unsupported value');
}

function decodeString(reader: Reader, limits: SnapshotBinaryLimits): string {
  const length = reader.varUint();
  if (length > limits.maxStringBytes) throw new RangeError('snapshot string is too large');
  return new TextDecoder('utf-8', { fatal: true }).decode(reader.raw(length));
}

function decodeValue(reader: Reader, limits: SnapshotBinaryLimits, depth: number): unknown {
  reader.countValue();
  if (depth > limits.maxDepth) throw new RangeError('snapshot nesting is too deep');
  const tag = reader.u8();
  if (tag === TAG_NULL) return null;
  if (tag === TAG_FALSE) return false;
  if (tag === TAG_TRUE) return true;
  if (tag === TAG_UINT) return reader.varUint();
  if (tag === TAG_SINT) return -(reader.varUint() + 1) / 2;
  if (tag === TAG_FLOAT64) {
    const value = reader.f64();
    if (!Number.isFinite(value)) throw new RangeError('snapshot number must be finite');
    return value;
  }
  if (tag === TAG_STRING) return decodeString(reader, limits);
  if (tag === TAG_ARRAY) {
    const length = reader.collectionLength();
    const values = new Array<unknown>(length);
    for (let index = 0; index < length; index++) {
      values[index] = decodeValue(reader, limits, depth + 1);
    }
    return values;
  }
  if (tag === TAG_OBJECT) {
    const length = reader.collectionLength();
    const value: Record<string, unknown> = {};
    for (let index = 0; index < length; index++) {
      const key = decodeString(reader, limits);
      if (Object.hasOwn(value, key)) throw new RangeError('snapshot object has a duplicate key');
      defineEnumerableDataProperty(value, key, decodeValue(reader, limits, depth + 1));
    }
    return value;
  }
  throw new RangeError('snapshot contains an unknown value tag');
}

function encodeKnownObject(
  writer: Writer,
  value: Record<string, unknown>,
  keys: readonly string[],
  known: ReadonlySet<string>,
  limits: SnapshotBinaryLimits,
  state: { values: number },
): void {
  let mask = 0;
  for (let index = 0; index < keys.length; index++) {
    if (Object.hasOwn(value, keys[index]!)) mask |= 1 << index;
  }
  writer.u16(mask);
  for (let index = 0; index < keys.length; index++) {
    if ((mask & (1 << index)) !== 0) {
      encodeValue(writer, value[keys[index]!], limits, state, 1);
    }
  }
  const extensions = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    if (!known.has(key)) defineEnumerableDataProperty(extensions, key, value[key]);
  }
  encodeValue(writer, extensions, limits, state, 1);
}

function decodeKnownObject(
  reader: Reader,
  keys: readonly string[],
  limits: SnapshotBinaryLimits,
): Record<string, unknown> {
  const mask = reader.u16();
  if (mask >>> keys.length !== 0) throw new RangeError('snapshot has unknown presence bits');
  const value: Record<string, unknown> = {};
  for (let index = 0; index < keys.length; index++) {
    if ((mask & (1 << index)) !== 0) {
      defineEnumerableDataProperty(value, keys[index]!, decodeValue(reader, limits, 1));
    }
  }
  const extensions = decodeValue(reader, limits, 1);
  if (!isRecord(extensions)) throw new RangeError('snapshot extension block must be an object');
  for (const [key, entry] of Object.entries(extensions)) {
    if (Object.hasOwn(value, key))
      throw new RangeError('snapshot extension duplicates a known key');
    defineEnumerableDataProperty(value, key, entry);
  }
  return value;
}

function validateSnapshotRoot(snapshot: SnapshotObject): void {
  if (!isRecord(snapshot) || (snapshot.t !== undefined && snapshot.t !== 'snap')) {
    throw new TypeError('binary snapshot must be a snap object');
  }
}

function encodeSnapshotBinaryEntityFragmentWithLimits(
  entity: unknown,
  limits: SnapshotBinaryLimits,
): SnapshotBinaryEntityFragment {
  if (!isRecord(entity)) throw new TypeError('snapshot entity must be an object');
  const writer = new Writer(limits);
  const state = { values: 0 };
  encodeKnownObject(writer, entity, ENTITY_KEYS, ENTITY_KNOWN, limits, state);
  const fragment = new SnapshotBinaryEntityFragmentValue();
  Object.freeze(fragment);
  entityFragmentPayloads.set(fragment, {
    bytes: writer.finish(),
    limits,
    valueCount: state.values,
  });
  return fragment;
}

function getSnapshotBinaryEntityFragmentPayload(
  fragment: unknown,
): SnapshotBinaryEntityFragmentPayload {
  if (!(fragment instanceof SnapshotBinaryEntityFragmentValue) || !fragment.isAuthentic()) {
    throw new TypeError('invalid snapshot entity fragment');
  }
  const payload = entityFragmentPayloads.get(fragment);
  if (!payload) throw new TypeError('invalid snapshot entity fragment');
  return payload;
}

function encodeSnapshotBinaryFromFragmentsWithLimits(
  snapshot: SnapshotObject,
  fragments: readonly SnapshotBinaryEntityFragment[],
  limits: SnapshotBinaryLimits,
): Uint8Array {
  validateSnapshotRoot(snapshot);
  if (Object.hasOwn(snapshot, 'ents')) {
    throw new TypeError('fragment snapshot root must not contain ents');
  }
  if (fragments.length > limits.maxCollectionEntries) {
    throw new RangeError('snapshot entity collection is too large');
  }

  const writer = new Writer(limits);
  const state = { values: 0 };
  for (const byte of MAGIC) writer.u8(byte);
  writer.u8(SNAPSHOT_BINARY_WIRE_VERSION);
  writer.u8(0);
  encodeKnownObject(writer, snapshot, ROOT_KEYS, ROOT_KNOWN, limits, state);
  writer.varUint(fragments.length);
  for (const fragment of fragments) {
    const payload = getSnapshotBinaryEntityFragmentPayload(fragment);
    if (!limitsMatch(payload.limits, limits)) {
      throw new RangeError('snapshot entity fragment limits do not match frame limits');
    }
    state.values += payload.valueCount;
    if (state.values > limits.maxValues) {
      throw new RangeError('snapshot has too many values');
    }
    writer.raw(payload.bytes);
  }
  return writer.finish();
}

export function encodeSnapshotBinaryEntityFragment(
  entity: unknown,
  requestedLimits?: Partial<SnapshotBinaryLimits>,
): SnapshotBinaryEntityFragment {
  return encodeSnapshotBinaryEntityFragmentWithLimits(entity, normalizeLimits(requestedLimits));
}

export function encodeSnapshotBinaryFromFragments(
  snapshot: SnapshotObject,
  fragments: readonly SnapshotBinaryEntityFragment[],
  requestedLimits?: Partial<SnapshotBinaryLimits>,
): Uint8Array {
  return encodeSnapshotBinaryFromFragmentsWithLimits(
    snapshot,
    fragments,
    normalizeLimits(requestedLimits),
  );
}

export function encodeSnapshotBinary(
  snapshot: SnapshotObject,
  requestedLimits?: Partial<SnapshotBinaryLimits>,
): Uint8Array {
  if (!isRecord(snapshot) || (snapshot.t !== undefined && snapshot.t !== 'snap')) {
    throw new TypeError('binary snapshot must be a snap object');
  }
  const entities = snapshot.ents === undefined ? [] : snapshot.ents;
  if (!Array.isArray(entities)) throw new TypeError('binary snapshot ents must be an array');
  const limits = normalizeLimits(requestedLimits);
  if (entities.length > limits.maxCollectionEntries) {
    throw new RangeError('snapshot entity collection is too large');
  }
  const writer = new Writer(limits);
  const state = { values: 0 };
  for (const byte of MAGIC) writer.u8(byte);
  writer.u8(SNAPSHOT_BINARY_WIRE_VERSION);
  writer.u8(0);

  encodeKnownObject(writer, snapshot, ROOT_KEYS, ROOT_KNOWN, limits, state);
  writer.varUint(entities.length);
  for (const entity of entities) {
    if (!isRecord(entity)) throw new TypeError('snapshot entity must be an object');
    encodeKnownObject(writer, entity, ENTITY_KEYS, ENTITY_KNOWN, limits, state);
  }
  return writer.finish();
}

export function decodeSnapshotBinary(
  input: ArrayBuffer | ArrayBufferView,
  requestedLimits?: Partial<SnapshotBinaryLimits>,
): SnapshotObject {
  const bytes =
    input instanceof ArrayBuffer
      ? new Uint8Array(input)
      : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  const limits = normalizeLimits(requestedLimits);
  const reader = new Reader(bytes, limits);
  for (const byte of MAGIC) {
    if (reader.u8() !== byte) throw new RangeError('snapshot frame has invalid magic');
  }
  const version = reader.u8();
  if (version !== SNAPSHOT_BINARY_WIRE_VERSION) {
    throw new RangeError(`unsupported snapshot wire version ${version}`);
  }
  const flags = reader.u8();
  if (flags !== 0) throw new RangeError('snapshot frame has unknown flags');

  const snapshot = decodeKnownObject(reader, ROOT_KEYS, limits);
  defineEnumerableDataProperty(snapshot, 't', 'snap');
  const entityCount = reader.collectionLength();
  const entities = new Array<Record<string, unknown>>(entityCount);
  for (let index = 0; index < entityCount; index++) {
    entities[index] = decodeKnownObject(reader, ENTITY_KEYS, limits);
  }
  defineEnumerableDataProperty(snapshot, 'ents', entities);
  if (reader.remaining !== 0) throw new RangeError('snapshot frame has trailing bytes');
  return snapshot;
}
