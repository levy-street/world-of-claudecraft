// @vitest-environment happy-dom

// Eastbrook Vale's Realm Builder monument: the static service, its collider,
// the inspect interaction, and the honour roll the card reads.
//
// The two things most worth guarding here are the ones a screenshot would not
// catch. First, the SELF-GATE: the monument is only a click target in a world
// whose props still carry its record, so a custom world cannot get an inspect
// prompt hanging in the air where no statue was drawn. Second, the RESERVED
// ENTITY ID: adding a static service must not shift the sequential allocator or
// draw from the rng, or every parity golden in the suite moves with it.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { objectDisplayName } from '../src/render/entity_labels';
import { colliderInternalsForTest } from '../src/sim/colliders';
import {
  currentRealmBuilder,
  isPlaceholderRealmBuilder,
  pastRealmBuilders,
  REALM_BUILDER_PLACEHOLDER_NAME,
  resetRealmBuilderRoll,
  setRealmBuilderRoll,
} from '../src/sim/content/realm_builders';
import { ZONE1_PROPS } from '../src/sim/content/zone1';
import { clonePropsWithoutEastbrookLayout } from '../src/sim/custom_world_props';
import { BUILTIN_WORLD, QUEST_ORDER, setActiveWorldContent } from '../src/sim/data';
import { EASTBROOK_LAYOUT } from '../src/sim/eastbrook_layout';
import { encodeObs, obsSize } from '../src/sim/obs';
import { Sim } from '../src/sim/sim';
import {
  type Entity,
  emptyZoneProps,
  INTERACT_RANGE,
  REALM_BUILDER_MONUMENT_INTERACT_RADIUS,
  REALM_BUILDER_MONUMENT_TEMPLATE_ID,
  STATIC_WORLD_SERVICE_ENTITY_ID_MIN,
  type WorldContent,
} from '../src/sim/types';
import { setLanguage, t } from '../src/ui/i18n';

const SEED = 20_061;
const MONUMENT = EASTBROOK_LAYOUT.civic.monument;

function monumentEntity(sim: Sim): Entity {
  const entity = [...sim.entities.values()].find(
    (candidate) =>
      candidate.kind === 'object' && candidate.templateId === REALM_BUILDER_MONUMENT_TEMPLATE_ID,
  );
  if (!entity) throw new Error('missing Realm Builder monument entity');
  return entity;
}

function standAt(sim: Sim, pid: number, point: { x: number; z: number }): Entity {
  const player = sim.entities.get(pid);
  if (!player) throw new Error(`missing player ${pid}`);
  player.pos = sim.groundPos(point.x, point.z);
  player.prevPos = { ...player.pos };
  sim.rebucket(player);
  return player;
}

/** A reading spot on the front plate's side, just outside the cylinder. */
function frontReadingSpot(): { x: number; z: number } {
  return { x: MONUMENT.position.x - (MONUMENT.radius + 0.6), z: MONUMENT.position.z };
}

/** A spot `distance` yards west of the monument's centre, the front plate's side. */
function westOfMonument(distance: number): { x: number; z: number } {
  return { x: MONUMENT.position.x - distance, z: MONUMENT.position.z };
}

/** A spot `distance` yards from the monument's centre along the line to the mailbox. */
function towardMailbox(distance: number): { x: number; z: number } {
  const mailbox = EASTBROOK_LAYOUT.services.mailbox.position;
  const dx = mailbox.x - MONUMENT.position.x;
  const dz = mailbox.z - MONUMENT.position.z;
  const span = Math.hypot(dx, dz);
  return {
    x: MONUMENT.position.x + (dx / span) * distance,
    z: MONUMENT.position.z + (dz / span) * distance,
  };
}

function mailboxEntity(sim: Sim): Entity {
  const mailbox = EASTBROOK_LAYOUT.services.mailbox.position;
  const entity = [...sim.entities.values()].find(
    (candidate) =>
      candidate.templateId === 'mailbox' &&
      Math.hypot(candidate.pos.x - mailbox.x, candidate.pos.z - mailbox.z) < 0.01,
  );
  if (!entity) throw new Error('missing Eastbrook mailbox entity');
  return entity;
}

