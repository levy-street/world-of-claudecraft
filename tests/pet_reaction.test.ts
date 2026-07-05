import { describe, expect, it } from 'vitest';
import {
  isFriendlyPet,
  isOwnedPetHostile,
  mobNameColor,
  mobTooltipConColor,
} from '../src/render/reaction';

const ME = 7;
const ENEMY = 9;
const mob = (overrides: any) =>
  ({
    id: 1,
    kind: 'mob',
    dead: false,
    hostile: false,
    ownerId: null,
    level: 10,
    ...overrides,
  }) as any;
const player = (id: number) => ({ id, kind: 'player', dead: false }) as any;

// The viewer is hostile to ENEMY (e.g. a PvP duel/arena opponent) and friendly
// to everyone else.
const ents = new Map<number, any>([
  [ME, player(ME)],
  [ENEMY, player(ENEMY)],
]);
const isPlayerHostile = (p: any) => p.id === ENEMY;

describe('owned-pet hostility (renderer reaction)', () => {
  it('a player-owned friendly pet is NOT hostile to the viewer', () => {
    expect(isOwnedPetHostile(mob({ ownerId: ME }), ents, isPlayerHostile)).toBe(false);
  });

  it("an enemy player's pet IS hostile to the viewer (PvP)", () => {
    expect(isOwnedPetHostile(mob({ ownerId: ENEMY }), ents, isPlayerHostile)).toBe(true);
  });

  it('a pet whose owner is gone falls back to its own hostile flag', () => {
    expect(isOwnedPetHostile(mob({ ownerId: 404, hostile: false }), ents, isPlayerHostile)).toBe(
      false,
    );
    expect(isOwnedPetHostile(mob({ ownerId: 404, hostile: true }), ents, isPlayerHostile)).toBe(
      true,
    );
  });
});

describe('isFriendlyPet', () => {
  it('true for a friendly owned pet', () => {
    expect(isFriendlyPet(mob({ ownerId: ME }), ents, isPlayerHostile)).toBe(true);
  });
  it("false for an enemy's pet", () => {
    expect(isFriendlyPet(mob({ ownerId: ENEMY }), ents, isPlayerHostile)).toBe(false);
  });
  it('false for a wild (unowned) mob', () => {
    expect(isFriendlyPet(mob({ ownerId: null, hostile: true }), ents, isPlayerHostile)).toBe(false);
  });
});

describe('mobNameColor', () => {
  it('a friendly pet gets friendly green regardless of level difference', () => {
    // diff of +5 would otherwise be the scary red (#ff4444) — the original bug.
    expect(mobNameColor(5, false, true)).toBe('#9fdc7f');
  });
  it('preserves the classic con colors for wild mobs (unchanged shipped nameplate bands)', () => {
    expect(mobNameColor(5, false, false)).toBe('#ff4444');
    expect(mobNameColor(2, false, false)).toBe('#ffaa33');
    expect(mobNameColor(0, false, false)).toBe('#ffe97a');
    expect(mobNameColor(-3, false, false)).toBe('#7fdc4f');
    expect(mobNameColor(-9, false, false)).toBe('#9d9d9d');
  });
  it('pins the exact nameplate con-bucket boundaries', () => {
    // >=3 red; >=1 orange; >=-2 yellow; >=-5 green; below grey.
    expect(mobNameColor(3, false, false)).toBe('#ff4444');
    expect(mobNameColor(1, false, false)).toBe('#ffaa33');
    expect(mobNameColor(-2, false, false)).toBe('#ffe97a');
    expect(mobNameColor(-5, false, false)).toBe('#7fdc4f');
    expect(mobNameColor(-6, false, false)).toBe('#9d9d9d');
  });
  it('a corpse is grey even for a friendly pet', () => {
    expect(mobNameColor(5, true, true)).toBe('#999');
  });
  it('dead wins over the con color for a wild mob too', () => {
    expect(mobNameColor(5, true, false)).toBe('#999');
  });
});

describe('mobTooltipConColor', () => {
  it('uses the classic con SPREAD, distinct from the nameplate bands', () => {
    // red only at 5+ above (nameplate goes red at 3+); orange 3-4; yellow across
    // the even band -2..+2; green -3..-5; grey 6+ below.
    expect(mobTooltipConColor(6, false, false)).toBe('#ff4444');
    expect(mobTooltipConColor(4, false, false)).toBe('#ffaa33');
    expect(mobTooltipConColor(0, false, false)).toBe('#ffe97a');
    expect(mobTooltipConColor(-4, false, false)).toBe('#7fdc4f');
    expect(mobTooltipConColor(-9, false, false)).toBe('#9d9d9d');
  });
  it('pins the exact tooltip con-bucket boundaries', () => {
    // >=5 red; >=3 orange; >=-2 yellow; >=-5 green; below grey.
    expect(mobTooltipConColor(5, false, false)).toBe('#ff4444');
    expect(mobTooltipConColor(4, false, false)).toBe('#ffaa33');
    expect(mobTooltipConColor(3, false, false)).toBe('#ffaa33');
    expect(mobTooltipConColor(2, false, false)).toBe('#ffe97a');
    expect(mobTooltipConColor(-2, false, false)).toBe('#ffe97a');
    expect(mobTooltipConColor(-3, false, false)).toBe('#7fdc4f');
    expect(mobTooltipConColor(-5, false, false)).toBe('#7fdc4f');
    expect(mobTooltipConColor(-6, false, false)).toBe('#9d9d9d');
  });
  it('a 4-above mob is orange in the tooltip but red on the nameplate', () => {
    // The whole point of the split: same mob, different palette.
    expect(mobTooltipConColor(4, false, false)).toBe('#ffaa33');
    expect(mobNameColor(4, false, false)).toBe('#ff4444');
  });
  it('honors the corpse and friendly-pet overrides like the nameplate color', () => {
    expect(mobTooltipConColor(6, true, false)).toBe('#999');
    expect(mobTooltipConColor(6, false, true)).toBe('#9fdc7f');
  });
});
