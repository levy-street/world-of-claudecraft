import { describe, expect, it } from 'vitest';
import type { ModularLook } from '../src/render/characters/modular';
import type { Entity } from '../src/sim/types';
import {
  type PlayerPortraitLookups,
  playerPortraitSubject,
  portraitUpdateFrames,
} from '../src/ui/player_portrait_core';

// The body rule every frame that holds a player shares (the player frame, the
// target frame, the target-of-target frame), and the matching rule that tells
// a frame a landed portrait is the one it framed. The regression this pins:
// the target frames used to draw the stock class art for every player, so a
// peer's authored face (which rides the identity wire) never reached them.

const LOOK = { app: { gender: 'female' }, worn: {} } as unknown as ModularLook;
const OTHER_LOOK = { app: { gender: 'male' }, worn: {} } as unknown as ModularLook;

function player(over: Partial<Entity> = {}): Entity {
  return {
    id: 7,
    kind: 'player',
    templateId: 'warrior',
    skin: 2,
    skinCatalog: 'class',
    ...over,
  } as Entity;
}

/** The lookups as the Hud wires them, with a fixed answer per entity. */
function lookups(look: ModularLook | null): PlayerPortraitLookups<ModularLook> {
  return {
    lookFor: () => look,
    visualKeyFor: (e) => `player_${e.templateId}_modular`,
  };
}

/** The key rule shape of portrait.ts composedPortraitKey, kept explicit so a
 *  test can name the key the frame is waiting on. */
const composedKeyOf = (visualKey: string, look: ModularLook): string =>
  `${visualKey}:mod:${look.app.gender}:headshot`;

describe('playerPortraitSubject', () => {
  it('composes a player with an authored look, peer or self alike', () => {
    expect(playerPortraitSubject(player(), lookups(LOOK))).toEqual({
      kind: 'composed',
      cls: 'warrior',
      skin: 2,
      visualKey: 'player_warrior_modular',
      look: LOOK,
    });
  });

  it('keeps the stock class art for a player with no authored look', () => {
    expect(playerPortraitSubject(player(), lookups(null))).toEqual({
      kind: 'class',
      cls: 'warrior',
      skin: 2,
    });
  });

  it('shows the mech a wearer IS in the world, over any look, with skin as chroma', () => {
    const lk = lookups(LOOK);
    expect(playerPortraitSubject(player({ skinCatalog: 'mech', skin: 3 }), lk)).toEqual({
      kind: 'mech',
      cls: 'warrior',
      chroma: 3,
    });
  });

  it('reads a missing skin as the default index', () => {
    expect(playerPortraitSubject(player({ skin: undefined }), lookups(null))).toEqual({
      kind: 'class',
      cls: 'warrior',
      skin: 0,
    });
  });
});

describe('portraitUpdateFrames', () => {
  const composed = playerPortraitSubject(player(), lookups(LOOK));
  const stock = playerPortraitSubject(player(), lookups(null));
  const mech = playerPortraitSubject(player({ skinCatalog: 'mech', skin: 3 }), lookups(LOOK));

  it('matches a composed subject on exactly its own cache key', () => {
    const own = composedKeyOf('player_warrior_modular', LOOK);
    const other = composedKeyOf('player_warrior_modular', OTHER_LOOK);
    const update = { visualKey: 'player_warrior_modular', skin: -1 };
    expect(portraitUpdateFrames(composed, { ...update, key: own }, composedKeyOf)).toBe(true);
    expect(portraitUpdateFrames(composed, { ...update, key: other }, composedKeyOf)).toBe(false);
  });

  it('also lets the stock (class, skin) headshot reach a composed subject: its interim', () => {
    expect(
      portraitUpdateFrames(composed, { visualKey: 'player_warrior', skin: 2 }, composedKeyOf),
    ).toBe(true);
    expect(
      portraitUpdateFrames(composed, { visualKey: 'player_warrior', skin: 1 }, composedKeyOf),
    ).toBe(false);
    expect(
      portraitUpdateFrames(composed, { visualKey: 'player_mage', skin: 2 }, composedKeyOf),
    ).toBe(false);
  });

  it('matches a stock subject on its (class, skin) pair and never on a composed key', () => {
    expect(
      portraitUpdateFrames(stock, { visualKey: 'player_warrior', skin: 2 }, composedKeyOf),
    ).toBe(true);
    expect(
      portraitUpdateFrames(stock, { visualKey: 'player_warrior', skin: 0 }, composedKeyOf),
    ).toBe(false);
    expect(
      portraitUpdateFrames(
        stock,
        { visualKey: 'player_warrior', skin: 2, key: composedKeyOf('player_warrior', LOOK) },
        composedKeyOf,
      ),
    ).toBe(false);
  });

  it('matches a mech wearer on the chroma atlas for their body only', () => {
    expect(portraitUpdateFrames(mech, { visualKey: 'player_mech', skin: 3 }, composedKeyOf)).toBe(
      true,
    );
    expect(portraitUpdateFrames(mech, { visualKey: 'player_mech', skin: 0 }, composedKeyOf)).toBe(
      false,
    );
    // Their class art is not what the frame shows, so its landing is not theirs.
    expect(
      portraitUpdateFrames(mech, { visualKey: 'player_warrior', skin: 3 }, composedKeyOf),
    ).toBe(false);
  });
});