function eventTypes(sim: Sim): string[] {
  return sim.drainEvents().map((event) => event.type);
}

function customWorld(): WorldContent {
  return {
    zones: BUILTIN_WORLD.zones,
    camps: [],
    npcs: {},
    groundObjects: [],
    roads: [],
    props: emptyZoneProps(),
    playerStart: { x: 120, z: -80 },
  };
}

afterEach(() => {
  setActiveWorldContent(null);
  setLanguage('en');
  resetRealmBuilderRoll();
});

describe('the Realm Builder honour roll', () => {
  it('ships a readable placeholder and an empty roll, both behind their accessors', () => {
    const current = currentRealmBuilder();
    expect(current.name).toBe(REALM_BUILDER_PLACEHOLDER_NAME);
    expect(isPlaceholderRealmBuilder(current)).toBe(true);
    // A valid calendar month, so the honour keeps one shape; the card never
    // prints it for the placeholder (tests/realm_builder_popup.test.ts).
    expect(current.month).toBeGreaterThanOrEqual(1);
    expect(current.month).toBeLessThanOrEqual(12);
    expect(Number.isInteger(current.year)).toBe(true);

    expect(pastRealmBuilders()).toEqual([]);
    expect(Object.isFrozen(pastRealmBuilders())).toBe(true);
  });

  it("takes the realm's own roll through the override, newest first", () => {
    // What the admin dashboard saves reaches the plaque through here: the
    // server republishes on every write, and an online client picks the same
    // roll up from /api/realm-builder while the world loads.
    setRealmBuilderRoll([
      { year: 2026, month: 9, name: 'Isolde Vane' },
      { year: 2026, month: 8, name: 'Wren Ashdown' },
    ]);
    expect(currentRealmBuilder().name).toBe('Isolde Vane');
    expect(isPlaceholderRealmBuilder(currentRealmBuilder())).toBe(false);
    expect(pastRealmBuilders().map((honour) => honour.name)).toEqual(['Wren Ashdown']);
    // Frozen on the way in: the roll is read on every inspect and nothing
    // downstream may edit the realm's own records in place.
    expect(Object.isFrozen(currentRealmBuilder())).toBe(true);
  });

  it('does not re-sort what the realm handed it', () => {
    // The server already orders by (year, month) DESC in SQL. Re-sorting here
    // would take that decision away from the realm for no gain.
    setRealmBuilderRoll([
      { year: 2025, month: 1, name: 'Backfilled' },
      { year: 2026, month: 9, name: 'Newer' },
    ]);
    expect(currentRealmBuilder().name).toBe('Backfilled');
  });

  it('falls back to the placeholder on an empty roll and on reset', () => {
    setRealmBuilderRoll([{ year: 2026, month: 9, name: 'Isolde Vane' }]);
    // An empty list is meaningful, not a no-op: it is a realm that has named
    // nobody, which should read as a plaque waiting rather than a stale name.
    setRealmBuilderRoll([]);
    expect(currentRealmBuilder().name).toBe(REALM_BUILDER_PLACEHOLDER_NAME);

    setRealmBuilderRoll([{ year: 2026, month: 9, name: 'Isolde Vane' }]);
    resetRealmBuilderRoll();
    expect(currentRealmBuilder().name).toBe(REALM_BUILDER_PLACEHOLDER_NAME);
    expect(pastRealmBuilders()).toEqual([]);
  });

  it('keeps the live source OUTSIDE sim content', () => {
    const source = readFileSync(
      path.join(__dirname, '..', 'src/sim/content/realm_builders.ts'),
      'utf8',
    );
    // The realm's roll arrives as an ARGUMENT and never as a call from inside
    // sim content: no fetch, no clock, no rng, no render/ui/net import. That is
    // the whole reason this override is safe to keep in the deterministic core.
    expect(source).toMatch(/export function setRealmBuilderRoll/);
    expect(source).not.toMatch(/fetch\(|Math\.random\(|Date\.now\(|process\.env/);
    expect(source).not.toMatch(/from '\.\.\/\.\.\/(?:render|ui|net|game)\//);
  });
});

describe('the Realm Builder monument as a static world service', () => {
  it('pins the layout record against the sim contract it has to satisfy', () => {
    // eastbrook_layout.ts is asserted to carry ZERO imports, so it spells the
    // template id out rather than importing the constant. This is the pin that
    // keeps the two honest.
    expect(MONUMENT.templateId).toBe(REALM_BUILDER_MONUMENT_TEMPLATE_ID);
    expect(MONUMENT.entityId).toBeGreaterThanOrEqual(STATIC_WORLD_SERVICE_ENTITY_ID_MIN);
    expect(MONUMENT.assetId).toBe('/models/props/eastbrook_realm_builder_monument.glb');
    // The record is also the wells row the collider and foliage exclusion read.
    expect(ZONE1_PROPS.wells).toEqual([
      expect.objectContaining({ id: MONUMENT.id, r: MONUMENT.radius }),
    ]);
  });

  it("pins the renderer arm's template-id literal to the constant", () => {
    // renderer.ts matches on the LITERAL, exactly like the noticeboard arm
    // beside it, so that importing the constant does not expand a one-line
    // import into six and push the file over its monolith ceiling. That trade
    // is only safe while the literal and the constant agree, so pin them.
    const source = readFileSync(path.join(__dirname, '..', 'src/render/renderer.ts'), 'utf8');
    expect(source).toContain(`e.templateId === '${REALM_BUILDER_MONUMENT_TEMPLATE_ID}'`);
  });

  it('spawns on the reserved id without touching the allocator or the rng', () => {
    const withoutMonument: WorldContent = {
      ...BUILTIN_WORLD,
      props: {
        ...BUILTIN_WORLD.props,
        wells: BUILTIN_WORLD.props.wells.filter((well) => well.id !== MONUMENT.id),
      },
    };
    setActiveWorldContent(withoutMonument);
    const bare = new Sim({
      seed: SEED,
      playerClass: 'warrior',
      noPlayer: true,
      world: withoutMonument,
    });
    setActiveWorldContent(null);
    const seated = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const monument = monumentEntity(seated);

    expect(monument).toMatchObject({
      id: MONUMENT.entityId,
      kind: 'object',
      templateId: REALM_BUILDER_MONUMENT_TEMPLATE_ID,
      // Read, never taken: lootable is what makes it clickable, and the null
      // item payload is what stops the pickup path from handing anything over.
      objectItemId: null,
      lootable: true,
      facing: MONUMENT.rotation,
      prevFacing: MONUMENT.rotation,
    });
    expect({ x: monument.pos.x, z: monument.pos.z }).toEqual({
      x: MONUMENT.position.x,
      z: MONUMENT.position.z,
    });

    expect(seated.nextId).toBe(bare.nextId);
    const stableProjection = (sim: Sim) =>
      [...sim.entities.values()]
        .filter((entity) => entity.templateId !== REALM_BUILDER_MONUMENT_TEMPLATE_ID)
        .map((entity) => ({ id: entity.id, templateId: entity.templateId, pos: entity.pos }));
    expect(stableProjection(seated)).toEqual(stableProjection(bare));
    expect(seated.rng.next()).toBe(bare.rng.next());
  });

  it('self-gates: no click target in a world that never drew the statue', () => {
    const world = customWorld();
    setActiveWorldContent(world);
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true, world });
    expect(
      [...sim.entities.values()].some(
        (entity) => entity.templateId === REALM_BUILDER_MONUMENT_TEMPLATE_ID,
      ),
    ).toBe(false);
    expect(sim.entities.has(MONUMENT.entityId)).toBe(false);

    // The clone a custom world actually gets strips the record, which is the
    // input the gate reads: this is why the gate is spelled against the props
    // rather than against BUILTIN_WORLD.
    const cloned = clonePropsWithoutEastbrookLayout(BUILTIN_WORLD.props);
    expect(cloned.wells.some((well) => well.id === MONUMENT.id)).toBe(false);
  });

  it('blocks movement with a cylinder that hugs the sculpt', () => {
    const colliders = colliderInternalsForTest.staticWorldColliders(SEED);
    const monumentCollider = colliders.find(
      (collider) =>
        collider.type === 'circle' &&
        collider.x === MONUMENT.position.x &&
        collider.z === MONUMENT.position.z,
    );
    expect(monumentCollider).toMatchObject({ type: 'circle', r: MONUMENT.radius });
    // Tight means tight: the widest thing in the sculpt is the lantern
    // outrigger ring, which sits on a diagonal bearing, and the collider is
    // that radius rounded up by a 1cm skin rather than the well beacon's old
    // loose 1.5. Round 8 doubled the statue, so it doubled too.
    expect(MONUMENT.radius).toBe(3.19);
    const halfWidth = MONUMENT.nativeDimensions.width / 2;
    const halfDepth = MONUMENT.nativeDimensions.depth / 2;
    // Contains the art on both axes: a smaller cylinder would let a player
    // walk through a lantern.
    expect(MONUMENT.radius).toBeGreaterThanOrEqual(halfWidth);
    expect(MONUMENT.radius).toBeGreaterThanOrEqual(halfDepth);
    // And is well inside the circle that merely circumscribes the bounding
    // box, which is the loose answer this replaces (about 1.98 here).
    expect(MONUMENT.radius).toBeLessThan(Math.hypot(halfWidth, halfDepth) * 0.85);
  });

  it('keeps the plates readable from outside the cylinder', () => {
    // The monument's catchment is measured from its CENTRE, not its face, so
    // the reading spot has to fall inside it. This is the check that would
    // catch a future scale-up silently pushing players out of their own
    // inspect range, or the catchment shrinking under the collider.
    const spot = frontReadingSpot();
    const distance = Math.hypot(spot.x - MONUMENT.position.x, spot.z - MONUMENT.position.z);
    expect(distance).toBeGreaterThan(MONUMENT.radius);
    expect(distance).toBeLessThan(REALM_BUILDER_MONUMENT_INTERACT_RADIUS);
    // Tighter than the default: the whole point of the catchment is that the
    // monument never competes at the mailbox's range.
    expect(REALM_BUILDER_MONUMENT_INTERACT_RADIUS).toBeLessThan(INTERACT_RANGE);
    expect(REALM_BUILDER_MONUMENT_INTERACT_RADIUS).toBeGreaterThan(MONUMENT.radius);
  });
});

describe('inspecting the Realm Builder monument', () => {
  it('opens the roll through direct, target, and proximity interaction alike', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Reader');
    const monument = monumentEntity(sim);
    const player = standAt(sim, pid, frontReadingSpot());
    const expected = {
      type: 'realmBuilder',
      current: currentRealmBuilder(),
      past: pastRealmBuilders(),
      pid,
    };

    sim.drainEvents();
    expect(sim.pickUpObject(monument.id, pid)).toBe(true);
    expect(sim.drainEvents()).toEqual([expected]);
    // Inspecting is not looting: the monument survives being read.
    expect(monument).toMatchObject({ lootable: true, objectItemId: null });

    player.targetId = monument.id;
    sim.interact(pid);
    expect(sim.drainEvents()).toEqual([expected]);

    player.targetId = null;
    sim.interact(pid);
    expect(sim.drainEvents()).toEqual([expected]);
  });

  it('refuses from too far away and while dead', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Reader');
    const monument = monumentEntity(sim);

    standAt(sim, pid, { x: MONUMENT.position.x + 40, z: MONUMENT.position.z });
    sim.drainEvents();
    expect(sim.pickUpObject(monument.id, pid)).toBe(false);
    expect(sim.drainEvents().some((event) => event.type === 'realmBuilder')).toBe(false);

    const player = standAt(sim, pid, frontReadingSpot());
    player.dead = true;
    sim.drainEvents();
    expect(sim.pickUpObject(monument.id, pid)).toBe(false);
    expect(sim.drainEvents().some((event) => event.type === 'realmBuilder')).toBe(false);
  });

  it('is picked by the interact key only inside its own catchment', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Reader');
    const monument = monumentEntity(sim);
    const inside = REALM_BUILDER_MONUMENT_INTERACT_RADIUS - 0.05;
    const outside = REALM_BUILDER_MONUMENT_INTERACT_RADIUS + 0.05;

    // Just inside 4 yd on the plate's side: the proximity press reads the roll.
    standAt(sim, pid, westOfMonument(inside));
    sim.drainEvents();
    sim.interact(pid);
    expect(eventTypes(sim)).toContain('realmBuilder');

    // Just outside: still well inside the default 5 yd, and NOT picked. The
    // monument is a permanent object in the middle of the square, so without
    // its own catchment it would win this band from everything around it.
    standAt(sim, pid, westOfMonument(outside));
    sim.interact(pid);
    expect(eventTypes(sim)).not.toContain('realmBuilder');

    // The direct path refuses at the same line, with the sim's usual message.
    standAt(sim, pid, westOfMonument(4.5));
    expect(sim.pickUpObject(monument.id, pid)).toBe(false);
    expect(eventTypes(sim)).not.toContain('realmBuilder');
  });

  it('never takes the interact key from the mailbox 6.21 yd away', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Reader');
    const mailbox = mailboxEntity(sim);
    const span = Math.hypot(
      mailbox.pos.x - MONUMENT.position.x,
      mailbox.pos.z - MONUMENT.position.z,
    );
    expect(span).toBeCloseTo(6.21, 2);

    // Pressed against the plinth on the mailbox's side, still inside the
    // monument's catchment: the mailbox is nearer and nearest wins.
    standAt(sim, pid, towardMailbox(MONUMENT.radius + 0.2));
    sim.drainEvents();
    sim.interact(pid);
    const types = eventTypes(sim);
    expect(types).toContain('mailbox');
    expect(types).not.toContain('realmBuilder');

    // At the mailbox's own posting spot the monument is out of its catchment
    // entirely, so it is not even a candidate.
    standAt(sim, pid, EASTBROOK_LAYOUT.services.mailbox.frontStandingPoint);
    sim.interact(pid);
    const posting = eventTypes(sim);
    expect(posting).toContain('mailbox');
    expect(posting).not.toContain('realmBuilder');
  });

  it('never fills the RL observation object slot', () => {
    // An honour roll is nothing an agent can gain from, and as a permanent
    // object in the square it would otherwise shadow the mailbox in the slot.
    const sim = new Sim({ seed: SEED, playerClass: 'warrior' });
    standAt(sim, sim.playerId, frontReadingSpot());
    const obs = encodeObs(sim);
    expect(obs).toHaveLength(obsSize());
    // The nearest-interactable block (5 values) sits before the quests (2 per
    // quest) and the 3-value tail: [present, distance, sin, cos, type].
    const slotStart = obsSize() - 3 - QUEST_ORDER.length * 2 - 5;
    const [present, distance, , , type] = obs.slice(slotStart, slotStart + 5);
    const spot = frontReadingSpot();
    const toMonument = Math.hypot(spot.x - MONUMENT.position.x, spot.z - MONUMENT.position.z);
    // Either nothing is encoded, or whatever is encoded is not an object at
    // the monument's distance (0.66 is the object type; distance is /40).
    const encodedMonument =
      present === 1 && type === 0.66 && Math.abs(distance * 40 - toMonument) < 0.01;
    expect(encodedMonument).toBe(false);
  });

  it('labels the statue with a localized name, not the layout English', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const monument = monumentEntity(sim);
    expect(objectDisplayName(monument)).toBe(t('worldContent.realmBuilderMonumentName'));
    expect(objectDisplayName(monument)).toBe('Realm Builder Monument');
  });
});
