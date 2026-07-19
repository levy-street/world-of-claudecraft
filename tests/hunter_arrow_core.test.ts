import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HUNTER_ARROW_PROFILE } from '../src/render/hunter_arrow_core';

describe('Hunter arrow projectile profile', () => {
  it('forms a long readable shaft behind one prominent arrowhead', () => {
    expect(HUNTER_ARROW_PROFILE.length).toBeGreaterThanOrEqual(7);
    expect(HUNTER_ARROW_PROFILE[0]).toEqual(expect.objectContaining({ back: 0, head: true }));
    expect(HUNTER_ARROW_PROFILE[0].size).toBeGreaterThan(HUNTER_ARROW_PROFILE[1].size);
    expect(HUNTER_ARROW_PROFILE.slice(1).every((sample) => !sample.head)).toBe(true);
    expect(HUNTER_ARROW_PROFILE.at(-1)?.back).toBeGreaterThanOrEqual(1.5);
  });

  it('keeps the Multi-Shot style wired through the renderer and VFX painter', () => {
    const renderer = readFileSync(join(process.cwd(), 'src/render/renderer.ts'), 'utf8');
    const vfx = readFileSync(join(process.cwd(), 'src/render/vfx.ts'), 'utf8');

    expect(renderer).toContain('ev.projectileStyle');
    expect(vfx).toContain("projectileStyle === 'hunter-arrow'");
    expect(vfx).toContain('HUNTER_ARROW_PROFILE');
  });
});
