// Typed hot-path index shared by render admission, crowd, and nameplate systems.
// It deliberately knows nothing about Three.js, the DOM, or a concrete world host.

export interface RenderEntityLike {
  id: number;
  pos: { x: number; y: number; z: number };
  facing: number;
  hostile: boolean;
  inCombat: boolean;
  castingAbility: unknown | null;
  ownerId: number | null;
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

export const RENDER_ENTITY_SELF = 1 << 0;
export const RENDER_ENTITY_TARGET = 1 << 1;
export const RENDER_ENTITY_HOSTILE = 1 << 2;
export const RENDER_ENTITY_COMBAT = 1 << 3;
export const RENDER_ENTITY_CASTING = 1 << 4;
export const RENDER_ENTITY_OWNED = 1 << 5;
export const RENDER_ENTITY_ACTIONABLE =
  RENDER_ENTITY_SELF |
  RENDER_ENTITY_TARGET |
  RENDER_ENTITY_HOSTILE |
  RENDER_ENTITY_COMBAT |
  RENDER_ENTITY_CASTING;

export const RENDER_DIRTY_POSITION = 1 << 0;
export const RENDER_DIRTY_FACING = 1 << 1;
export const RENDER_DIRTY_FLAGS = 1 << 2;
export const RENDER_DIRTY_REFERENCE = 1 << 3;
export const RENDER_DIRTY_NEW = 1 << 4;
export const RENDER_DIRTY_ALL =
  RENDER_DIRTY_POSITION |
  RENDER_DIRTY_FACING |
  RENDER_DIRTY_FLAGS |
  RENDER_DIRTY_REFERENCE |
  RENDER_DIRTY_NEW;

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

function copyFloat32(source: Float32Array, capacity: number): Float32Array {
  const next = new Float32Array(capacity);
  next.set(source);
  return next;
}

export class RenderWorldCore<T extends RenderEntityLike = RenderEntityLike> {
  ids: Int32Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  facing: Float32Array;
  distanceSq: Float32Array;
  flags: Uint32Array;
  dirty: Uint32Array;
  generation: Uint32Array;
  activeSlots: Int32Array;
  admissionIds: Int32Array;
  evictionIds: Int32Array;
  removalIds: Int32Array;
  refs: Array<T | undefined>;

  activeCount = 0;
  admissionCount = 0;
  evictionCount = 0;
  removalCount = 0;

  private readonly slotById = new Map<number, number>();
  private seenFrame: Uint32Array;
  private attached: Uint32Array;
  private activeIndexBySlot: Int32Array;
  private freeSlots: Int32Array;
  private freeCount = 0;
  private highWater = 0;
  private frame = 0;

