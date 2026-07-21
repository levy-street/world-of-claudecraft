import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { corpseLootAvailability } from '../src/game/corpse_loot_availability';
import { handlePickedEntity, shouldApproachPickedEntity } from '../src/game/interactions';
import { tryNearbyInteraction } from '../src/game/nearby_interaction';
import { MOBS } from '../src/sim/data';
import { type Entity, INTERACT_RANGE } from '../src/sim/types';

// Phase 4 open-gate flip: the hcb wire mirror (PR 2087) made online corpse
// harvest-claim state reliable, so the helper arms main.ts calls now run with
// harvestStateReliable = TRUE by DEFAULT (no `online === null` override). A
// harvest-only corpse (componentTags, no regular loot) therefore OPENS online
// when unclaimed and STAYS CLOSED when claimed. This suite pins the flipped
// default on every arm; the pre-flip false arm stays pinned in
// tests/interactions.test.ts and tests/corpse_loot_availability.test.ts.

function corpse(overrides: Partial<Entity>): Entity {
  return {
    id: 2,
    kind: 'mob',
    // forest_wolf carries componentTags (#1140): a harvest-only corpse.
    templateId: 'forest_wolf',
    dead: true,
    lootable: true,
    loot: null,
    harvestClaimedBy: null,
    pos: { x: 1, y: 0, z: 0 },
    ...overrides,
  } as Entity;
}

function playerAt(x: number): Entity {
  return { id: 1, kind: 'player', dead: false, ghost: false, pos: { x, y: 0, z: 0 } } as Entity;
}

function rig(player: Entity, e: Entity) {
  const world = {
    playerId: 1,
    player,
    entities: new Map([
      [1, player],
      [e.id, e],
    ]),
    targetEntity: () => {},
  } as unknown as Parameters<typeof handlePickedEntity>[0];
  const hud = {
    openLoot: vi.fn(),
    showError: vi.fn(),
    closeContextMenu: () => {},
  } as unknown as Parameters<typeof handlePickedEntity>[1] & { openLoot: ReturnType<typeof vi.fn> };
  return { world, hud };
}

describe('open-gate flip: sanity on the fixture', () => {
  it('forest_wolf is a harvestable template (componentTags present)', () => {
    expect(MOBS.forest_wolf.componentTags?.length).toBeGreaterThan(0);
  });
});

describe('corpseLootAvailability with the flipped default (no third argument)', () => {
  it('an unclaimed harvest-only corpse OPENS by default (the online flip)', () => {
    const result = corpseLootAvailability(corpse({}), 1);
    expect(result.harvestable).toBe(true);
    expect(result.hasLoot).toBe(false);
    expect(result.canOpen).toBe(true);
  });

  it('a claimed harvest-only corpse STAYS CLOSED (hcb mirrored claim)', () => {
    for (const claimer of [1, 9]) {
      const result = corpseLootAvailability(corpse({ harvestClaimedBy: claimer }), 1);
      expect(result.harvestable, `claimed by ${claimer}`).toBe(false);
      expect(result.canOpen, `claimed by ${claimer}`).toBe(false);
    }
  });
});

describe('handlePickedEntity default arm (both buttons)', () => {
  it.each([0, 2])('opens an unclaimed harvest-only corpse in range with button %i', (button) => {
    const { world, hud } = rig(playerAt(0), corpse({}));
    expect(handlePickedEntity(world, hud, 2, button, 10, 20)).toBe(true);
    expect(hud.openLoot).toHaveBeenCalledWith(2, 10, 20);
  });

  it.each([0, 2])('refuses a CLAIMED harvest-only corpse with button %i', (button) => {
    const { world, hud } = rig(playerAt(0), corpse({ harvestClaimedBy: 9 }));
    expect(handlePickedEntity(world, hud, 2, button, 10, 20)).toBe(false);
    expect(hud.openLoot).not.toHaveBeenCalled();
  });

  it.each([0, 2])(
    'never opens a grace-frozen boundary corpse at interest-radius distance with button %i',
    (button) => {
      // Despawn-grace pin: an openable corpse sitting ~90 yd away (the
      // interest boundary a grace-frozen corpse can occupy) must not be
      // actionable; opening requires closing to interact range first (the
      // corpse arm gates at INTERACT_RANGE + 1).
      const far = corpse({ pos: { x: 90, y: 0, z: 0 } });
      expect(corpseLootAvailability(far, 1).canOpen).toBe(true); // availability alone is range-blind
      const { world, hud } = rig(playerAt(0), far);
      expect(handlePickedEntity(world, hud, 2, button, 10, 20)).toBe(false);
      expect(hud.openLoot).not.toHaveBeenCalled();
    },
  );

  it('opens at the exact corpse interact boundary and refuses just past it', () => {
    const boundary = corpse({ pos: { x: INTERACT_RANGE + 1, y: 0, z: 0 } });
    const inRange = rig(playerAt(0), boundary);
    expect(handlePickedEntity(inRange.world, inRange.hud, 2, 0, 10, 20)).toBe(true);

    const past = corpse({ pos: { x: INTERACT_RANGE + 1.01, y: 0, z: 0 } });
    const outOfRange = rig(playerAt(0), past);
    expect(handlePickedEntity(outOfRange.world, outOfRange.hud, 2, 0, 10, 20)).toBe(false);
    expect(outOfRange.hud.openLoot).not.toHaveBeenCalled();
  });
});

