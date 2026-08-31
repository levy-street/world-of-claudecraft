// Dev-only in-game placement rig for the Ignivar forge-mech dressing props
// (local branch tooling, dev builds only: /dev placer or /placer toggles it).
// Pick a prop, place it in front of the player, tune scale, rotation (45
// and 15 degree steps), and position with nudge buttons; every edit
// re-renders live through the SAME appendIgnivarEnvProps path the shipped
// dressing uses and persists to localStorage per room. Export dumps the
// instance-local records used to bake the authored plan
// (ignivar_dressing_plan_core.ts).
import * as THREE from 'three';
import { addIgnivarPlacedTorchFires } from '../render/dungeon_torch_rig';
import {
  IGNIVAR_PROP_NATIVE,
  type IgnivarEnvPropKey,
  type IgnivarPropPlacement,
  ignivarApproachPropPlan,
  ignivarArenaPropPlan,
  ignivarCruciblePropPlan,
  ignivarLiftPropPlan,
} from '../render/ignivar_dressing_plan_core';
import {
  appendIgnivarEnvProps,
  IGNIVAR_ENV_PROP_URLS,
  prepareIgnivarEnvProps,
} from '../render/ignivar_env_props';
import { DUNGEON_X_THRESHOLD } from '../sim/data';
import {
  IGNIVAR_FORGE_APPROACH_LAYOUT,
  IGNIVAR_LAYOUT,
  IGNIVAR_LIFT_LAYOUT,
  IGNIVAR_SECOND_WING_LAYOUT,
} from '../sim/dungeon_layout';
import type { Entity } from '../sim/types';

export interface IgnivarPlacerDeps {
  scene: THREE.Scene;
  getPlayer: () => Entity | undefined;
  log: (text: string, color?: string) => void;
}

interface PlacedEntry {
  key: IgnivarEnvPropKey;
  x: number;
  y: number;
  z: number;
  /** degrees, kept in 45 and 15 degree steps by the two button pairs */
  rot: number;
  scale: number;
}

interface PlacerRoom {
  interior: string;
  label: string;
  /** placement-frame origin: instance slot origin for rooms, 0 for exterior */
  ox: number;
  oz: number;
  /** world-space overworld site: placements are absolute world coordinates */
  exterior?: boolean;
  plan: () => IgnivarPropPlacement[];
}

const OZ = -1250; // offline client plays instance slot 0

const ROOMS: PlacerRoom[] = [
  {
    interior: 'ignivar_lift',
    label: 'The Forge-Lift',
    ox: 118600,
    oz: OZ,
    plan: () => ignivarLiftPropPlan(IGNIVAR_LIFT_LAYOUT),
  },
  {
    interior: 'ignivar_approach',
    label: 'Halls of the First Tempering',
    ox: 116200,
    oz: OZ,
    plan: () => ignivarApproachPropPlan(IGNIVAR_FORGE_APPROACH_LAYOUT),
  },
  {
    interior: 'ignivar',
    label: 'Crucible of the Last Spring',
    ox: 116800,
    oz: OZ,
    plan: () => ignivarArenaPropPlan(IGNIVAR_LAYOUT),
  },
  {
    interior: 'ignivar_depths',
    label: 'The Inner Crucible',
    ox: 117400,
    oz: OZ,
    plan: () => ignivarCruciblePropPlan(IGNIVAR_SECOND_WING_LAYOUT),
  },
];

// Anywhere in the open world (west of the instance band) edits ONE shared
// world-space set, keyed 'drakelands_exterior': the Ignivar entrance site
// work. Placements carry absolute world coordinates and their y seeds from
// the ground under the player, so exports bake straight into a future
// entrance dressing table.
const EXTERIOR_SITE: PlacerRoom = {
  interior: 'drakelands_exterior',
  label: 'Drakelands exterior (world space)',
  ox: 0,
  oz: 0,
  exterior: true,
  plan: () => [],
};
const ROOM_RANGE = 90;
const SCALES = [0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 18, 20, 26, 32];

/** The two asset kits are picker FILTERS only: any key renders, saves, and
 *  exports identically wherever it is placed. The exterior kit is the
 *  architecture face of the roster (gate walls, gears, pillars, chains,
 *  lava, torches) for overworld entrance work; new exterior assets (the
 *  Drakelands bridge) join this list as they land. */
