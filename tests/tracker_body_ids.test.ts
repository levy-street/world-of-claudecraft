// The tracker inner-body contract: #quest-tracker / #delve-tracker /
// #rift-tracker are movable frames whose painters rebuild their OWN HTML, so
// each paints an inner body element (#qt-body / #delve-body / #rift-body)
// and never the frame root, or the rebuild would wipe the mover chrome
// (tf-move-btn, grip, name chip) minted as direct children of the root.
//
// The body id is load-bearing in FOUR places with nothing else tying them
// together: the markup of both game entries, the controller wiring in hud.ts
// ($() is a bare querySelector cast, so a drifted id hands the controller
// null and the tracker silently never paints), and the stylesheet's
// empty-body fold rules (a :has() cannot execute in the Node DOM tests). One
// list here pins all four so a drift in any one of them fails by name.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const TRACKER_BODIES = [
  { rootId: 'quest-tracker', bodyId: 'qt-body' },
  { rootId: 'delve-tracker', bodyId: 'delve-body' },
  { rootId: 'rift-tracker', bodyId: 'rift-body' },
] as const;

const read = (...parts: string[]) =>
  readFileSync(join(import.meta.dirname, '..', ...parts), 'utf8');

describe('tracker inner-body ids', () => {
  it('both entries seat each body as the DIRECT child of its frame root', () => {
    // The exact authored shape: the empty body is the root's immediate and
    // only authored child (the mover chrome is minted beside it at runtime).
    for (const entry of ['index.html', 'play.html']) {
      const html = read(entry);
      for (const { rootId, bodyId } of TRACKER_BODIES) {
        expect(html, `${entry}: #${bodyId} directly inside #${rootId}`).toContain(
          `id="${rootId}"><div id="${bodyId}">`,
        );
      }
    }
  });

  it('hud.ts hands each controller the body element, never the frame root', () => {
    const hud = read('src', 'ui', 'hud.ts');
    for (const { rootId, bodyId } of TRACKER_BODIES) {
      expect(hud, `#${bodyId} wiring`).toContain(`$('#${bodyId}')`);
      expect(hud, `#${rootId} must not be a paint target`).not.toContain(
        `element: $('#${rootId}')`,
      );
    }
  });

  it('the stylesheet folds each root away off ITS body being empty', () => {
    const css = read('src', 'styles', 'hud.css');
    for (const { rootId, bodyId } of TRACKER_BODIES) {
      expect(css, `#${rootId} fold rule`).toContain(`#${rootId}:has(> #${bodyId}:empty)`);
    }
  });
});
