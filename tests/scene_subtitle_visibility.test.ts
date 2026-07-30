// @vitest-environment jsdom
// Computed-style regression for the shipped subtitle visibility bug. This
// bundles the real style barrel, constructs the real painter, and reads the
// resulting cascade. A fake writer host alone cannot catch a stylesheet
// default that defeats an inline reveal.

import path from 'node:path';
import { bundle } from 'lightningcss';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SceneOverlayModel } from '../src/ui/hud/scene/scene_overlay_view';
import { SceneOverlayWindow } from '../src/ui/hud/scene/scene_overlay_window';
import { makeWriterFacet } from '../src/ui/painter_host';

function flattenTopLevelLayers(css: string): string {
  const withoutDeclarations = css.replace(/@layer\s+[^{};]+;/g, '');
  let cursor = 0;
  let flattened = '';
  while (cursor < withoutDeclarations.length) {
    const marker = withoutDeclarations.indexOf('@layer', cursor);
    if (marker < 0) return flattened + withoutDeclarations.slice(cursor);
    flattened += withoutDeclarations.slice(cursor, marker);
    const open = withoutDeclarations.indexOf('{', marker);
    if (open < 0) throw new Error('real style barrel has an unterminated layer');
    let depth = 1;
    let close = open + 1;
    while (close < withoutDeclarations.length && depth > 0) {
      if (withoutDeclarations[close] === '{') depth++;
      if (withoutDeclarations[close] === '}') depth--;
      close++;
    }
    if (depth !== 0) throw new Error('real style barrel has unbalanced layer braces');
    flattened += withoutDeclarations.slice(open + 1, close - 1);
    cursor = close;
  }
  return flattened;
}

function model(lineKey: string | null): SceneOverlayModel {
  return {
    letterbox: true,
    skipHintVisible: false,
    speakerKey: null,
    lineKey,
    announcementId: lineKey === null ? 0 : 1,
    fadeOpacity: 0,
    cinematic: true,
  };
}

beforeEach(() => {
  document.body.replaceChildren();
  document.head.replaceChildren();
  const shippingCss = bundle({
    // import.meta.url is an HTTP URL under the jsdom runner, so resolve from
    // the Vitest project root like the other jsdom source-reading tests.
    filename: path.resolve(process.cwd(), 'src/styles/index.css'),
    minify: false,
  }).code.toString();
  const style = document.createElement('style');
  // jsdom does not apply cascade layers to computed style. Flatten only the
  // layer wrappers after Lightning CSS resolves the shipping barrel imports.
  style.textContent = flattenTopLevelLayers(shippingCss);
  document.head.appendChild(style);
});

afterEach(() => {
  document.body.replaceChildren();
  document.head.replaceChildren();
});

describe('scene subtitle visibility through the shipped stylesheet', () => {
  it('computes as visible when the painter reveals a subtitle line', () => {
    const container = document.createElement('div');
    container.id = 'ui';
    document.body.appendChild(container);
    const window = new SceneOverlayWindow({
      document,
      container,
      writers: makeWriterFacet(
        new Map(),
        new Map(),
        new Map(),
        new Map(),
        () => {},
        () => {},
      ),
      onSkip: () => {},
    });
    const subtitle = container.querySelector<HTMLElement>('.scene-subtitle');
    if (!subtitle) throw new Error('scene subtitle element was not constructed');

    expect(getComputedStyle(subtitle).display).toBe('none');

    window.paint(model(null));
    expect(getComputedStyle(subtitle).display).toBe('none');

    window.paint(model('hudChrome.scene.skipHint'));
    const revealed = getComputedStyle(subtitle);
    expect(revealed.display).toBe('block');
    expect(revealed.visibility).toBe('visible');
  });
});
