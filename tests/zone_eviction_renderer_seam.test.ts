import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// renderer.ts's evictFarZoneIfConstrained wires the pure zone_eviction_core
// policy into the live scene (constructing a real Renderer needs a WebGL
// context no unit test has, so the pure core and the terrain/water
// round-trips are tested directly; this pins the renderer-side CONTRACT no
// other suite reaches: the device gate, which position it measures from, and
// which caches it does and does not clear).
describe('renderer zone eviction seam', () => {
  const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
  const method = (): string => {
    const start = source.indexOf('private evictFarZoneIfConstrained(');
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf('\n  private pumpVisibleZonePrepareQueue(', start);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
  };

  it('is gated on GFX.constrainedMemory as its first statement, so unconstrained hosts (desktop/Android) never evict', () => {
    const body = method();
    const guardIndex = body.indexOf('if (!GFX.constrainedMemory) return;');
    expect(guardIndex).toBeGreaterThan(-1);
    // Nothing else in the method runs before the guard.
    const openBrace = body.indexOf('{');
    const between = body.slice(openBrace + 1, guardIndex).trim();
    expect(between).toBe('');
  });

  it('releases geometry through terrainView/waterView.unloadZone and drops preparedZones membership', () => {
    const body = method();
    expect(body).toContain('this.terrainView.unloadZone(zone)');
    expect(body).toContain('this.waterView.unloadZone(zone.id)');
    expect(body).toContain('this.preparedZones.delete(zoneId)');
  });

  it('never clears prewarmedZonePrograms: unloadZone releases geometry only, and the shared shader programs it tracks outlive it', () => {
    const body = method();
    expect(body).not.toContain('prewarmedZonePrograms');
  });

  it("is called with the PLAYER position, not the camera, keeping the boom arm's zoom/free-look state out of a memory-residency decision", () => {
    const start = source.indexOf('private queueVisibleZonePrepares(');
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf('\n  private evictFarZoneIfConstrained(', start);
    expect(end).toBeGreaterThan(start);
    const callerBody = source.slice(start, end);
    // Anchoring on the player (not the camera boom's zoom arm) keeps
    // zoom/free-look state out of a memory-residency decision; see
    // evictFarZoneIfConstrained's own doc comment for why the camera
    // was never actually a lag risk here.
    expect(callerBody).toContain(
      'this.evictFarZoneIfConstrained(currentZoneId, player.pos.x, player.pos.z)',
    );
    expect(callerBody).not.toContain(
      'this.evictFarZoneIfConstrained(currentZoneId, cameraX, cameraZ)',
    );
  });
});
