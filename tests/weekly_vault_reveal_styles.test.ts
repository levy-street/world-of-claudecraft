// The weekly vault opening stylesheet contract (src/styles/components.css,
// weekly rewards section) against the choreography core it animates.
//
// The regression this file exists for: the loot (item icon + name) once faded
// in through a CSS transition. The reveal controller adds the open class in
// the same task that inserts the tile, before the element's first style pass,
// so the transition had no start value, never ran, and the item name sat at
// full opacity over a still-shut door. The loot reveal is a keyframe with a
// backwards fill (the delay holds the hidden frame however the class landed),
// and it starts only once the door has swung clear, proven here against the
// door's own swing keyframes.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  VAULT_PARTICLE_BOX,
  VAULT_TIMELINE,
  vaultRayVars,
  vaultRingVars,
  vaultStarVars,
  vaultStreakVars,
  vaultTimelineVars,
  weeklyVaultBurstLayout,
} from '../src/ui/weekly_vault_burst_core';

const css = readFileSync(join(__dirname, '../src/styles/components.css'), 'utf8').replace(
  /\r\n/g,
  '\n',
);
const banner = css.indexOf('/* ---------- weekly rewards ---------- */');
const nextBanner = css.indexOf('/* ---------- ', banner + 1);
const section = css.slice(banner, nextBanner < 0 ? undefined : nextBanner);
const stripped = section.replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of one rule, by exact selector text (a rule starts on its
 *  own indented line; the same selector closing a comma list is not it). */
function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const at = stripped.search(new RegExp(`(?<!,)\\n  ${escaped} \\{`));
  expect(at, `rule ${selector}`).toBeGreaterThanOrEqual(0);
  return stripped.slice(at, stripped.indexOf('}', at));
}
/** A whole @keyframes body. */
function keyframes(name: string): string {
  const at = stripped.indexOf(`@keyframes ${name} {`);
  expect(at, `@keyframes ${name}`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = stripped.indexOf('{', at); i < stripped.length; i++) {
    if (stripped[i] === '{') depth++;
    else if (stripped[i] === '}' && --depth === 0) return stripped.slice(at, i);
  }
  throw new Error(`unterminated @keyframes ${name}`);
}
/** One keyframe block (`34% {...}`) out of a keyframes body. */
function frame(body: string, stop: string): string {
  const at = body.indexOf(`${stop} {`);
  expect(at, `keyframe ${stop}`).toBeGreaterThanOrEqual(0);
  return body.slice(at, body.indexOf('}', at));
}
/** y of a CSS cubic-bezier at progress x (x is monotonic on a valid curve). */
function bezierY(x1: number, y1: number, x2: number, y2: number, x: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 48; i++) {
    const u = (lo + hi) / 2;
    const bx = 3 * (1 - u) ** 2 * u * x1 + 3 * (1 - u) * u ** 2 * x2 + u ** 3;
    if (bx < x) lo = u;
    else hi = u;
  }
  const u = (lo + hi) / 2;
  return 3 * (1 - u) ** 2 * u * y1 + 3 * (1 - u) * u ** 2 * y2 + u ** 3;
}

