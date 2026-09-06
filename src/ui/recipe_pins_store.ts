// The per-character pinned-recipe store: the crafting window's pin chips write
// it, the #recipe-tracker strip reads it. Persists under
// `woc_recipe_pins_<class>_<name>` (the deeds watchlist / Reliquary pin storage
// contract), so two characters on one browser keep their own farming lists.
// The storage handle is INJECTED (Hud passes window.localStorage), so this
// module reaches no browser global and stays unit-testable with a Map-backed
// double; a throwing or absent storage degrades to in-session pins.

import {
  parseRecipePins,
  type RecipePinToggleResult,
  serializeRecipePins,
  toggleRecipePin,
} from './recipe_tracker_view';

const RECIPE_PIN_KEY_PREFIX = 'woc_recipe_pins';

/** The two storage methods this store needs (a Storage, or a test double). */
export interface RecipePinStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface RecipePinStoreDeps {
  /** The live character identity the key is built from. */
  world(): { cfg: { playerClass: string }; player: { name: string } };
  /** null when storage is unavailable (private mode): pins live in-session only. */
  storage(): RecipePinStorage | null;
  /** Whether a persisted id is still a shipped recipe (stale pins are dropped on load). */
  known(recipeId: string): boolean;
}

export class RecipePinStore {
  private pinnedSet = new Set<string>();
  private loadedKey = '';

  constructor(private readonly deps: RecipePinStoreDeps) {}

  /** The live pin set in pin order; re-keyed lazily when the character changes. */
  get pinned(): ReadonlySet<string> {
    this.ensureLoaded();
    return this.pinnedSet;
  }

  has(recipeId: string): boolean {
    return this.pinned.has(recipeId);
  }

  /** Flip one recipe's pin, persisting on change. `full` reports a refused add. */
  toggle(recipeId: string): RecipePinToggleResult {
    this.ensureLoaded();
    const result = toggleRecipePin(this.pinnedSet, recipeId);
    if (result.changed) {
      this.pinnedSet = new Set(result.pinned);
      this.persist();
    }
    return result;
  }

  private key(): string {
    const world = this.deps.world();
    return `${RECIPE_PIN_KEY_PREFIX}_${world.cfg.playerClass}_${world.player.name}`;
  }

  private ensureLoaded(): void {
    const key = this.key();
    if (key === this.loadedKey) return;
    this.loadedKey = key;
    let raw: string | null = null;
    try {
      raw = this.deps.storage()?.getItem(key) ?? null;
    } catch {
      /* unavailable storage: start unpinned */
    }
    this.pinnedSet = parseRecipePins(raw, this.deps.known);
  }

  private persist(): void {
    try {
      this.deps.storage()?.setItem(this.loadedKey, serializeRecipePins(this.pinnedSet));
    } catch {
      /* storage unavailable (private mode); the pins still work in-session */
    }
  }
}
