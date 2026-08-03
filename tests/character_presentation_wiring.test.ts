import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
const characterVisual = readFileSync(
  new URL('../src/render/characters/visual.ts', import.meta.url),
  'utf8',
);

describe('character presentation sleep wiring', () => {
  it('routes hidden cosmetic rigs through bounded off-screen advancement', () => {
    expect(renderer).toContain(
      'const characterCasting = characterPresentationCasting(\n        e.castingAbility,\n        waterJetVisualChannel,\n        visuallyDead,',
    );
    expect(renderer).toContain(
      'const actionablePose = animatesEveryFrame(\n        id,\n        p.id,\n        p.targetId,\n        characterCasting,',
    );
    expect(renderer).toContain(
      'const runCharacterPresentation = shouldRunCharacterPresentationWork(',
    );
    expect(renderer).toContain('if (runCharacterPresentation) active.update(dt, st, animate);');
    expect(renderer).toContain('else active.advanceOffscreen(dt);');
    expect(renderer).toContain('if (runCharacterPresentation) v.visual.updateWeaponVfx(dt);');
    expect(renderer).toContain('v.mountVisual.advanceOffscreen(dt);');
  });

  it('ticks deferred weapon stow transitions while a rig is off screen', () => {
    const start = characterVisual.indexOf('advanceOffscreen(dt: number): void {');
    const end = characterVisual.indexOf('\n  /**', start + 1);
    const offscreenBlock = characterVisual.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(offscreenBlock).toContain('tickStow(this.stow, dt)');
    expect(offscreenBlock).toContain("if (stowTick === 'swap') this.applyStowSwap();");
    expect(offscreenBlock).toContain('this.endStowGesture();');
  });

  it('persists the Recklessness latch across camera re-entry and clears it on aura end', () => {
    expect(renderer).toContain('const nextRecklessSkullsLatch = nextRecklessnessSkullsLatch(');
    expect(renderer).toContain(
      'const spawnRecklessnessSkulls = nextRecklessSkullsLatch && !recklessSkullsSpawned;',
    );
    expect(renderer).toContain('v.recklessSkullsSpawned = nextRecklessSkullsLatch;');
  });

  it('sleeps ability VFX semantically while mount particles remain presentation-gated', () => {
    const mountStart = renderer.indexOf('if (v.mountVisual && mountSpec && mountShown) {');
    const abilityStart = renderer.indexOf('// per-ability windup orb + buff-orbit bands');
    expect(mountStart).toBeGreaterThan(-1);
    expect(abilityStart).toBeGreaterThan(mountStart);

    const mountBlock = renderer.slice(mountStart, abilityStart);
    expect(mountBlock).toContain('if (runCharacterPresentation) {');
    expect(mountBlock).toContain('this.vfx.mountSlimeTrail');
    expect(mountBlock).toContain('this.vfx.mountExhaust');
    expect(renderer.slice(abilityStart)).toContain(
      'this.abilityVfx.syncEntity(e, runCharacterPresentation);',
    );
    expect(renderer.slice(abilityStart)).toContain('if (runCharacterPresentation) {');
  });
});