  constructor(initialCapacity = 256) {
    const capacity = nextCapacity(0, Math.max(1, initialCapacity));
    this.ids = new Int32Array(capacity);
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.facing = new Float32Array(capacity);
    this.distanceSq = new Float32Array(capacity);
    this.flags = new Uint32Array(capacity);
    this.dirty = new Uint32Array(capacity);
    this.generation = new Uint32Array(capacity);
    this.activeSlots = new Int32Array(capacity);
    this.admissionIds = new Int32Array(capacity);
    this.evictionIds = new Int32Array(capacity);
    this.removalIds = new Int32Array(capacity);
    this.refs = new Array<T | undefined>(capacity);
    this.seenFrame = new Uint32Array(capacity);
    this.attached = new Uint32Array(capacity);
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

  hasAttachedView(entityId: number): boolean {
    const slot = this.slotById.get(entityId);
    return slot !== undefined && this.attached[slot] === 1;
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
      const slot = this.ensureSlot(entity);
      this.seenFrame[slot] = this.frame;
      this.updateSlot(slot, entity, input);

      // Only identity-critical views bypass spatial admission. Hostility, combat,
      // and casting remain actionable render flags for LOD/nameplates, but using
      // them here would instantiate every hostile mob in the world and then pay
      // its animation cost even when it is far outside the draw band.
      const required = (this.flags[slot]! & (RENDER_ENTITY_SELF | RENDER_ENTITY_TARGET)) !== 0;
      const hasView = this.attached[slot] === 1;
      if (!hasView && (required || this.distanceSq[slot]! <= input.createRangeSq)) {
        this.admissionIds[this.admissionCount++] = entity.id;
      } else if (hasView && !required && this.distanceSq[slot]! > input.destroyRangeSq) {
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

  private ensureSlot(entity: T): number {
    const existing = this.slotById.get(entity.id);
    if (existing !== undefined) return existing;

    if (this.freeCount === 0 && this.highWater === this.capacity) {
      this.grow(this.capacity + 1);
    }
    const slot = this.freeCount > 0 ? this.freeSlots[--this.freeCount]! : this.highWater++;
    this.slotById.set(entity.id, slot);
    this.ids[slot] = entity.id;
    this.generation[slot] = (this.generation[slot]! + 1) >>> 0 || 1;
    this.activeIndexBySlot[slot] = this.activeCount;
    this.activeSlots[this.activeCount++] = slot;
    this.dirty[slot] = RENDER_DIRTY_ALL;
    return slot;
  }

  private updateSlot(slot: number, entity: T, input: RenderWorldFrameInput): void {
    let dirty = this.refs[slot] === undefined ? RENDER_DIRTY_NEW : 0;
    if (this.refs[slot] !== entity) dirty |= RENDER_DIRTY_REFERENCE;
    if (
      this.x[slot] !== entity.pos.x ||
      this.y[slot] !== entity.pos.y ||
      this.z[slot] !== entity.pos.z
    ) {
      dirty |= RENDER_DIRTY_POSITION;
    }
    if (this.facing[slot] !== entity.facing) dirty |= RENDER_DIRTY_FACING;

    let flags = 0;
    if (entity.id === input.selfId) flags |= RENDER_ENTITY_SELF;
    if (entity.id === input.targetId) flags |= RENDER_ENTITY_TARGET;
    if (entity.hostile) flags |= RENDER_ENTITY_HOSTILE;
    if (entity.inCombat) flags |= RENDER_ENTITY_COMBAT;
    if (entity.castingAbility !== null) flags |= RENDER_ENTITY_CASTING;
    if (entity.ownerId !== null) flags |= RENDER_ENTITY_OWNED;
    if (this.flags[slot] !== flags) dirty |= RENDER_DIRTY_FLAGS;

    this.refs[slot] = entity;
    this.x[slot] = entity.pos.x;
    this.y[slot] = entity.pos.y;
    this.z[slot] = entity.pos.z;
    this.facing[slot] = entity.facing;
    const dx = entity.pos.x - input.originX;
    const dz = entity.pos.z - input.originZ;
    this.distanceSq[slot] = dx * dx + dz * dz;
    this.flags[slot] = flags;
    this.dirty[slot] = dirty;
  }

  private releaseSlot(slot: number): void {
    const id = this.ids[slot]!;
    this.slotById.delete(id);
    this.refs[slot] = undefined;
    this.attached[slot] = 0;
    this.flags[slot] = 0;
    this.dirty[slot] = 0;

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
    this.x = copyFloat32(this.x, capacity);
    this.y = copyFloat32(this.y, capacity);
    this.z = copyFloat32(this.z, capacity);
    this.facing = copyFloat32(this.facing, capacity);
    this.distanceSq = copyFloat32(this.distanceSq, capacity);
    this.flags = copyUint32(this.flags, capacity);
    this.dirty = copyUint32(this.dirty, capacity);
    this.generation = copyUint32(this.generation, capacity);
    this.activeSlots = copyInt32(this.activeSlots, capacity);
    this.admissionIds = copyInt32(this.admissionIds, capacity);
    this.evictionIds = copyInt32(this.evictionIds, capacity);
    this.removalIds = copyInt32(this.removalIds, capacity);
    this.seenFrame = copyUint32(this.seenFrame, capacity);
    this.attached = copyUint32(this.attached, capacity);
    const activeIndexBySlot = new Int32Array(capacity);
    activeIndexBySlot.fill(-1);
    activeIndexBySlot.set(this.activeIndexBySlot);
    this.activeIndexBySlot = activeIndexBySlot;
    this.freeSlots = copyInt32(this.freeSlots, capacity);
    this.refs.length = capacity;
  }
}
