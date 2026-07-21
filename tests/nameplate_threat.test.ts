import { describe, expect, it } from 'vitest';
import { isMobThreateningViewer } from '../src/render/nameplate_threat';

const ME = 7;
const mob = (overrides: any) => ({
  id: 1,
  kind: 'mob',
  dead: false,
  ownerId: null,
  aggroTargetId: null,
  ...overrides,
}) as any;

describe('threat-aware nameplate policy', () => {
  it('flags a living wild mob aggroed on me', () => {
    expect(isMobThreateningViewer(mob({ aggroTargetId: ME }), ME)).toBe(true);
  });

  it('ignores a mob aggroed on someone else', () => {
    expect(isMobThreateningViewer(mob({ aggroTargetId: 99 }), ME)).toBe(false);
  });

  it('ignores a mob with no target', () => {
    expect(isMobThreateningViewer(mob({ aggroTargetId: null }), ME)).toBe(false);
  });

  it('never flags a dead mob (corpse)', () => {
    expect(isMobThreateningViewer(mob({ aggroTargetId: ME, dead: true }), ME)).toBe(false);
  });

  it('never flags my own controlled pet, even if its aggro field points at me', () => {
    expect(isMobThreateningViewer(mob({ aggroTargetId: ME, ownerId: ME }), ME)).toBe(false);
  });

  it('only applies to mobs, not players/npcs/objects', () => {
    expect(isMobThreateningViewer(mob({ kind: 'player', aggroTargetId: ME }), ME)).toBe(false);
    expect(isMobThreateningViewer(mob({ kind: 'npc', aggroTargetId: ME }), ME)).toBe(false);
  });
});
