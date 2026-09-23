import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// ClaudeCraft Studio (the private map editor) lives in the private woc-studio repository
// and mounts on this tree through the `#studio` seam (src/editor/studio_contract.ts). The
// public src/editor/ is the player map editor plus that seam and nothing else. This pin
// fails any change that lands a Studio file on a public branch. Adding a public editor
// module is a deliberate act: extend the allowlist in the same change.
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const editorRoot = join(repoRoot, 'src', 'editor');

const PUBLIC_EDITOR_FILES = [
  '3d/editor_camera.ts',
  '3d/viewport.ts',
  'CLAUDE.md',
  'app.ts',
  'asset_browser.ts',
  'asset_catalog.generated.ts',
  'asset_thumbs.ts',
  'asset_thumbs_core.ts',
  'blocker_core.ts',
  'camera_axes.ts',
  'camp_core.ts',
  'canvas.ts',
  'custom_map.ts',
  'dom.ts',
  'edit_caps_core.ts',
  'file_io.ts',
  'inspector.ts',
  'main.ts',
  'map_drawer.ts',
  'map_io.ts',
  'model.ts',
  'net.ts',
  'persist.ts',
  'placement_transform_core.ts',
  'playtest.ts',
  'procgen.ts',
  'save_lifecycle_core.ts',
  'server_errors_core.ts',
  'server_link_core.ts',
  'span_core.ts',
  'stamp_core.ts',
  'studio_contract.ts',
  'studio_stub.ts',
  'styles.css',
  'toasts.ts',
  'toolbar.ts',
  'topbar.ts',
  'tutorial.ts',
  'tutorial_core.ts',
  'tutorial_loader.ts',
  'undo_core.ts',
  'user_assets.ts',
  'view.ts',
].sort();

// Module names that exist only in Studio. A file by any of these names anywhere under
// src/ means the private tool leaked into the public tree, whatever directory it landed in.
const STUDIO_ONLY_BASENAMES = [
  'carve_voxel_core.ts',
  'cave_gen_core.ts',
  'city_build_core.ts',
  'city_build_panel.ts',
  'collision_bake_core.ts',
  'cm_mesh_sculpt_core.ts',
  'building_workspace.ts',
  'build_transform_core.ts',
  'battleground_mode.ts',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe('public src/editor is the player editor plus the #studio seam', () => {
  it('contains exactly the allowlisted files', () => {
    const actual = walk(editorRoot)
      .map((f) => relative(editorRoot, f).split('\\').join('/'))
      .sort();
    const extra = actual.filter((f) => !PUBLIC_EDITOR_FILES.includes(f));
    const missing = PUBLIC_EDITOR_FILES.filter((f) => !actual.includes(f));
    expect(extra, 'files in src/editor outside the public allowlist').toEqual([]);
    expect(missing, 'allowlisted public editor files that are gone').toEqual([]);
  });

  it('keeps the seam files that let the private Studio mount', () => {
    expect(PUBLIC_EDITOR_FILES).toContain('studio_contract.ts');
    expect(PUBLIC_EDITOR_FILES).toContain('studio_stub.ts');
  });

  it('has no Studio-only module anywhere under src/', () => {
    const leaked = walk(join(repoRoot, 'src'))
      .map((f) => relative(repoRoot, f).split('\\').join('/'))
      .filter((f) => !f.startsWith('src/studio/'))
      .filter((f) => STUDIO_ONLY_BASENAMES.includes(f.slice(f.lastIndexOf('/') + 1)));
    expect(leaked).toEqual([]);
  });
});
