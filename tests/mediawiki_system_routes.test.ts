import { describe, expect, it } from 'vitest';
import { systemRouteMap, systemRoutes } from '../scripts/mediawiki/system_routes';
import { BUILTIN_WORLD } from '../src/sim/data';

describe('system guide navigation', () => {
  it('maps the actual starting and reward locations and retains instructions for moving objectives', () => {
    const { pos } = BUILTIN_WORLD.npcs.contract_clerk_tobias_wren;
    const contract = systemRoutes['Guild contracts'];
    expect(contract.points).toContainEqual(
      expect.objectContaining({ step: 'Start', x: pos.x, z: pos.z }),
    );
    expect(contract.points).toContainEqual(
      expect.objectContaining({ step: 'Reward', label: expect.stringContaining('Garrick Holt') }),
    );
    expect(contract.points.some((p) => p.frame !== 'Overworld' && p.step === 2)).toBe(true);
    const map = systemRouteMap('Guild contracts', '');
    expect(map).toContain('R marks where you get your reward or arrive');
    expect(map).toContain('only when your contract');
  });
  it('distinguishes geography-free activities from retired content', () => {
    const talents = systemRouteMap('Specialization and talents', '');
    expect(talents).toContain('=== Action route ===');
    expect(talents).not.toContain('class="woc-map"');
    expect(systemRouteMap('Protect Yumi', "'''Retired.'''")).toBe('');
    expect(systemRouteMap('Referral cards', '')).toContain('Map numbers refer to stamps');
  });
  it('supplies coordinates or a navigable screen sequence for every authored route', () => {
    for (const [name, r] of Object.entries(systemRoutes)) {
      expect(r.points.length || (r.flow?.length ?? 0), name).toBeGreaterThan(0);
      for (const p of r.points) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.z), name).toBe(true);
        expect(p.label.trim(), name).not.toBe('');
      }
    }
  });
});
