import { describe, expect, it, vi } from 'vitest';
import type { CustomMap } from '../src/editor/custom_map';
import {
  type EditorViewportMapTarget,
  transitionEditorViewport,
} from '../src/editor/editor_viewport_transition';

const map = { meta: { id: 'scratch' } } as CustomMap;

describe('editor viewport map transitions', () => {
  it('keeps the terrain renderer alive for a Collision Master document swap', () => {
    const viewport: EditorViewportMapTarget = {
      reload: vi.fn(async () => undefined),
      switchDocumentPreservingTerrain: vi.fn(() => true),
    };

    expect(transitionEditorViewport(viewport, map, true)).toBeNull();
    expect(viewport.switchDocumentPreservingTerrain).toHaveBeenCalledWith(map);
    expect(viewport.reload).not.toHaveBeenCalled();
  });

  it('falls back to a full reload when the viewport is not ready', async () => {
    const viewport: EditorViewportMapTarget = {
      reload: vi.fn(async () => undefined),
      switchDocumentPreservingTerrain: vi.fn(() => false),
    };

    await expect(transitionEditorViewport(viewport, map, true)).resolves.toBeUndefined();
    expect(viewport.reload).toHaveBeenCalledWith(map);
  });
});