describe('weekly vault reveal styles: the loot cannot appear before the door is open', () => {
  it('reveals the loot with a delayed backwards-filled keyframe, never a transition', () => {
    const open = block('.vault-is-open :where(.vault-reveal-loot)');
    expect(open).toMatch(
      /animation:\s*vault-loot-reveal\s+var\(--vault-t-loot-fade\)\s+var\(--vault-ease-settle\)\s+calc\(var\(--vault-t-loot\) - var\(--vault-elapsed\)\)\s+both;/,
    );
    expect(open).not.toContain('transition');
    expect(block('.vault-reveal-loot')).not.toContain('transition');
    expect(section).not.toContain('transition-delay');
    // The icon pop rides the same gate.
    expect(block('.vault-is-open :where(.vault-reveal-loot > :first-child)')).toContain(
      'calc(var(--vault-t-loot) - var(--vault-elapsed)) both',
    );
  });

  it('holds the loot invisible through the delay: the 0% frame is hidden AND transparent', () => {
    const frames = keyframes('vault-loot-reveal');
    const first = frame(frames, '0%');
    expect(first).toContain('visibility: hidden');
    expect(first).toContain('opacity: 0');
    expect(frame(frames, '100%')).toContain('opacity: 1');
  });

  it('pops the loot from the middle of the doorway, never sliding it up from the bottom', () => {
    expect(block('.vault-reveal-loot')).toContain('transform: scale(0.35)');
    const pop = keyframes('vault-loot-reveal');
    expect(frame(pop, '0%')).toContain('transform: scale(0.35)');
    expect(frame(pop, '0%')).toContain('animation-timing-function: var(--vault-ease-burst)');
    expect(frame(pop, '100%')).toContain('transform: scale(1)');
    expect(pop).not.toContain('translate');
    expect(keyframes('vault-loot-arrival')).not.toContain('translate');
    // The loot layer sits above every light layer, so it covers the strokes there.
    expect(block('.vault-reveal-loot')).toContain('z-index: 12');
  });

  it('starts the loot only once the door has swung clear, solved from the swing keyframes', () => {
    const swing = block('.vault-is-open :where(.vault-reveal-door)');
    const [, seconds] =
      swing.match(
        /animation: vault-heavy-swing (\d+(?:\.\d+)?)s linear calc\(0ms - var\(--vault-elapsed\)\) both/,
      ) ?? [];
    const total = Number(seconds) * 1000;
    const frames = keyframes('vault-heavy-swing');
    // The real swing: from the 28% frame (a small counter-lean) to the 88%
    // frame (the overshoot before the settle) on its own bezier.
    const from = frame(frames, '28%');
    const to = frame(frames, '88%');
    const [, fromDeg] = from.match(/rotateY\((-?\d+)deg\)/) ?? [];
    const [, x1, y1, x2, y2] =
      from.match(
        /animation-timing-function: cubic-bezier\(([\d.]+), ([\d.]+), ([\d.]+), ([\d.]+)\)/,
      ) ?? [];
    const [, toDeg] = to.match(/rotateY\((-?\d+)deg\)/) ?? [];
    const angleAt = (ms: number) => {
      const p = ms / total;
      if (p >= 0.88) return Math.abs(Number(toDeg));
      const x = (p - 0.28) / (0.88 - 0.28);
      const y = bezierY(Number(x1), Number(y1), Number(x2), Number(y2), x);
      return Math.abs(Number(fromDeg)) + y * (Math.abs(Number(toDeg)) - Math.abs(Number(fromDeg)));
    };
    expect(VAULT_TIMELINE.doorOpenMs).toBe(0.88 * total);
    // Door-clear means the doorway shows (past 60 degrees), and the loot waits for it.
    expect(angleAt(VAULT_TIMELINE.doorClearMs)).toBeGreaterThanOrEqual(60);
    expect(VAULT_TIMELINE.lootMs).toBeGreaterThanOrEqual(VAULT_TIMELINE.doorClearMs);
    expect(angleAt(VAULT_TIMELINE.lootMs)).toBeGreaterThanOrEqual(60);
    // Teeth: the solver really reads the curve (a mid-swing time is not clear).
    expect(angleAt(VAULT_TIMELINE.burstMs + 200)).toBeLessThan(60);
  });
});

