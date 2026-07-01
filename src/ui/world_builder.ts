// In-world Builder dock: a fixed right-side panel for placing decorative props.
// It only issues IWorld commands — the server is authoritative and admin-gates
// every one (see server/game.ts handleBuilderCmd), so this dock is a convenience
// surface, not a trust boundary. Mounted behind a dev/admin entry point by main.
//
// The dock has a grouped prop palette (native keys + external GLBs the server
// lists), scale/rotate sliders with live readouts, place/delete, a selection
// status line, and dialogue/music/voice fields saved to the selected prop. Styled
// by the .wb-* rules in components.css (shared --gold / --panel tokens). No
// framework — plain DOM, matching this repo's other vanilla UI modules.
import type { IWorld } from '../world_api';

export interface WorldBuilderHandle {
  /** Mark a placed prop selected so move/delete/meta act on it (null clears). */
  select(dbId: number | null): void;
  destroy(): void;
}

interface WorldBuilderOpts {
  /** Native prop keys always offered in the palette. */
  nativeKeys?: string[];
  /** Endpoint returning external GLB prop names; optional. */
  propCatalogUrl?: string;
}

interface CatalogEntry {
  name: string;
  group?: string;
}

const DEFAULT_NATIVE_KEYS = ['barrel', 'crate', 'lamp', 'banner', 'statue'];