const EXTERIOR_KIT: readonly IgnivarEnvPropKey[] = [
  'dungeon_entrance',
  'street_lamp',
  'vault_door',
  'square_wall',
  'gear_wall_rusty',
  'gear_machine',
  'pillar_slim',
  'reactor',
  'lava_face',
  'beam',
  'chain',
  'chain_hanging',
  'chain_link',
  'hanging_hook',
  'lava_channel',
  'lava_channel_curved',
  'lava_outlet',
  'lava_port',
  'torch',
  // the Exterior_Assets fortress kit (the owner's drop, 2026-08-28)
  'bridge_floor',
  'bridge_pillar',
  'bridge_rail',
  'cannon',
  'dragon_head',
  'dragon_pillar',
  'fortress_wall',
  'fountain_base',
  'gate',
  'gate_gear',
  'lava_pillar',
  'staircase',
  'stone_floor',
  'tower_base',
  'tower_middle',
  'tower_pillar',
  'tower_top',
];

type AssetKit = 'interior' | 'exterior';

/** null = follow the site (exterior site shows the exterior kit); the panel
 *  button overrides so either kit is reachable anywhere. */
let kitOverride: AssetKit | null = null;

function activeKit(): AssetKit {
  return kitOverride ?? (state.room?.exterior ? 'exterior' : 'interior');
}

function kitKeys(): readonly IgnivarEnvPropKey[] {
  return activeKit() === 'exterior'
    ? EXTERIOR_KIT
    : (Object.keys(IGNIVAR_ENV_PROP_URLS) as IgnivarEnvPropKey[]);
}
const DRESSING_GROUP_NAMES = [
  'ignivarForgeApproachDressing',
  'ignivarCrucibleArenaDressing',
  'varkhulInnerCrucibleDressing',
  // the baked exterior pass (composed into the ember zone features): hidden
  // while the placer is open, or every piece doubles behind its editable copy
  'forgefatherFortress',
];

const state: {
  deps: IgnivarPlacerDeps | null;
  panel: HTMLElement | null;
  listEl: HTMLElement | null;
  statusEl: HTMLElement | null;
  infoEl: HTMLElement | null;
  pickerEl: HTMLElement | null;
  kitBtn: HTMLButtonElement | null;
  group: THREE.Group | null;
  marker: THREE.Group | null;
  worklight: THREE.AmbientLight | null;
  entries: PlacedEntry[];
  selected: number;
  room: PlacerRoom | null;
  timer: number | null;
  hiddenDressing: THREE.Object3D[];
} = {
  deps: null,
  panel: null,
  listEl: null,
  statusEl: null,
  infoEl: null,
  pickerEl: null,
  kitBtn: null,
  group: null,
  marker: null,
  worklight: null,
  entries: [],
  selected: -1,
  room: null,
  timer: null,
  hiddenDressing: [],
};

const storageKey = (interior: string) => `woc_ignivar_placer:${interior}`;

// The placement work light: a flat ambient lift so prop placement stays
// readable inside the deliberately dim forge grades. AmbientLight by design:
// ambient is not a shader program-cache-key input, so attaching and removing
// it after boot relinks nothing (the light census pin scans the keyed classes
// only). On by default every open; toggle it off to preview the shipped mood.
const WORKLIGHT_COLOR = 0xffe9c9;
const WORKLIGHT_INTENSITY = 1.4;

let worklightOn = true;

const worklightLabel = (): string => (worklightOn ? 'work light: on' : 'work light: off');

function applyWorklight(): void {
  const deps = state.deps;
  const wanted = worklightOn && state.panel !== null;
  if (wanted && deps && !state.worklight) {
    const light = new THREE.AmbientLight(WORKLIGHT_COLOR, WORKLIGHT_INTENSITY);
    light.name = 'ignivarPlacerWorklight';
    deps.scene.add(light);
    state.worklight = light;
  } else if (!wanted && state.worklight) {
    state.worklight.parent?.remove(state.worklight);
    state.worklight = null;
  }
}

function setWorklight(on: boolean): void {
  worklightOn = on;
  applyWorklight();
}

function loadEntries(interior: string): PlacedEntry[] | null {
  try {
    const raw = localStorage.getItem(storageKey(interior));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { entries?: PlacedEntry[] };
    return Array.isArray(parsed.entries) ? parsed.entries : null;
  } catch {
    return null;
  }
}

function saveEntries(): void {
  if (!state.room) return;
  try {
    localStorage.setItem(
      storageKey(state.room.interior),
      JSON.stringify({ interior: state.room.interior, entries: state.entries }),
    );
  } catch {}
}

