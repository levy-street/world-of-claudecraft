// The seam between the public map editor and ClaudeCraft Studio, the private
// authoring tool that lives outside this repository.
//
// `#studio` is an abstract import specifier (the same idiom as `#bot-detector`):
// vite.config.ts and tsconfig.json `paths` resolve it to src/studio/index.ts when
// that private clone is present on disk, and to ./studio_stub.ts otherwise. A
// public checkout, CI and every shipped build therefore run the public editor;
// a team member who has cloned Studio into src/studio/ (gitignored) boots Studio
// from the same editor.html entry with no code change.
//
// The contract is deliberately one function so the private side can evolve
// freely: Studio receives the mount element and the deep-cloned built-in world
// the public editor would have started from, and owns everything after that.

import type { ZoneContent } from './model';

export interface StudioBootContext {
  /** The #editor-app element editor.html provides. */
  mount: HTMLElement;
  /** A deep clone of the built-in world's authored tables (never the shared module globals). */
  world: ZoneContent;
}

export type StudioBoot = (context: StudioBootContext) => void | Promise<void>;

/** What a `#studio` module exports: `null` from the stub, a boot function from Studio. */
export interface StudioModule {
  studioBoot: StudioBoot | null;
}
