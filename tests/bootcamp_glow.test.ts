// The island coach's press-this-next glow: the two halves that must agree,
// and the strobe fix that keeps a rebuilt row's pulse continuous.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const components = readFileSync(resolve(process.cwd(), 'src/styles/components.css'), 'utf8');
const bootcamp = readFileSync(resolve(process.cwd(), 'src/ui/bootcamp.ts'), 'utf8');

describe('the coach glow pulse', () => {
  it('seeds its phase from the SAME duration the stylesheet animates', () => {
    // syncGlow writes a negative animationDelay modulo GLOW_PULSE_MS so a
    // recreated row resumes the pulse mid-cycle instead of restarting it
    // (the tracker strobe). If the CSS duration moves and the constant does
    // not, the seed wraps at the wrong point and the stutter returns.
    const css = components.match(/animation:\s*qd-coach-pulse\s+(\d+)ms/);
    expect(css, 'the .qd-coach pulse animation shorthand').not.toBeNull();
    const ts = bootcamp.match(/const GLOW_PULSE_MS = (\d+);/);
    expect(ts, 'the GLOW_PULSE_MS mirror in bootcamp.ts').not.toBeNull();
    expect(Number(ts![1])).toBe(Number(css![1]));
  });

  it('writes the phase seed only while the glow is on, and clears it after', () => {
    // A left-behind inline delay would desync the NEXT element to reuse the
    // node, so the applier clears what it set.
    expect(bootcamp).toMatch(/el\.style\.animationDelay = `-\$\{/);
    expect(bootcamp).toMatch(/el\.style\.animationDelay = '';/);
  });
});

describe('the bags-open gate', () => {
  it('reads bagsWindowShown, never a literal display compare', () => {
    // The bags open as display:flex; a 'block' compare left the Use/Equip
    // menu row glow permanently unarmed. The shared predicate owns the truth.
    expect(bootcamp).toMatch(/bagsWindowShown\(bagsEl\.style\.display\)/);
    expect(bootcamp).not.toMatch(/bagsEl\.style\.display === 'block'/);
  });
});
