import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error - untyped zero-dep build helper (same convention as other scripts/*.mjs)
import { scanBackdropSurvival } from '../scripts/check_backdrop_survival.mjs';

// Guards the Lightning CSS backdrop-filter drop (Vite #21954 / lightningcss #695).
// scanBackdropSurvival is the pure core of scripts/check_backdrop_survival.mjs,
// which `npm run build` runs over the emitted dist CSS. These cases prove the
// check has teeth (flags a dropped twin) without false-positiving on the shapes
// our stylesheets actually ship (@supports feature queries, none pairs, both orders).

describe('scanBackdropSurvival', () => {
  it('passes a rule that keeps both twins (either authoring order)', () => {
    expect(
      scanBackdropSurvival('.a{-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px)}'),
    ).toEqual([]);
    expect(
      scanBackdropSurvival('.a{backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)}'),
    ).toEqual([]);
  });

  it('flags a rule that lost the standard backdrop-filter (the real #21954 bug)', () => {
    const v = scanBackdropSurvival('.a{-webkit-backdrop-filter:blur(2px)}', 'main.css');
    expect(v).toHaveLength(1);
    expect(v[0].standard).toEqual([]);
    expect(v[0].webkit).toEqual(['blur(2px)']);
  });

  it('flags a rule that lost the -webkit- twin', () => {
    expect(scanBackdropSurvival('.a{backdrop-filter:blur(2px)}')).toHaveLength(1);
  });

  it('flags a rule whose twins disagree on value', () => {
    expect(
      scanBackdropSurvival('.a{-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(9px)}'),
    ).toHaveLength(1);
  });

  it('flags a dropped twin even inside an @media wrapper', () => {
    expect(
      scanBackdropSurvival('@media (max-width:860px){.a{-webkit-backdrop-filter:blur(2px)}}'),
    ).toHaveLength(1);
  });

  it('does not false-positive on an @supports backdrop-filter feature query', () => {
    const css =
      '@supports ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px)))' +
      '{.h{-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px)}}';
    expect(scanBackdropSurvival(css)).toEqual([]);
  });

  it('passes a none twin pair', () => {
    expect(scanBackdropSurvival('.a{-webkit-backdrop-filter:none;backdrop-filter:none}')).toEqual(
      [],
    );
  });

  it('ignores rules with no backdrop-filter at all', () => {
    expect(scanBackdropSurvival('.a{color:red}.b{filter:blur(2px)}')).toEqual([]);
  });

  it('does not false-fail on a commented-out backdrop-filter (unminified input)', () => {
    expect(scanBackdropSurvival('.a{color:red;/* backdrop-filter: blur(2px) */}')).toEqual([]);
  });

  it('ignores a block whose only "backdrop-filter" mention is a custom property or content string', () => {
    expect(scanBackdropSurvival('.a{--note:backdrop-filter blur;color:red}')).toEqual([]);
    expect(scanBackdropSurvival('.a{content:"backdrop-filter";color:red}')).toEqual([]);
  });

  it('compares twin values whitespace-insensitively', () => {
    expect(
      scanBackdropSurvival('.a{-webkit-backdrop-filter:blur( 2px );backdrop-filter:blur(2px)}'),
    ).toEqual([]);
  });

  // Integration: when a production build is present, every emitted dist CSS file
  // (the index/play chunks from src/styles and the guide chunk from src/guide/styles.css;
  // admin ships inline styles, no separate CSS) must keep its twins. Skipped when dist/
  // is absent (e.g. a plain `npm test` with no build);
  // the build itself runs scripts/check_backdrop_survival.mjs as a blocking gate.
  it('finds no twin loss in the built dist CSS (when dist exists)', () => {
    const distDir = fileURLToPath(new URL('../dist', import.meta.url));
    if (!existsSync(distDir)) return;
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.isFile() && e.name.endsWith('.css')) files.push(full);
      }
    };
    walk(distDir);
    const violations = files.flatMap((f) =>
      scanBackdropSurvival(readFileSync(f, 'utf8'), path.basename(f)),
    );
    expect(violations).toEqual([]);
  });
});
