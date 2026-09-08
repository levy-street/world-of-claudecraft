import { rowTreeFor, TALENTS } from '../sim/content/talents';
import { ABILITIES } from '../sim/data';
import { ALL_CLASSES, type PlayerClass } from '../sim/types';
import type { StudioConfig } from './session';

export interface StudioBuildMemory {
  spec: string | null;
  rows: StudioConfig['rows'];
  selected: string;
}
interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
const KEY = 'woc-vfx-workspace-v1';

/** Preferences contain IDs only. Validate saved builds against the live kit so
 * an old version's talent choices cannot prevent the next studio boot. */
export class StudioWorkspace {
  readonly builds = new Map<PlayerClass, StudioBuildMemory>();
  readonly favourites = new Set<string>();
  constructor(private storage?: StorageLike) {
    try {
      const raw = storage?.getItem(KEY);
      if (!raw || raw.length > 64000) return;
      const data = JSON.parse(raw);
      for (const cls of ALL_CLASSES) {
        const build = data?.builds?.[cls];
        if (!build || !TALENTS[cls].specs.some((spec) => spec.id === build.spec)) continue;
        const rows: NonNullable<StudioConfig['rows']> = {};
        for (const row of rowTreeFor(cls) ?? []) {
          const id = build.rows?.[row.level];
          if (row.options.some((choice) => choice.id === id)) rows[row.level] = id;
        }
        this.builds.set(cls, {
          spec: build.spec,
          rows,
          selected:
            typeof build.selected === 'string' && Object.hasOwn(ABILITIES, build.selected)
              ? build.selected
              : '',
        });
      }
      if (Array.isArray(data?.favourites))
        for (const id of data.favourites.slice(0, 512)) {
          if (typeof id === 'string' && Object.hasOwn(ABILITIES, id)) this.favourites.add(id);
        }
    } catch {
      /* Storage can be unavailable, editing still works in memory. */
    }
  }
  remember(config: StudioConfig, selected: string): void {
    this.builds.set(config.cls, { spec: config.spec, rows: { ...config.rows }, selected });
    this.save();
  }
  toggleFavourite(id: string): boolean {
    if (this.favourites.has(id)) this.favourites.delete(id);
    else if (Object.hasOwn(ABILITIES, id)) this.favourites.add(id);
    this.save();
    return this.favourites.has(id);
  }
  private save(): void {
    try {
      this.storage?.setItem(
        KEY,
        JSON.stringify({
          builds: Object.fromEntries(this.builds),
          favourites: [...this.favourites],
        }),
      );
    } catch {
      /* Keep the in-memory workspace. */
    }
  }
}

export function openStudioWorkspace(): StudioWorkspace {
  try {
    return new StudioWorkspace(localStorage);
  } catch {
    return new StudioWorkspace();
  }
}
