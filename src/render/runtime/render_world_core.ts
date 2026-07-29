// Allocation-bounded index for render-view admission and eviction.
// It deliberately knows nothing about Three.js, the DOM, or a concrete world host.

export interface RenderEntityLike {
  id: number;
  pos: { x: number; z: number };
}

export interface RenderWorldFrameInput {
  originX: number;
  originZ: number;
  selfId: number;
  targetId: number | null;
  createRangeSq: number;
  destroyRangeSq: number;
}

export interface RenderWorldFrame {
  activeCount: number;
  admissionCount: number;
  evictionCount: number;
  removalCount: number;
}

const MIN_CAPACITY = 16;

function nextCapacity(current: number, required: number): number {
  let next = Math.max(MIN_CAPACITY, current);
  while (next < required) next *= 2;
  return next;
}

function copyInt32(source: Int32Array, capacity: number): Int32Array {
  const next = new Int32Array(capacity);
  next.set(source);
  return next;
}

function copyUint32(source: Uint32Array, capacity: number): Uint32Array {
  const next = new Uint32Array(capacity);
  next.set(source);
  return next;
}

function copyUint8(source: Uint8Array, capacity: number): Uint8Array {
  const next = new Uint8Array(capacity);
  next.set(source);
  return next;
}

function copyFloat32(source: Float32Array, capacity: number): Float32Array {
  const next = new Float32Array(capacity);
  next.set(source);
  return next;
}

export class RenderWorldCore<T extends RenderEntityLike = RenderEntityLike> {
  distanceSq: Float32Array;
  admissionIds: Int32Array;
  evictionIds: Int32Array;
  removalIds: Int32Array;
  generation: Uint32Array;

  activeCount = 0;
  admissionCount = 0;
  evictionCount = 0;
  removalCount = 0;

  private ids: Int32Array;
  private activeSlots: Int32Array;
  private readonly slotById = new Map<number, number>();
  private seenFrame: Uint32Array;
  private attached: Uint8Array;
  private activeIndexBySlot: Int32Array;
  private freeSlots: Int32Array;
  private freeCount = 0;
  private highWater = 0;
  private frame = 0;

  constructor(initialCapacity = 256) {
    const capacity = nextCapacity(0, Math.max(1, initialCapacity));
    this.ids = new Int32Array(capacity);
    this.distanceSq = new Float32Array(capacity);
    this.activeSlots = new Int32Array(capacity);
    this.admissionIds = new Int32Array(capacity);
    this.evictionIds = new Int32Array(capacity);
    this.removalIds = new Int32Array(capacity);
    this.generation = new Uint32Array(capacity);
    this.seenFrame = new Uint32Array(capacity);
    this.attached = new Uint8Array(capacity);
    this.activeIndexBySlot = new Int32Array(capacity);
    this.activeIndexBySlot.fill(-1);
    this.freeSlots = new Int32Array(capacity);
  }

  get capacity(): number {
    return this.ids.length;
  }

  slotFor(entityId: number): number {
    return this.slotById.get(entityId) ?? -1;
  }

  markViewAttached(entityId: number, value: boolean): void {
    const slot = this.slotById.get(entityId);
    if (slot !== undefined) this.attached[slot] = value ? 1 : 0;
  }

  update(entities: ReadonlyMap<number, T>, input: RenderWorldFrameInput): RenderWorldFrame {
    this.advanceFrame();
    this.admissionCount = 0;
    this.evictionCount = 0;
    this.removalCount = 0;

    for (const entity of entities.values()) {
      const slot = this.ensureSlot(entity.id);
      this.seenFrame[slot] = this.frame;
      const dx = entity.pos.x - input.originX;
      const dz = entity.pos.z - input.originZ;
      const distanceSq = dx * dx + dz * dz;
      this.distanceSq[slot] = distanceSq;

      // Only identity-critical views bypass spatial admission. Promoting every
      // hostile or casting entity would instantiate remote world populations.
      const required = entity.id === input.selfId || entity.id === input.targetId;
      const hasView = this.attached[slot] === 1;
      if (!hasView && (required || distanceSq <= input.createRangeSq)) {
        this.admissionIds[this.admissionCount++] = entity.id;
      } else if (hasView && !required && distanceSq > input.destroyRangeSq) {
        this.evictionIds[this.evictionCount++] = entity.id;
      }
    }

    let activeIndex = 0;
    while (activeIndex < this.activeCount) {
      const slot = this.activeSlots[activeIndex]!;
      if (this.seenFrame[slot] === this.frame) {
        activeIndex++;
        continue;
      }
      const id = this.ids[slot]!;
      if (this.attached[slot] === 1) {
        this.removalIds[this.removalCount++] = id;
      }
      this.releaseSlot(slot);
    }

    return {
      activeCount: this.activeCount,
      admissionCount: this.admissionCount,
      evictionCount: this.evictionCount,
      removalCount: this.removalCount,
    };
  }

  private advanceFrame(): void {
    this.frame = (this.frame + 1) >>> 0;
    if (this.frame !== 0) return;
    this.seenFrame.fill(0);
    this.frame = 1;
  }

  private ensureSlot(entityId: number): number {
    const existing = this.slotById.get(entityId);
    if (existing !== undefined) return existing;

    if (this.freeCount === 0 && this.highWater === this.capacity) {
      this.grow(this.capacity + 1);
    }
    const slot = this.freeCount > 0 ? this.freeSlots[--this.freeCount]! : this.highWater++;
    this.slotById.set(entityId, slot);
    this.ids[slot] = entityId;
    this.generation[slot] = (this.generation[slot]! + 1) >>> 0 || 1;
    this.activeIndexBySlot[slot] = this.activeCount;
    this.activeSlots[this.activeCount++] = slot;
    return slot;
  }

  private releaseSlot(slot: number): void {
    const id = this.ids[slot]!;
    this.slotById.delete(id);
    this.attached[slot] = 0;

    const activeIndex = this.activeIndexBySlot[slot]!;
    const lastIndex = --this.activeCount;
    const lastSlot = this.activeSlots[lastIndex]!;
    if (activeIndex !== lastIndex) {
      this.activeSlots[activeIndex] = lastSlot;
      this.activeIndexBySlot[lastSlot] = activeIndex;
    }
    this.activeIndexBySlot[slot] = -1;
    this.freeSlots[this.freeCount++] = slot;
  }

  private grow(required: number): void {
    const capacity = nextCapacity(this.capacity, required);
    this.ids = copyInt32(this.ids, capacity);
    this.distanceSq = copyFloat32(this.distanceSq, capacity);
    this.activeSlots = copyInt32(this.activeSlots, capacity);
    this.admissionIds = copyInt32(this.admissionIds, capacity);
    this.evictionIds = copyInt32(this.evictionIds, capacity);
    this.removalIds = copyInt32(this.removalIds, capacity);
    this.generation = copyUint32(this.generation, capacity);
    this.seenFrame = copyUint32(this.seenFrame, capacity);
    this.attached = copyUint8(this.attached, capacity);
    const activeIndexBySlot = new Int32Array(capacity);
    activeIndexBySlot.fill(-1);
    activeIndexBySlot.set(this.activeIndexBySlot);
    this.activeIndexBySlot = activeIndexBySlot;
    this.freeSlots = copyInt32(this.freeSlots, capacity);
  }
}
