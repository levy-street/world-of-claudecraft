// In-world Builder dock: a small right-side panel for placing decorative props.
// It only issues IWorld commands — the server is authoritative and admin-gates
// every one (see server/game.ts handleBuilderCmd), so this dock is a convenience
// surface, not a trust boundary. Mounted behind a dev/admin entry point by main.
//
// The dock has a prop palette (native keys + any external GLBs the server lists),
// scale/rotate sliders, place/delete, and dialogue/music/voice fields saved to the
// selected prop via setPropMeta. No framework — plain DOM, matching this repo's
// other vanilla UI modules.
import type { IWorld } from '../world_api';

export interface WorldBuilderHandle {
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

  // Currently-selected placed prop's persisted id (null = none selected). Move /
  // delete / meta operate on this. Selection is wired by the caller via select().
  let selectedDbId: number | null = null;

  const nativeKeys = opts.nativeKeys && opts.nativeKeys.length ? opts.nativeKeys : DEFAULT_NATIVE_KEYS;
  // Last placement position, reused when slider edits re-pose the selected prop.
  const lastPos = { x: 0, z: 0 };

  dock.innerHTML = [
    '<div class="wb-title">World Builder</div>',
    '<div class="wb-palette" data-wb-palette></div>',
    '<label class="wb-row">Scale ',
    '<input type="range" min="0.1" max="8" step="0.1" value="1" data-wb-scale></label>',
    '<label class="wb-row">Rotate ',
    '<input type="range" min="0" max="6.28" step="0.05" value="0" data-wb-rotate></label>',
    '<div class="wb-actions">',
    '<button type="button" data-wb-delete>Delete selected</button>',
    '<button type="button" data-wb-deselect>Deselect</button>',
    '</div>',
    '<label class="wb-row">Speech ',
    '<input type="text" maxlength="240" placeholder="Dialogue on interact…" data-wb-dialogue></label>',
    '<label class="wb-row">Music ',
    '<input type="text" maxlength="200" placeholder="/props/track.mp3" data-wb-music></label>',
    '<label class="wb-row">Voice ',
    '<input type="text" maxlength="80" placeholder="voice line key" data-wb-voice></label>',
    '<button type="button" data-wb-savemeta>Save speech / music / voice</button>',
  ].join('');

  const scaleEl = dock.querySelector<HTMLInputElement>('[data-wb-scale]')!;
  const rotateEl = dock.querySelector<HTMLInputElement>('[data-wb-rotate]')!;
  const dialogueEl = dock.querySelector<HTMLInputElement>('[data-wb-dialogue]')!;
  const musicEl = dock.querySelector<HTMLInputElement>('[data-wb-music]')!;
  const voiceEl = dock.querySelector<HTMLInputElement>('[data-wb-voice]')!;
  const paletteEl = dock.querySelector<HTMLElement>('[data-wb-palette]')!;

  function placeFromPalette(propKey: string): void {
    // Place in front of the player; the server snaps to ground and assigns the id.
    const p = world.player;
    const scale = Number(scaleEl.value) || 1;
    const facing = Number(rotateEl.value) || 0;
    if (!p) return;
    const fx = p.pos.x + Math.sin(p.facing) * 2;
    const fz = p.pos.z + Math.cos(p.facing) * 2;
    lastPos.x = fx;
    lastPos.z = fz;
    world.placeProp(propKey, fx, fz, facing, scale);
  }

  function renderPalette(entries: CatalogEntry[]): void {
    paletteEl.replaceChildren();
    for (const key of nativeKeys) {
      entries.unshift({ name: key, group: 'Built-in' });
    }
    let lastGroup: string | undefined;
    for (const entry of entries) {
      if (entry.group !== lastGroup) {
        const h = document.createElement('div');
        h.className = 'wb-group';
        h.textContent = entry.group ?? 'Props';
        paletteEl.appendChild(h);
        lastGroup = entry.group;
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wb-prop';
      const isExt = entry.group && entry.group !== 'Built-in';
      const propKey = isExt ? `ext:${entry.name}` : entry.name;
      btn.textContent = entry.name;
      btn.addEventListener('click', () => placeFromPalette(propKey));
      paletteEl.appendChild(btn);
    }
  }

  renderPalette([]);
  if (opts.propCatalogUrl) {
    void fetch(opts.propCatalogUrl)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: CatalogEntry[]) => {
        if (Array.isArray(list)) renderPalette(list);
      })
      .catch(() => {
        /* offline / no catalog: built-ins only */
      });
  }

  // Live-update the selected prop as the sliders move.
  function applyPose(): void {
    if (selectedDbId == null) return;
    // Pose edits keep the prop where it is; lastPos tracks the last placement.
    world.moveProp(selectedDbId, lastPos.x, lastPos.z, Number(rotateEl.value) || 0, Number(scaleEl.value) || 1);
  }
  scaleEl.addEventListener('input', applyPose);
  rotateEl.addEventListener('input', applyPose);

  dock.querySelector('[data-wb-delete]')?.addEventListener('click', () => {
    if (selectedDbId == null) return;
    world.removeProp(selectedDbId);
    selectedDbId = null;
  });
  dock.querySelector('[data-wb-deselect]')?.addEventListener('click', () => {
    selectedDbId = null;
  });
  dock.querySelector('[data-wb-savemeta]')?.addEventListener('click', () => {
    if (selectedDbId == null) return;
    world.setPropMeta(selectedDbId, {
      dialogue: dialogueEl.value.slice(0, 240),
      music: musicEl.value.slice(0, 200),
      voice: voiceEl.value.slice(0, 80),
    });
  });

  parent.appendChild(dock);
  return {
    destroy() {
      dock.remove();
    },
  };
}