describe('weekly vault reveal styles: the burst reads the core, element by element', () => {
  it('animates each ray, star, streak and ring by its own duration AND delay vars', () => {
    const pairs: Array<[string, string]> = [
      ['.vault-is-open :where(.vault-light-spill i)', 'ray'],
      ['.vault-is-open :where(.vault-burst-stars i)', 'star'],
      ['.vault-is-open :where(.vault-burst-streaks i)', 'streak'],
      ['.vault-is-open :where(.vault-opening-rings i)', 'ring'],
    ];
    for (const [selector, family] of pairs) {
      const rule = block(selector);
      expect(rule, selector).toContain(`var(--vault-${family}-duration)`);
      expect(rule, selector).toContain(`var(--vault-${family}-delay)`);
      expect(rule, selector).toMatch(/animation:[^;]* both;/);
    }
    // Star twinkle keeps its own period and cycle count; the beams fan on their own drift.
    const twinkle = block('.vault-is-open :where(.vault-burst-stars i)::before');
    expect(twinkle).toContain('var(--vault-star-twinkle)');
    expect(twinkle).toContain('var(--vault-star-twinkles)');
    expect(keyframes('vault-ray-drift')).toContain('var(--vault-ray-drift)');
    expect(block('.vault-light-spill i::before')).toContain('opacity: var(--vault-ray-peak)');
  });

  it('rays trim outward from the centre through a feathered window: head first, tail follows, no fade', () => {
    const rule = block('.vault-is-open :where(.vault-light-spill i)');
    expect(rule).toContain('vault-ray-drift');
    expect(rule).toContain('vault-ray-sweep');
    // A soft-edged mask twice the beam long, parked behind the centre at rest
    // (nothing shows until the sweep slides it in). Never a hard inset clip.
    const ray = block('.vault-light-spill i');
    expect(ray).toMatch(
      /mask-image: linear-gradient\(\s*90deg,\s*transparent,\s*var\(--color-white\) 15%,\s*var\(--color-white\) 85%,\s*transparent\s*\)/,
    );
    expect(ray).toContain('mask-size: 200% 100%');
    expect(ray).toContain('mask-repeat: no-repeat');
    expect(ray).toContain('mask-position: 200% 0');
    expect(ray).not.toContain('clip-path');
    const sweep = keyframes('vault-ray-sweep');
    expect(frame(sweep, '0%')).toContain('mask-position: 200% 0');
    expect(frame(sweep, '0%')).toContain('animation-timing-function: var(--vault-ease-burst)');
    expect(frame(sweep, '34%')).toContain('mask-position: 40% 0');
    expect(frame(sweep, '100%')).toContain('mask-position: -100% 0');
    expect(sweep).not.toContain('opacity');
    expect(sweep).not.toContain('clip-path');
    // The old in-place fade is gone for good.
    expect(stripped).not.toContain('vault-ray-burst');
  });

  it('every --vault-* read is minted by the core or declared in the section, and nothing minted is dead', () => {
    const layout = weeklyVaultBurstLayout();
    const minted = new Set([
      ...Object.keys(vaultTimelineVars()),
      ...Object.keys(vaultRayVars(layout.rays[0])),
      ...Object.keys(vaultStarVars(layout.stars[0])),
      ...Object.keys(vaultStreakVars(layout.streaks[0])),
      ...Object.keys(vaultRingVars(layout.rings[0])),
    ]);
    const declaredHere = new Set(
      [...stripped.matchAll(/(--vault-[a-z0-9-]+)\s*:/g)].map((m) => m[1]),
    );
    const reads = new Set(
      [...stripped.matchAll(/var\(\s*(--vault-[a-z0-9-]+)\s*\)/g)].map((m) => m[1]),
    );
    expect(reads.size).toBeGreaterThan(20);
    for (const name of reads)
      expect(minted.has(name) || declaredHere.has(name), `undeclared read ${name}`).toBe(true);
    for (const name of minted) expect(reads.has(name), `dead var ${name}`).toBe(true);
  });

  it('particles travel in multiples of the box the core converts into', () => {
    const rule = block('.vault-burst-streaks i,\n  .vault-burst-stars i');
    expect(rule).toContain(`width: ${VAULT_PARTICLE_BOX}%`);
    expect(rule).toContain(`height: ${VAULT_PARTICLE_BOX}%`);
    expect(keyframes('vault-star-burst')).toContain(
      'translate(var(--vault-star-x), var(--vault-star-y))',
    );
    expect(keyframes('vault-streak-burst')).toContain(
      'translate(var(--vault-streak-x), var(--vault-streak-y))',
    );
  });

  it('bursts on a fast-out, long-settle curve; stars, streaks and the flash then fade', () => {
    const [, x1, y1, x2, y2] = (
      block('.weekly-vault-illustration').match(
        /--vault-ease-burst: cubic-bezier\(([\d.]+), ([\d.]+), ([\d.]+), ([\d.]+)\)/,
      ) ?? []
    ).map(Number);
    expect(x1).toBeLessThan(0.2);
    expect(y1).toBeGreaterThan(0.7);
    expect(x2).toBeLessThan(0.3);
    expect(y2).toBe(1);
    for (const name of ['vault-star-burst', 'vault-streak-burst', 'vault-core-flash']) {
      const frames = keyframes(name);
      expect(frame(frames, '0%'), name).toContain(
        'animation-timing-function: var(--vault-ease-burst)',
      );
      expect(frame(frames, '100%'), name).toContain('opacity: 0');
    }
  });

  it('leaks light around the door from the inside on the click, over the frame and under the door', () => {
    expect(block('.vault-reveal-frame')).toContain('z-index: 6');
    expect(block('.vault-reveal-door')).toContain('z-index: 8');
    const light = block('.vault-light');
    expect(light).toContain('z-index: 7');
    // Hinge side: the light ends at the doorway's inner edge (with its chamfers)
    // and never sits behind the open door; the other three sides run free.
    expect(light).toMatch(
      /clip-path: polygon\(\s*13% 21%,\s*18% 15%,\s*18% -300%,\s*400% -300%,\s*400% 400%,\s*18% 400%,\s*18% 85%,\s*13% 79%\s*\)/,
    );
    expect(
      block(
        '.vault-seam-glow,\n  .vault-seam-line,\n  .vault-opening-flash,\n  .vault-light-spill,\n  .vault-opening-rings,\n  .vault-burst-streaks,\n  .vault-burst-stars',
      ),
    ).not.toContain('z-index');
    // The halo and the bloom are true circles whose fade ends inside the tile
    // (closest-side), so neither reads as a lit square; the halo still spans
    // past the door polygon (15% / 13%) and its rim shows softly with no blur.
    const halo = block('.vault-seam-glow');
    expect(halo).toContain('inset: 0');
    expect(halo).toContain('border-radius: 50%');
    expect(halo).toContain('circle closest-side at 50% 50%');
    expect(halo).toContain('transparent 100%');
    const bloom = block('.vault-opening-flash');
    expect(bloom).toContain('border-radius: 50%');
    expect(bloom).toContain('circle closest-side at 50% 50%');
    expect(block('.vault-seam-line')).toContain('evenodd');
    expect(block('.vault-is-open :where(.vault-seam-glow)')).toContain(
      'calc(var(--vault-t-charge) - var(--vault-elapsed)) both',
    );
    // The charge picks up near the charging glow's resting level (no blink to
    // black at the online handoff), and charging never outranks an open stage.
    expect(frame(keyframes('vault-seam-charge'), '0%')).toContain('opacity: 0.45');
    const charging = block('.vault-is-charging:not(.vault-is-open) .vault-seam-glow');
    expect(charging).toContain('opacity: 0.55');
    expect(charging).toContain('animation-play-state: var(--fx-ambient-anim, running)');
    expect(stripped).not.toMatch(/\n {2}\.vault-is-charging \./);
  });

  it('scales the decorative glow with the graphics shadow tier', () => {
    for (const selector of [
      '.vault-seam-glow',
      '.vault-opening-rings i',
      '.vault-burst-stars i::before',
    ])
      expect(block(selector), selector).toContain('var(--fx-shadow)');
  });

  it('keeps the rarity colour: every light element derives from the vault glow token', () => {
    // On the stage, so the loot (a trigger sibling) resolves the curve too: an
    // unresolved var() makes the whole animation shorthand invalid, which is
    // exactly how the loot would silently lose its delayed reveal.
    expect(block('.weekly-vault-illustration')).toContain(
      '--vault-light-core: color-mix(in srgb, var(--color-white) 78%, var(--weekly-vault-glow))',
    );
    expect(block('.weekly-vault-illustration')).toContain('--vault-ease-settle:');
    expect(block('.vault-reveal-trigger')).not.toContain('--vault-ease');
    for (const selector of [
      '.vault-seam-glow',
      '.vault-opening-flash',
      '.vault-light-spill i::before',
      '.vault-opening-rings i',
      '.vault-burst-streaks i::before',
      '.vault-burst-stars i::before',
    ])
      expect(block(selector), selector).toContain('var(--weekly-vault-glow)');
    expect(block('.weekly-vault-normal')).toContain('--weekly-vault-glow:');
    expect(block('.weekly-vault-heroic')).toContain('--weekly-vault-glow:');
  });

  it('suppresses every layer once revealed and under reduced motion, with blanket selectors', () => {
    const revealed = block(
      '.vault-is-open.vault-is-revealed .vault-reveal-trigger,\n  .vault-is-open.vault-is-revealed .vault-reveal-trigger *,\n  .vault-is-open.vault-is-revealed .vault-reveal-trigger *::before,\n  .vault-is-open.vault-is-revealed .vault-reveal-trigger *::after,\n  .vault-is-open.vault-is-revealed .vault-reveal-loot,\n  .vault-is-open.vault-is-revealed .vault-reveal-loot > :first-child',
    );
    expect(revealed).toContain('animation: none');
    expect(revealed).toContain('transition: none');
    const reduced = stripped.slice(stripped.indexOf('@media (prefers-reduced-motion: reduce)'));
    for (const selector of [
      '.vault-is-open .vault-reveal-trigger *::before',
      '.vault-is-open .vault-reveal-trigger *::after',
      '.vault-is-charging .vault-reveal-trigger *',
      '.vault-is-open .vault-reveal-loot > :first-child',
    ])
      expect(reduced, selector).toContain(selector);
    // Every open-state rule stays below the blankets in specificity via :where(),
    // so neither blanket depends on source order.
    const openRules = [...stripped.matchAll(/\n {2}\.vault-is-open ([^{]+) \{/g)].map((m) => m[1]);
    expect(openRules.length).toBeGreaterThanOrEqual(15);
    for (const selector of openRules) expect(selector, selector).toContain(':where(');
  });

  it('resumes across a repaint: every open-state animation offsets its delay by --vault-elapsed', () => {
    expect(block('.weekly-vault-illustration')).toContain('--vault-elapsed: 0ms');
    const openRules = [
      ...stripped.matchAll(/\n {2}\.vault-is-open [^{]+\{[^}]*animation:[^;]*;/g),
    ].map((m) => m[0]);
    expect(openRules.length).toBeGreaterThanOrEqual(15);
    for (const rule of openRules)
      expect(rule, rule.trim().slice(0, 60)).toMatch(/animation:[^;]*var\(--vault-elapsed\)[^;]*;/);
  });

  it('keeps the light inside the card, clipped by the tile exactly like the door', () => {
    expect(block('.weekly-milestone')).toContain('overflow: hidden');
    expect(stripped).not.toContain(':has(.vault-is-open');
    expect(stripped).not.toContain('contain: paint');
  });
});