function prefillFromPlan(room: PlacerRoom): PlacedEntry[] {
  // Beams are computed outline structure (about a hundred segments); the
  // hand-tuning pass is for the feature props.
  return room
    .plan()
    .filter((placement) => placement.key !== 'beam')
    .map((placement) => ({
      key: placement.key,
      x: Math.round(placement.x * 10) / 10,
      y: Math.round(placement.y * 10) / 10,
      z: Math.round(placement.z * 10) / 10,
      rot: Math.round((placement.ry * 180) / Math.PI),
      scale: placement.scale,
    }));
}

function roomForPlayer(player: Entity | undefined): PlacerRoom | null {
  if (!player) return null;
  for (const room of ROOMS) {
    if (
      Math.abs(player.pos.x - room.ox) <= ROOM_RANGE &&
      Math.abs(player.pos.z - room.oz) <= ROOM_RANGE
    )
      return room;
  }
  // The whole open world is the exterior site; other instances (past the
  // dungeon band) stay unmatched so the status hint can say so.
  if (player.pos.x < DUNGEON_X_THRESHOLD) return EXTERIOR_SITE;
  return null;
}

function toPlacement(entry: PlacedEntry): IgnivarPropPlacement {
  return {
    key: entry.key,
    x: entry.x,
    y: entry.y,
    z: entry.z,
    ry: (entry.rot * Math.PI) / 180,
    scale: entry.scale,
  };
}

