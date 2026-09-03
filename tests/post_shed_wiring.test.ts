import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Source-scan guard for the WIRING of the post shed, whose logic lives in the
// pure core (post_shed_core.ts, tests/post_shed_core.test.ts) and the painter
// (post_shed.ts, tests/post_shed.test.ts). renderer.ts, perf.ts and the n8ao
// subclass hooks are not Node-testable end to end, and each pin below is a
// single, quietly reversible line whose regression every core test would
// survive. Anchored to exported symbols and call shapes, never line numbers.
const read = (...segments: string[]) =>
  readFileSync(path.join(__dirname, '..', ...segments), 'utf8');
const rendererSource = read('src', 'render', 'renderer.ts');
const postSource = read('src', 'render', 'post.ts');
const n8aoSource = read('src', 'render', 'post_n8ao.ts');
const bloomSource = read('src', 'render', 'post_bloom.ts');
const shedSource = read('src', 'render', 'post_shed.ts');
const budgetSource = read('src', 'render', 'render_budget.ts');

function methodBody(source: string, search: string): string {
  const start = source.indexOf(search);
  expect(start, `should still define ${search}`).toBeGreaterThan(-1);
  return source.slice(start, start + 4000);
}

const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('post shed renderer wiring', () => {
  it('hands the governor the static chain, the kill switch and the dev pin', () => {
    expect(rendererSource).toMatch(
      /new RenderBudgetGovernor\(\{[^}]*postShed: renderLayerDisabled\('postshed'\) \? null : GFX,[^}]*pinnedPostLevel: postShedLevelPin\(\),[^}]*\}\)/,
    );
  });

  it('applies the level through the pipeline in the one budget-application path', () => {
    const body = methodBody(rendererSource, 'private applyRenderBudgetState(');
    expect(body).toContain('this.post?.setShedLevel(state.levels.post);');
    expect(body).toContain('Math.abs(state.levels.post - previousLevels.post) >= 0.001');
    // The renderer writes no pass flag or target of its own: the painter
    // owns every write, so the fairness scan below covers the whole shed.
    expect(body).not.toMatch(/\.enabled\s*=/);
    expect(body).not.toContain('occlusionPassthrough');
  });

  it('compiles the FXAA grade twin under the presentation prewarm, scene hidden', () => {
    const body = methodBody(rendererSource, 'private renderPresentationPrewarmPass(');
    expect(body).toMatch(
      /withSceneHiddenForPresentationPrewarm\(this\.scene, \(\) => \{\s*post\.render\(\);\s*post\.prewarmShed\(\);\s*\}\)/,
    );
  });

  it('surfaces the applied rung in perfStats and the level in the quality buckets', () => {
    const stats = methodBody(rendererSource, 'perfStats(): RendererPerfStats {');
    expect(stats).toContain("postShedRung: this.post?.shedRung() ?? 'full',");
    const buckets = methodBody(rendererSource, 'private graphicsBucketLevels(');
    expect(buckets).toContain('post: state.levels.post,');
  });

  it('prints the rung on the ?perf overlay and carries the level in the fleet report', () => {
    expect(read('src', 'game', 'perf.ts')).toContain("post ${r?.postShedRung ?? '-'}");
    expect(read('src', 'game', 'perf_reporter.ts')).toContain('post: variant.levels.post,');
  });
});

describe('post shed pipeline wiring', () => {
  it('builds the twin from the same grade shape with the FXAA arm, disabled, beside the grade', () => {
    expect(postSource).toMatch(
      /const gradeFxaaTwin = plan\.shed\.gradeFxaaTwin\s*\?\s*new OutputGradePass\([\s\S]*?\{ fxaa: true \},?\s*\)\s*:\s*null;/,
    );
    expect(postSource).toContain('gradeFxaaTwin.enabled = false;');
    expect(postSource).toContain('composer.addPass(gradeFxaaTwin);');
    expect(postSource).toContain("postShedDisabled: renderLayerDisabled('postshed'),");
  });

  it('re-runs the clears after a composer resize and prewarms through the composer render', () => {
    expect(postSource).toMatch(
      /composer\.setSizeAndPixelRatio\(width, height, pixelRatio\);\s*shed\.reclear\(\);/,
    );
    expect(postSource).toContain('shed.prewarm(() => composer.render());');
  });

  it('skips every occlusion quad while in passthrough, and only those', () => {
    for (const quad of ['effectShaderQuad', 'poissonBlurQuad', 'depthDownsampleQuad']) {
      expect(n8aoSource).toContain(`skipWhilePassthrough(state.${quad}, this);`);
    }
    // The composite keeps running: it is the scene copy into the composer.
    expect(n8aoSource).not.toContain('skipWhilePassthrough(state.effectCompositerQuad');
    expect(n8aoSource).toMatch(/if \(pass\.occlusionPassthrough\) return;/);
  });

  it('bounds the bloom blur loop by the live mip count and never the composite', () => {
    expect(bloomSource).toContain(
      'const mips = Math.min(this.nMips, Math.max(0, this.activeMips));',
    );
    expect(bloomSource).toContain('for (let mip = 0; mip < mips; mip++) {');
    expect(bloomSource).toContain('this.activeMips = this.nMips;');
  });
});

describe('post shed fairness and scheduler guards', () => {
  it('the painter reads only the level it is handed: no tier, preset, profile or governor input', () => {
    const code = stripComments(shedSource);
    for (const forbidden of [
      'GFX',
      'gfx_tier',
      'fxTier',
      'data-fx-level',
      'render_budget',
      'localStorage',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
    expect(code).not.toMatch(/from '\.\/gfx'/);
  });

  it('the painter never compiles a program, resizes a target, or hides a scene object', () => {
    const code = stripComments(shedSource);
    for (const forbidden of [
      'needsUpdate',
      'setSize(',
      'new WebGLRenderTarget',
      '.visible',
      'castShadow',
      'compile(',
      'dispose(',
      'defines',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('the governor steps the level with its own ladder machinery, never a timer of its own', () => {
    const code = stripComments(budgetSource);
    expect(code).toContain("this.reduceLevel('post', this.postFloor, POST_SHED_STEP)");
    expect(code).toContain("this.raiseLevel('post', this.bands.post.baseline, POST_SHED_STEP)");
    expect(code).not.toMatch(/post(Shed)?(Enter|Exit|Dwell|Calm|Over)Seconds/);
  });
});