export function mountWorldBuilder(
  world: IWorld,
  parent: HTMLElement = document.body,
  opts: WorldBuilderOpts = {},
): WorldBuilderHandle {
  const dock = document.createElement('div');
  dock.className = 'wb-dock';
  dock.setAttribute('role', 'region');
  dock.setAttribute('aria-label', 'World Builder');

  // Currently-selected placed prop's persisted id (null = none). Move / delete /
  // meta operate on this; the caller wires selection via the returned select().
  let selectedDbId: number | null = null;
  const nativeKeys = opts.nativeKeys?.length ? opts.nativeKeys : DEFAULT_NATIVE_KEYS;
  // Last placement position, reused when slider edits re-pose the selected prop.
  const lastPos = { x: 0, z: 0 };

  dock.innerHTML = [
    '<div class="wb-title"><span>🛠 World Builder</span>',
    '<button type="button" class="wb-collapse" data-wb-collapse aria-label="Collapse">▾</button></div>',
    '<div class="wb-body">',
    '<div class="wb-section-label">Place a prop</div>',
    '<div class="wb-palette" data-wb-palette></div>',
    '<div class="wb-section-label">Pose</div>',
    '<label class="wb-row"><span class="wb-row-head">Scale <span class="wb-row-val" data-wb-scaleval>1.0×</span></span>',
    '<input type="range" min="0.1" max="8" step="0.1" value="1" data-wb-scale></label>',
    '<label class="wb-row"><span class="wb-row-head">Rotate <span class="wb-row-val" data-wb-rotateval>0°</span></span>',
    '<input type="range" min="0" max="6.28" step="0.05" value="0" data-wb-rotate></label>',
    '<div class="wb-selinfo" data-wb-selinfo>No prop selected</div>',
    '<div class="wb-actions">',
    '<button type="button" class="wb-btn wb-danger" data-wb-delete disabled>Delete</button>',
    '<button type="button" class="wb-btn" data-wb-deselect disabled>Deselect</button>',
    '</div>',
    '<div class="wb-section-label">Speech &amp; audio</div>',
    '<div class="wb-fields">',
    '<input type="text" maxlength="240" placeholder="Dialogue on interact…" data-wb-dialogue>',
    '<input type="text" maxlength="200" placeholder="Music — /props/track.mp3" data-wb-music>',
    '<input type="text" maxlength="80" placeholder="Voice line key" data-wb-voice>',
    '<button type="button" class="wb-btn wb-primary" data-wb-savemeta disabled>Save to selected</button>',
    '</div>',
    '</div>',
  ].join('');

  const q = <T extends HTMLElement>(sel: string) => dock.querySelector<T>(sel)!;
  const scaleEl = q<HTMLInputElement>('[data-wb-scale]');
  const rotateEl = q<HTMLInputElement>('[data-wb-rotate]');
  const scaleVal = q('[data-wb-scaleval]');
  const rotateVal = q('[data-wb-rotateval]');
  const dialogueEl = q<HTMLInputElement>('[data-wb-dialogue]');
  const musicEl = q<HTMLInputElement>('[data-wb-music]');
  const voiceEl = q<HTMLInputElement>('[data-wb-voice]');
  const paletteEl = q('[data-wb-palette]');
  const selInfo = q('[data-wb-selinfo]');
  const deleteBtn = q<HTMLButtonElement>('[data-wb-delete]');
  const deselectBtn = q<HTMLButtonElement>('[data-wb-deselect]');
  const saveBtn = q<HTMLButtonElement>('[data-wb-savemeta]');

  function refreshSelection(): void {
    const has = selectedDbId != null;
    selInfo.textContent = has ? `Selected prop #${selectedDbId}` : 'No prop selected';
    selInfo.classList.toggle('wb-has-sel', has);
    deleteBtn.disabled = !has;
    deselectBtn.disabled = !has;
    saveBtn.disabled = !has;
  }

  function syncReadouts(): void {
    scaleVal.textContent = `${(Number(scaleEl.value) || 1).toFixed(1)}×`;
    rotateVal.textContent = `${Math.round(((Number(rotateEl.value) || 0) * 180) / Math.PI)}°`;
  }

  function placeFromPalette(propKey: string): void {
    // Place in front of the player; the server snaps to ground and assigns the id.
    const p = world.player;
    if (!p) return;
    const scale = Number(scaleEl.value) || 1;
    const facing = Number(rotateEl.value) || 0;
    const fx = p.pos.x + Math.sin(p.facing) * 2;
    const fz = p.pos.z + Math.cos(p.facing) * 2;
    lastPos.x = fx;
    lastPos.z = fz;
    world.placeProp(propKey, fx, fz, facing, scale);
  }

  function renderPalette(entries: CatalogEntry[]): void {
    paletteEl.replaceChildren();
    const all: CatalogEntry[] = [
      ...nativeKeys.map((name) => ({ name, group: 'Built-in' })),
      ...entries,
    ];
    // Group entries by source, each group a labelled thumbnail grid.
    const groups = new Map<string, CatalogEntry[]>();
    for (const e of all) {
      const g = e.group ?? 'Props';
      (groups.get(g) ?? groups.set(g, []).get(g)!).push(e);
    }
    for (const [group, list] of groups) {
      const label = document.createElement('div');
      label.className = 'wb-group';
      label.textContent = group;
      paletteEl.appendChild(label);
      const grid = document.createElement('div');
      grid.className = 'wb-group-grid';
      for (const entry of list) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'wb-prop';
        const isExt = group !== 'Built-in';
        const propKey = isExt ? `ext:${entry.name}` : entry.name;
        btn.textContent = entry.name;
        btn.title = `Place ${entry.name}`;
        btn.addEventListener('click', () => placeFromPalette(propKey));
        grid.appendChild(btn);
      }
      paletteEl.appendChild(grid);
    }
  }

  renderPalette([]);
  if (opts.propCatalogUrl) {
    void fetch(opts.propCatalogUrl)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { props?: CatalogEntry[] } | CatalogEntry[] | null) => {
        const list = Array.isArray(data) ? data : data?.props;
        if (Array.isArray(list)) renderPalette(list);
      })
      .catch(() => {
        /* offline / no catalog: built-ins only */
      });
  }

  // Live-update the selected prop as the sliders move.
  function applyPose(): void {
    syncReadouts();
    if (selectedDbId == null) return;
    world.moveProp(
      selectedDbId,
      lastPos.x,
      lastPos.z,
      Number(rotateEl.value) || 0,
      Number(scaleEl.value) || 1,
    );
  }
  scaleEl.addEventListener('input', applyPose);
  rotateEl.addEventListener('input', applyPose);

  q('[data-wb-collapse]').addEventListener('click', () => {
    const collapsed = dock.classList.toggle('wb-collapsed');
    q('[data-wb-collapse]').textContent = collapsed ? '▸' : '▾';
  });
  deleteBtn.addEventListener('click', () => {
    if (selectedDbId == null) return;
    world.removeProp(selectedDbId);
    selectedDbId = null;
    refreshSelection();
  });
  deselectBtn.addEventListener('click', () => {
    selectedDbId = null;
    refreshSelection();
  });
  saveBtn.addEventListener('click', () => {
    if (selectedDbId == null) return;
    world.setPropMeta(selectedDbId, {
      dialogue: dialogueEl.value.slice(0, 240),
      music: musicEl.value.slice(0, 200),
      voice: voiceEl.value.slice(0, 80),
    });
  });

  syncReadouts();
  refreshSelection();
  parent.appendChild(dock);
  return {
    select(dbId) {
      selectedDbId = dbId;
      refreshSelection();
    },
    destroy() {
      dock.remove();
    },
  };
}