function rebuildGroup(): void {
  const deps = state.deps;
  const room = state.room;
  if (!deps || !room) return;
  if (!state.group) {
    state.group = new THREE.Group();
    state.group.name = 'ignivarPlacerPreview';
    deps.scene.add(state.group);
  }
  state.group.position.set(room.ox, 0, room.oz);
  state.group.clear();
  const placements = state.entries.map(toPlacement);
  appendIgnivarEnvProps(state.group, placements, false);
  // Live fire preview for placed torches so lighting can be judged while
  // placing. Preview lights bypass the renderer's fire-light budget (throwaway
  // sink arrays), which is fine for a dev tool with a handful of torches.
  addIgnivarPlacedTorchFires(
    { group: state.group, flames: [], fireLights: [] },
    placements,
    { flame: 0xffd06a, emissive: 0xe05a16, light: 0xff7a2e },
    { flameEmissive: 3.2, lightDistance: 34, glow: true },
  );
  const selected = state.entries[state.selected];
  if (selected) {
    if (!state.marker) {
      // Floor anchor ring plus a true-bounds wireframe box; the box shows
      // through geometry (no depth test) so the selection is always findable.
      const marker = new THREE.Group();
      marker.name = 'ignivarPlacerMarker';
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.92, 1, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({
          color: 0x5fd2ff,
          transparent: true,
          opacity: 0.8,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      ring.name = 'ring';
      ring.renderOrder = 3;
      const box = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
        new THREE.LineBasicMaterial({
          color: 0x5fd2ff,
          transparent: true,
          opacity: 0.9,
          depthTest: false,
        }),
      );
      box.name = 'bounds';
      box.renderOrder = 4;
      marker.add(ring, box);
      state.marker = marker;
    }
    const native = IGNIVAR_PROP_NATIVE[selected.key];
    const ry = (selected.rot * Math.PI) / 180;
    const ring = state.marker.getObjectByName('ring');
    const box = state.marker.getObjectByName('bounds');
    if (ring) {
      ring.position.set(selected.x, selected.y + 0.1, selected.z);
      ring.scale.setScalar(
        Math.max(0.8, (Math.max(native.len, native.dep) * selected.scale) / 2 + 0.3),
      );
    }
    if (box) {
      box.position.set(selected.x, selected.y + (native.hei * selected.scale) / 2, selected.z);
      box.rotation.set(0, ry, 0);
      box.scale.set(
        native.len * selected.scale,
        native.hei * selected.scale,
        native.dep * selected.scale,
      );
    }
    state.group.add(state.marker);
  }
  saveEntries();
  renderList();
  renderSelectedInfo();
}

function renderSelectedInfo(): void {
  const info = state.infoEl;
  if (!info) return;
  const entry = selectedEntry();
  if (!entry) {
    info.textContent = 'nothing selected';
    return;
  }
  const native = IGNIVAR_PROP_NATIVE[entry.key];
  const w = (native.len * entry.scale).toFixed(1);
  const h = (native.hei * entry.scale).toFixed(1);
  const d = (native.dep * entry.scale).toFixed(1);
  info.textContent = `${entry.key}  size ${w}w x ${h}h x ${d}d  at (${entry.x.toFixed(1)}, ${entry.z.toFixed(1)}) y${entry.y} rot${entry.rot} x${entry.scale}`;
}

function renderList(): void {
  const list = state.listEl;
  if (!list) return;
  list.textContent = '';
  state.entries.forEach((entry, index) => {
    const row = document.createElement('div');
    row.style.cssText = `display:flex;gap:4px;align-items:center;padding:2px 4px;cursor:pointer;border-radius:3px;font-size:11px;${
      index === state.selected ? 'background:#2e5a75;color:#fff;' : 'color:#cbc2b4;'
    }`;
    const label = document.createElement('span');
    label.style.cssText = 'flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;';
    label.textContent = `${entry.key} (${entry.x.toFixed(1)}, ${entry.z.toFixed(1)}) x${entry.scale} r${entry.rot}`;
    row.appendChild(label);
    const del = document.createElement('button');
    del.textContent = 'x';
    del.style.cssText = 'background:#5a2020;color:#fff;border:0;border-radius:3px;cursor:pointer;';
    del.addEventListener('click', (event) => {
      event.stopPropagation();
      state.entries.splice(index, 1);
      if (state.selected >= state.entries.length) state.selected = state.entries.length - 1;
      rebuildGroup();
    });
    row.appendChild(del);
    row.addEventListener('click', () => {
      state.selected = index;
      rebuildGroup();
    });
    list.appendChild(row);
  });
}

function selectedEntry(): PlacedEntry | null {
  return state.entries[state.selected] ?? null;
}

function mutateSelected(fn: (entry: PlacedEntry) => void): void {
  const entry = selectedEntry();
  if (!entry) {
    state.deps?.log('[placer] nothing selected', '#ffcf6a');
    return;
  }
  fn(entry);
  rebuildGroup();
}

function localPlayerPos(): { x: number; z: number; facing: number } | null {
  const player = state.deps?.getPlayer();
  const room = state.room;
  if (!player || !room) return null;
  return { x: player.pos.x - room.ox, z: player.pos.z - room.oz, facing: player.facing };
}

function placeProp(key: IgnivarEnvPropKey): void {
  const local = localPlayerPos();
  if (!local) return;
  // Two units ahead of the player, facing back at them, so the new prop is
  // visible immediately instead of underfoot.
  const x = Math.round((local.x + Math.sin(local.facing) * 2.5) * 10) / 10;
  const z = Math.round((local.z + Math.cos(local.facing) * 2.5) * 10) / 10;
  const rot = (Math.round(((local.facing * 180) / Math.PI + 180) / 45) * 45 + 360) % 360;
  // Spawn room-scaled: the props are near-unit models, so x1 reads as a toy
  // against the 16u walls. Exterior terrain is not flat: seed y from the
  // ground under the player's feet, then tune with the Y nudges.
  const player = state.deps?.getPlayer();
  const y = state.room?.exterior && player ? Math.max(0, Math.round(player.pos.y * 10) / 10) : 0;
  state.entries.push({ key, x, y, z, rot, scale: 8 });
  state.selected = state.entries.length - 1;
  rebuildGroup();
}

function setDressingHidden(hidden: boolean): void {
  const deps = state.deps;
  if (!deps) return;
  if (hidden) {
    deps.scene.traverse((object) => {
      if (DRESSING_GROUP_NAMES.includes(object.name) && object.visible) {
        object.visible = false;
        state.hiddenDressing.push(object);
      }
    });
  } else {
    for (const object of state.hiddenDressing) object.visible = true;
    state.hiddenDressing = [];
  }
}

const kitLabel = (): string => `kit: ${activeKit()}`;

function renderPicker(): void {
  const picker = state.pickerEl;
  if (!picker) return;
  picker.textContent = '';
  for (const key of kitKeys()) picker.appendChild(button(key, () => placeProp(key)));
  if (state.kitBtn) state.kitBtn.textContent = kitLabel();
}

function button(label: string, onClick: () => void, wide = false): HTMLButtonElement {
  const el = document.createElement('button');
  el.textContent = label;
  el.style.cssText = `background:#3a3630;color:#f0e6d2;border:1px solid #57503f;border-radius:3px;padding:2px 6px;font-size:11px;cursor:pointer;${wide ? 'flex:1;' : ''}`;
  el.addEventListener('click', onClick);
  return el;
}

function buttonRow(parent: HTMLElement, buttons: HTMLButtonElement[]): void {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:3px;margin-top:3px;flex-wrap:wrap;';
  for (const el of buttons) row.appendChild(el);
  parent.appendChild(row);
}

function exportEntries(): void {
  if (!state.room) return;
  const payload = JSON.stringify(
    { interior: state.room.interior, entries: state.entries },
    null,
    1,
  );
  console.log(`[placer] ${state.room.interior} export:\n${payload}`);
  try {
    void navigator.clipboard?.writeText(payload);
  } catch {}
  state.deps?.log(
    `[placer] exported ${state.entries.length} placements to console and clipboard`,
    '#8fd0ff',
  );
}

function enterRoom(room: PlacerRoom): void {
  state.room = room;
  state.entries = loadEntries(room.interior) ?? prefillFromPlan(room);
  state.selected = -1;
  setDressingHidden(true);
  rebuildGroup();
  renderPicker();
}

function buildPanel(): void {
  const panel = document.createElement('div');
  panel.id = 'ignivar-placer';
  panel.style.cssText =
    'position:fixed;left:10px;top:64px;width:420px;max-height:82vh;overflow-y:auto;z-index:4000;' +
    'background:rgba(18,15,12,0.94);border:1px solid #6b5b3e;border-radius:6px;padding:8px;' +
    "color:#f0e6d2;font:12px 'Segoe UI',sans-serif;";

  const status = document.createElement('div');
  status.style.cssText = 'font-size:11px;color:#c9a86a;margin-bottom:4px;white-space:pre-line;';
  panel.appendChild(status);
  state.statusEl = status;

  const pickerLabel = document.createElement('div');
  pickerLabel.textContent = 'Place prop (spawns in front of you):';
  pickerLabel.style.cssText = 'margin-top:2px;font-weight:bold;';
  panel.appendChild(pickerLabel);
  const picker = document.createElement('div');
  picker.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;margin-top:3px;';
  panel.appendChild(picker);
  state.pickerEl = picker;
  renderPicker();

  const controlsLabel = document.createElement('div');
  controlsLabel.textContent = 'Selected object:';
  controlsLabel.style.cssText = 'margin-top:8px;font-weight:bold;';
  panel.appendChild(controlsLabel);
  const info = document.createElement('div');
  info.style.cssText = 'font-size:11px;color:#9fd8ff;margin-top:2px;white-space:pre-wrap;';
  info.textContent = 'nothing selected';
  panel.appendChild(info);
  state.infoEl = info;

  buttonRow(
    panel,
    SCALES.map((scale) =>
      button(`x${scale}`, () =>
        mutateSelected((entry) => {
          entry.scale = scale;
        }),
      ),
    ),
  );
  buttonRow(panel, [
    button('rot -45', () =>
      mutateSelected((entry) => {
        entry.rot = (entry.rot - 45 + 360) % 360;
      }),
    ),
    button('rot +45', () =>
      mutateSelected((entry) => {
        entry.rot = (entry.rot + 45) % 360;
      }),
    ),
    button('rot -15', () =>
      mutateSelected((entry) => {
        entry.rot = (entry.rot - 15 + 360) % 360;
      }),
    ),
    button('rot +15', () =>
      mutateSelected((entry) => {
        entry.rot = (entry.rot + 15) % 360;
      }),
    ),
    button('to me', () =>
      mutateSelected((entry) => {
        const local = localPlayerPos();
        if (!local) return;
        entry.x = Math.round(local.x * 10) / 10;
        entry.z = Math.round(local.z * 10) / 10;
      }),
    ),
    button('dup', () => {
      const entry = selectedEntry();
      if (!entry) return;
      state.entries.push({ ...entry, x: entry.x + 2 });
      state.selected = state.entries.length - 1;
      rebuildGroup();
    }),
  ]);
  const nudge = (dx: number, dz: number) => () =>
    mutateSelected((entry) => {
      entry.x = Math.round((entry.x + dx) * 100) / 100;
      entry.z = Math.round((entry.z + dz) * 100) / 100;
    });
  buttonRow(panel, [
    button('X-1', nudge(-1, 0)),
    button('X+1', nudge(1, 0)),
    button('Z-1', nudge(0, -1)),
    button('Z+1', nudge(0, 1)),
  ]);
  buttonRow(panel, [
    button('X-.25', nudge(-0.25, 0)),
    button('X+.25', nudge(0.25, 0)),
    button('Z-.25', nudge(0, -0.25)),
    button('Z+.25', nudge(0, 0.25)),
  ]);
  const nudgeY = (dy: number) => () =>
    mutateSelected((entry) => {
      // Interiors floor at 0 (the room's own floor); the exterior floors at
      // -8, past the waterline (-4.3), so pieces can sink to the seabed.
      const floor = state.room?.exterior ? -8 : 0;
      entry.y = Math.max(floor, Math.round((entry.y + dy) * 100) / 100);
    });
  buttonRow(panel, [
    button('Y-1', nudgeY(-1)),
    button('Y+1', nudgeY(1)),
    button('Y-.25', nudgeY(-0.25)),
    button('Y+.25', nudgeY(0.25)),
  ]);

  const listLabel = document.createElement('div');
  listLabel.textContent = 'Placed (click to select):';
  listLabel.style.cssText = 'margin-top:8px;font-weight:bold;';
  panel.appendChild(listLabel);
  const list = document.createElement('div');
  list.style.cssText =
    'margin-top:3px;max-height:200px;overflow-y:auto;border:1px solid #453c2c;border-radius:4px;padding:2px;';
  panel.appendChild(list);
  state.listEl = list;

  buttonRow(panel, [
    button('export JSON', exportEntries, true),
    button('reload plan', () => {
      if (!state.room) return;
      state.entries = prefillFromPlan(state.room);
      state.selected = -1;
      rebuildGroup();
    }),
    button(
      'clear room',
      () => {
        state.entries = [];
        state.selected = -1;
        rebuildGroup();
      },
      false,
    ),
  ]);
  const worklightBtn = button(worklightLabel(), () => {
    setWorklight(!worklightOn);
    worklightBtn.textContent = worklightLabel();
  });
  const kitBtn = button(kitLabel(), () => {
    kitOverride = activeKit() === 'exterior' ? 'interior' : 'exterior';
    renderPicker();
  });
  state.kitBtn = kitBtn;
  buttonRow(panel, [
    button(
      'toggle built dressing',
      () => {
        if (state.hiddenDressing.length > 0) setDressingHidden(false);
        else setDressingHidden(true);
      },
      true,
    ),
    kitBtn,
    worklightBtn,
    button('close', closePlacer),
  ]);

  document.body.appendChild(panel);
  state.panel = panel;
}

function tickStatus(): void {
  const player = state.deps?.getPlayer();
  const room = roomForPlayer(player);
  if (room && room !== state.room) enterRoom(room);
  if (!state.statusEl) return;
  if (!room || !player) {
    state.statusEl.textContent =
      'Not at a placer site (this instance has no placement set).\nUse /dev dungeon ignivar_forge_approach normal (or _raid_arena / _inner_crucible), or leave to the open world for the exterior site.';
    return;
  }
  const lx = (player.pos.x - room.ox).toFixed(1);
  const lz = (player.pos.z - room.oz).toFixed(1);
  state.statusEl.textContent = `${room.label}\nyou: (${lx}, ${lz})  placed: ${state.entries.length}`;
}

function closePlacer(): void {
  if (state.timer !== null) {
    window.clearInterval(state.timer);
    state.timer = null;
  }
  state.panel?.remove();
  state.panel = null;
  state.listEl = null;
  state.statusEl = null;
  state.infoEl = null;
  state.pickerEl = null;
  state.kitBtn = null;
  if (state.group) {
    state.group.parent?.remove(state.group);
    state.group = null;
  }
  setDressingHidden(false);
  applyWorklight();
  state.room = null;
  state.deps?.log('[placer] closed (placements stay saved locally)', '#8fd0ff');
}

function openPlacer(deps: IgnivarPlacerDeps): void {
  state.deps = deps;
  void prepareIgnivarEnvProps().then(() => {
    if (state.panel) return;
    buildPanel();
    applyWorklight();
    const room = roomForPlayer(deps.getPlayer());
    if (room) enterRoom(room);
    tickStatus();
    state.timer = window.setInterval(tickStatus, 300);
    deps.log(
      '[placer] open. Walk somewhere, click a prop to place it, tune with the panel. Export when done.',
      '#8fd0ff',
    );
  });
}

/** Chat hook: `/dev placer` or `/placer` toggles the rig. Dev builds only. */
export function tryIgnivarPlacerCommand(raw: string, deps: IgnivarPlacerDeps): boolean {
  if (!/^\/(?:dev\s+placer|placer)\s*$/i.test(raw.trim())) return false;
  if (!import.meta.env.DEV) return false;
  if (state.panel) closePlacer();
  else openPlacer(deps);
  return true;
}
