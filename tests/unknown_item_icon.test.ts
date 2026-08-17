// The shared unknown-item icon fallback (src/ui/unknown_item_icon.ts): the one
// <img> every server-truth surface renders for an id this bundle cannot
// resolve (stale-client guard, R34). iconDataUrl is canvas-backed at runtime,
// so it is mocked here; its own unknown-id tolerance (the UNKNOWN_RECIPE fall
// through) is icons.ts behavior, not this module's.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/icons', () => ({
  iconDataUrl: (kind: string, id: string) => {
    if (id === 'canvasless_id') throw new Error('2D canvas context is unavailable');
    if (id === 'hostile_url_id') return 'x" onerror="alert(1)';
    return `stub:${kind}:${id}`;
  },
}));

const { itemIconImgHtml, knownItemIconHtml, unknownItemIconHtml } = await import(
  '../src/ui/unknown_item_icon'
);

describe('itemIconImgHtml (the shared minter, named directly)', () => {
  // The reliquary window feeds this resolver-gated URLs, so these arms guard
  // the minter itself rather than any caller: a refactor that gives
  // unknownItemIconHtml its own inline body must not leave this unpinned.
  it('mints the exact .item-icon shape', () => {
    expect(itemIconImgHtml('/ui/professions/masterwork_seal.webp', 'epic')).toBe(
      '<img class="item-icon q-epic" src="/ui/professions/masterwork_seal.webp" alt="" draggable="false">',
    );
  });

  it('keeps a hostile rung out of the class attribute (no token injection)', () => {
    const quoted = itemIconImgHtml('/x.webp', 'x" onerror="alert(1)');
    expect(quoted).not.toContain('onerror');
    expect(quoted).toContain('class="item-icon q-common"');
    const spaced = itemIconImgHtml('/x.webp', 'common evil');
    expect(spaced).toContain('class="item-icon q-common"');
    expect(spaced).not.toContain('evil');
    // The guard is a CHARSET filter, not a ladder allowlist: an unranked but
    // lowercase-alpha rung passes through (and simply takes default styling),
    // which is the same tolerance the unknownItemIconHtml wire-quality arm
    // documents above. Pinned so the boundary is named, not assumed.
    expect(itemIconImgHtml('/x.webp', 'notarung')).toContain('class="item-icon q-notarung"');
  });

  it('escapes the src attribute (no quote breakout)', () => {
    const html = itemIconImgHtml('x" onerror="alert(1)', 'epic');
    expect(html).not.toContain('src="x" onerror');
    expect(html).toContain('src="x&quot;');
  });

  it('carries an escaped optional runtime fallback without changing ordinary markup', () => {
    expect(itemIconImgHtml('/ui/mobs/old_greyjaw.webp', 'rare', 'data:image/svg+xml,trophy')).toBe(
      '<img class="item-icon q-rare" src="/ui/mobs/old_greyjaw.webp" data-icon-fallback-src="data:image/svg+xml,trophy" alt="" draggable="false">',
    );
    const hostile = itemIconImgHtml('/x.webp', 'rare', 'x" onerror="alert(1)');
    expect(hostile).not.toContain('data-icon-fallback-src="x" onerror');
    expect(hostile).toContain('data-icon-fallback-src="x&quot;');
  });
});

describe('unknownItemIconHtml', () => {
  it('renders the item-icon img at common quality by default', () => {
    expect(unknownItemIconHtml('future_item_id')).toBe(
      '<img class="item-icon q-common" src="stub:item:future_item_id" alt="" draggable="false">',
    );
  });

  it('carries a caller-supplied quality class (the loot-roll wire quality)', () => {
    // A loot-roll event names its quality server-side, so a stale bundle can
    // color the fallback correctly, even for a rung it has never heard of
    // (an unranked class simply takes the default styling).
    expect(unknownItemIconHtml('future_item_id', 'epic')).toContain('class="item-icon q-epic"');
    expect(unknownItemIconHtml('future_item_id', 'mythic')).toContain('class="item-icon q-mythic"');
  });

  it('allowlists the quality rung out of the class attribute (no token injection)', () => {
    // Stronger than escaping: esc() stops quote breakout but a SPACE would
    // still append a second class token, so anything outside the lowercase
    // rung alphabet paints common. Both attack shapes pinned.
    const quoted = unknownItemIconHtml('future_item_id', 'x" onerror="alert(1)');
    expect(quoted).not.toContain('onerror');
    expect(quoted).toContain('class="item-icon q-common"');
    const spaced = unknownItemIconHtml('future_item_id', 'common evil');
    expect(spaced).toContain('class="item-icon q-common"');
    expect(spaced).not.toContain('evil');
  });

  it('keeps the never-a-throw contract on a canvas-less host (blank pixel src)', () => {
    // The procedural fallback icon is canvas-composited, so a host with no
    // working 2d context would throw INSIDE the fallback that exists to
    // prevent throws; the helper swallows it and ships a transparent pixel
    // (the quality frame and count badge still render).
    let html = '';
    expect(() => {
      html = unknownItemIconHtml('canvasless_id');
    }).not.toThrow();
    expect(html).toContain('src="data:image/gif;base64,');
    expect(html).toContain('class="item-icon q-common"');
  });

  it('escapes a hostile icon URL out of the src attribute', () => {
    // Same defense-in-depth as the quality arm: every REAL pipeline return is
    // a manifest URL or a base64 data URL, but the esc() is what makes the
    // attribute safe by construction rather than by that inventory holding.
    const html = unknownItemIconHtml('hostile_url_id');
    expect(html).not.toContain('" onerror');
    expect(html).toContain('src="x&quot;');
  });

  it('asks the icon pipeline for the ITEM kind under the raw id', () => {
    // The procedural pipeline resolves any unknown item id to its fallback
    // recipe, keyed by the id so distinct unknowns stay distinct.
    expect(unknownItemIconHtml('a')).toContain('src="stub:item:a"');
    expect(unknownItemIconHtml('b')).toContain('src="stub:item:b"');
  });
});

describe('knownItemIconHtml (the known arm of the same swallow)', () => {
  it('renders the def-quality class with the resolved icon', () => {
    expect(knownItemIconHtml({ id: 'copper_ore', quality: 'rare' })).toBe(
      '<img class="item-icon q-rare" src="stub:item:copper_ore" alt="" draggable="false">',
    );
    expect(knownItemIconHtml({ id: 'copper_ore' })).toContain('q-common');
  });

  it('degrades to the blank pixel on a canvas-less host, never a throw', () => {
    // Every guarded surface paints at least one KNOWN item, so this arm is
    // what makes the family's never-a-throw contract reachable at all.
    const html = knownItemIconHtml({ id: 'canvasless_id', quality: 'epic' });
    expect(html).toContain('data:image/gif;base64');
    expect(html).toContain('q-epic');
  });
});