describe('shouldApproachPickedEntity default arm', () => {
  it('approaches a distant unclaimed harvest-only corpse (click-to-walk stays live)', () => {
    const far = corpse({ pos: { x: 20, y: 0, z: 0 } });
    expect(shouldApproachPickedEntity(playerAt(0), far, false)).toBe(true);
    // Even at the interest boundary the APPROACH intent survives; only the
    // OPEN is range-gated (previous describe).
    const boundary = corpse({ pos: { x: 90, y: 0, z: 0 } });
    expect(shouldApproachPickedEntity(playerAt(0), boundary, false)).toBe(true);
  });

  it('never approaches a claimed harvest-only corpse (nothing to open on arrival)', () => {
    const far = corpse({ pos: { x: 20, y: 0, z: 0 }, harvestClaimedBy: 9 });
    expect(shouldApproachPickedEntity(playerAt(0), far, false)).toBe(false);
  });
});

describe('tryNearbyInteraction default arm', () => {
  function nearbyRig(e: Entity) {
    const lootCorpse = vi.fn(() => true as const);
    const world = {
      player: playerAt(0),
      playerId: 1,
      entities: new Map([[e.id, e]]),
      lootCorpse,
      delveInteract: () => false as const,
      enterDungeon: () => false as const,
      leaveDungeon: () => false as const,
      pickUpObject: () => false as const,
      resurrectAtSpiritHealer: () => false as const,
      nodeHarvestableByMe: () => true,
      harvestNode: () => true as const,
    } as unknown as Parameters<typeof tryNearbyInteraction>[0];
    const hud = {
      openMailbox: () => {},
      openQuestDialog: () => {},
      openDelveBoard: () => {},
      showError: vi.fn(),
    } as unknown as Parameters<typeof tryNearbyInteraction>[1] & {
      showError: ReturnType<typeof vi.fn>;
    };
    return { world, hud, lootCorpse };
  }

  it('dispatches a lootable corpse without any harvest-state argument (the default arm)', () => {
    const withLoot = corpse({ loot: { copper: 5, items: [] } });
    const { world, hud, lootCorpse } = nearbyRig(withLoot);
    expect(tryNearbyInteraction(world, hud, [], 'far', 'notReady', 'nothing')).toBe(true);
    expect(lootCorpse).toHaveBeenCalledWith(2);
  });

  it('a harvest-only corpse does not capture the interact key (loot-first contract, unchanged by the flip)', () => {
    // The nearby-interact corpse pick keys off hasLoot, not canOpen: harvest
    // opens through the click path (handlePickedEntity above). Pinned so a
    // future change to that contract is deliberate.
    const { world, hud, lootCorpse } = nearbyRig(corpse({}));
    expect(tryNearbyInteraction(world, hud, [], 'far', 'notReady', 'nothing')).toBe(false);
    expect(lootCorpse).not.toHaveBeenCalled();
    expect(hud.showError).toHaveBeenCalledWith('nothing');
  });
});

describe('main.ts no longer overrides the reliable default', () => {
  it('the old offline-only gate idiom (online === null) is gone from src/main.ts', () => {
    // The flip's whole point: the three call sites (tryNearbyInteraction,
    // handlePickedEntity, shouldApproachPickedEntity) trust the hcb mirror and
    // lean on the helpers' default parameter. Reintroducing the pre-flip
    // `online === null` reliability override must re-pin this deliberately.
    const source = readFileSync(path.resolve(process.cwd(), 'src/main.ts'), 'utf8');
    expect(source.includes('online === null')).toBe(false);
  });
});
