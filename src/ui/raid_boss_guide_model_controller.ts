// Cold DOM adapter for the raid journal's one lazy 3D boss turntable. The selected
// boss reuses one WebGL context across journal re-renders and boss switches, while
// close() releases it immediately. The committed portrait remains the loading,
// reduced-motion, no-WebGL, and failure fallback.

import type { GuideModelSpec } from '../guide/content.generated';
import type { LinkedProgramTouchQueue } from '../render/linked_program_touch_lane';
import { FOCUS_KEY_ATTR } from './focus_restore';
import type { RaidBossGuideBoss } from './raid_boss_guide_view';

/** The standalone guide viewer's model spec (the raid pins its three; a
 *  dungeon page resolves its boss's in-game model, boss_journal/journal_model_spec.ts). */
export type RaidBossGuideModelSpec = GuideModelSpec;

export const RAID_BOSS_GUIDE_MODEL_SPECS: Readonly<
  Record<RaidBossGuideBoss, RaidBossGuideModelSpec>
> = Object.freeze({
  ignivar: {
    url: 'models/creatures/ignivar_herald.glb',
    idle: 'Idle',
    height: 2.65,
    yaw: 0,
  },
  varkhul: {
    url: 'models/creatures/varkhul_forgefather.glb',
    idle: 'Idle',
    height: 3,
    yaw: 0,
  },
  // The in-world skel_golem rig (src/render/characters/manifest.ts): its base GLB
  // carries the shared Idle clip; the bespoke Golem_Slam lives in a sidecar the
  // turntable never needs.
  nythraxis: {
    url: 'models/chars/enemies/skeleton_golem.glb',
    idle: 'Idle',
    height: 3.4,
    yaw: 0,
  },
});

export interface RaidBossGuideModelViewer {
  load(spec: RaidBossGuideModelSpec, tint: number | null): Promise<void>;
  destroy(): void;
  onContextLost(callback: () => void): void;
  setLabel(label: string): void;
  setOnscreen(value: boolean): void;
}

export type RaidBossGuideModelViewerFactory = (
  stage: HTMLElement,
  canvasLabel: string,
  touchQueue?: () => LinkedProgramTouchQueue | null,
) => Promise<RaidBossGuideModelViewer>;

export interface RaidBossGuideModelMountOptions {
  /** The model's identity across re-renders: a raid boss slug or a dungeon mob id. */
  boss: string;
  /** The model to load. Absent: the raid's pinned spec for `boss`. Null: no 3D
   *  model for this boss, so the committed portrait stays (no WebGL context). */
  spec?: RaidBossGuideModelSpec | null;
  tint?: number | null;
  name: string;
  posterUrl: string;
  canvasLabel: string;
  loadingText: string;
  errorText: string;
  hintText: string;
  viewButtonText: string;
  viewButtonLabel: string;
}

type ModelState = 'idle' | 'loading' | 'ready' | 'error' | 'nowebgl';

/** The shared GLB cache the real viewer loads through: the journal releases,
 *  on close, the boss files it was first to bring in (a Dungeon Finder visit
 *  can browse two dozen bosses the world never needed). Injected for tests. */
export interface RaidBossGuideGltfCache {
  isCached(url: string): boolean;
  release(url: string): void;
}

let sharedLoader: typeof import('../render/assets/loader') | null = null;

const DEFAULT_GLTF_CACHE: RaidBossGuideGltfCache = {
  // Unknown until the real viewer has loaded the module: never release then.
  isCached: (url) => sharedLoader?.isGltfCached(url) ?? true,
  release: (url) => sharedLoader?.releaseGltf(url),
};

async function createDefaultViewer(
  stage: HTMLElement,
  canvasLabel: string,
  touchQueue: () => LinkedProgramTouchQueue | null = () => null,
): Promise<RaidBossGuideModelViewer> {
  const { ModelViewer } = await import('../guide/viewer/scene');
  sharedLoader ??= await import('../render/assets/loader');
  return new ModelViewer(stage, canvasLabel, touchQueue);
}

function browserSupportsWebGL(doc: Document): boolean {
  const win = doc.defaultView;
  if (!win?.WebGLRenderingContext) return false;
  try {
    const canvas = doc.createElement('canvas');
    const context =
      canvas.getContext('webgl') ??
      (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null);
    if (!context) return false;
    context.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function browserPrefersReducedMotion(doc: Document): boolean {
  return doc.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches ?? false;
}

export class RaidBossGuideModelController {
  private readonly host: HTMLDivElement;
  private readonly stage: HTMLDivElement;
  private readonly poster: HTMLImageElement;
  private readonly loadButton: HTMLButtonElement;
  private readonly status: HTMLParagraphElement;
  private readonly hint: HTMLParagraphElement;
  private viewer: RaidBossGuideModelViewer | null = null;
  private visibilityObserver: IntersectionObserver | null = null;
  private loadQueue: Promise<void> = Promise.resolve();
  private requestedBoss: string | null = null;
  private loadedBoss: string | null = null;
  private options: RaidBossGuideModelMountOptions | null = null;
  private webglSupported: boolean | null = null;
  /** GLB files this journal was first to load (released on destroy). */
  private readonly ownedUrls = new Set<string>();
  private restoreFocusAfterLoad = false;
  private generation = 0;
  private onscreen = true;

  constructor(
    doc: Document = document,
    private readonly createViewer: RaidBossGuideModelViewerFactory = createDefaultViewer,
    private readonly supportsWebGL: () => boolean = () => browserSupportsWebGL(doc),
    private readonly prefersReducedMotion: () => boolean = () => browserPrefersReducedMotion(doc),
    private readonly touchQueue: () => LinkedProgramTouchQueue | null = () => null,
    private readonly gltfCache: RaidBossGuideGltfCache = DEFAULT_GLTF_CACHE,
  ) {
    this.host = doc.createElement('div');
    this.host.className = 'rbg-model-viewer';

    this.stage = doc.createElement('div');
    this.stage.className = 'rbg-model-stage';

    this.poster = doc.createElement('img');
    this.poster.className = 'rbg-model-poster';
    this.poster.decoding = 'async';
    this.poster.draggable = false;

    this.loadButton = doc.createElement('button');
    this.loadButton.type = 'button';
    this.loadButton.className = 'rbg-model-load';
    this.loadButton.setAttribute(FOCUS_KEY_ATTR, 'model-load');
    this.loadButton.addEventListener('click', () => this.activate());

    this.status = doc.createElement('p');
    this.status.className = 'rbg-model-status';
    this.status.tabIndex = -1;
    this.status.setAttribute(FOCUS_KEY_ATTR, 'model-status');
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');

    this.hint = doc.createElement('p');
    this.hint.className = 'rbg-model-hint';

    this.stage.append(this.poster, this.loadButton, this.status);
    this.host.append(this.stage, this.hint);
    this.setState('idle');
  }

  mount(slot: HTMLElement, options: RaidBossGuideModelMountOptions): void {
    this.options = options;
    this.poster.src = options.posterUrl;
    this.poster.alt = options.name;
    this.loadButton.textContent = options.viewButtonText;
    this.loadButton.setAttribute('aria-label', options.viewButtonLabel);
    this.hint.textContent = options.hintText;
    slot.replaceChildren(this.host);
    this.setState((this.host.dataset.state as ModelState | undefined) ?? 'idle');

    if (options.spec === null || !this.canUseWebGL()) {
      // A portrait-only page holds no WebGL context, and an in-flight load for
      // the previous boss must never land on it.
      if (options.spec === null) this.releaseViewer();
      this.requestedBoss = options.boss;
      this.loadedBoss = null;
      this.setState('nowebgl');
      return;
    }

    if (this.viewer) this.viewer.setLabel(options.canvasLabel);
    if (this.loadedBoss === options.boss) {
      this.requestedBoss = options.boss;
      this.setState('ready');
      return;
    }
    if (
      this.requestedBoss === options.boss &&
      (this.host.dataset.state === 'loading' || this.host.dataset.state === 'error')
    ) {
      return;
    }

    this.requestedBoss = options.boss;
    this.loadedBoss = null;
    this.generation++;
    this.setState('idle');
    if (!this.prefersReducedMotion()) this.activate();
  }

  private releaseViewer(): void {
    this.generation++;
    this.restoreFocusAfterLoad = false;
    this.visibilityObserver?.disconnect();
    this.visibilityObserver = null;
    const viewer = this.viewer;
    this.viewer = null;
    viewer?.destroy();
  }

  destroy(): void {
    this.releaseViewer();
    this.requestedBoss = null;
    this.loadedBoss = null;
    this.options = null;
    for (const url of this.ownedUrls) this.gltfCache.release(url);
    this.ownedUrls.clear();
    this.host.remove();
    this.setState('idle');
    this.loadQueue = Promise.resolve();
  }

  private activate(): void {
    const options = this.options;
    if (
      !options ||
      options.spec === null ||
      !this.canUseWebGL() ||
      this.host.dataset.state === 'loading'
    ) {
      return;
    }
    const shouldRestoreFocus = this.loadButton.ownerDocument.activeElement === this.loadButton;
    this.restoreFocusAfterLoad ||= shouldRestoreFocus;
    const generation = ++this.generation;
    const boss = options.boss;
    this.requestedBoss = boss;
    this.setState('loading');
    if (shouldRestoreFocus) this.status.focus();
    this.loadQueue = this.loadQueue
      .catch(() => undefined)
      .then(() => this.load(generation, boss, options))
      .catch((error: unknown) => {
        if (generation !== this.generation) return;
        console.error('Raid boss guide model failed to load', error);
        this.loadedBoss = null;
        this.setState('error');
        const shouldRestore =
          this.restoreFocusAfterLoad || this.stage.contains(this.host.ownerDocument.activeElement);
        this.restoreFocusAfterLoad = false;
        if (shouldRestore) this.loadButton.focus();
      });
  }

  private canUseWebGL(): boolean {
    this.webglSupported ??= this.supportsWebGL();
    return this.webglSupported;
  }

  private async load(
    generation: number,
    boss: string,
    options: RaidBossGuideModelMountOptions,
  ): Promise<void> {
    const canvasLabel = options.canvasLabel;
    const spec = options.spec ?? RAID_BOSS_GUIDE_MODEL_SPECS[boss as RaidBossGuideBoss];
    if (!spec) throw new Error(`No boss guide model for ${boss}`);
    if (generation !== this.generation) return;
    let viewer = this.viewer;
    if (!viewer) {
      viewer = await this.createViewer(this.stage, canvasLabel, this.touchQueue);
      if (generation !== this.generation) {
        viewer.destroy();
        return;
      }
      this.viewer = viewer;
      this.stage.querySelector('canvas')?.setAttribute(FOCUS_KEY_ATTR, 'model-canvas');
      const createdViewer = viewer;
      viewer.onContextLost(() => this.handleContextLost(createdViewer));
      this.observeVisibility(viewer);
    }
    if (generation !== this.generation) return;
    viewer.setLabel(canvasLabel);
    // Every file the viewer loads for this spec: the body, its weapons, and
    // any clip or armor files a split body carries.
    for (const url of [
      spec.url,
      ...(spec.attach ?? []).map((a) => a.url),
      ...(spec.animUrls ?? []),
      ...(spec.armor ?? []),
    ]) {
      if (!this.gltfCache.isCached(url)) this.ownedUrls.add(url);
    }
    await viewer.load(spec, options.tint ?? null);
    if (generation !== this.generation) return;
    this.loadedBoss = boss;
    this.setState('ready');
    if (this.restoreFocusAfterLoad) {
      this.restoreFocusAfterLoad = false;
      this.stage.querySelector<HTMLElement>('canvas')?.focus();
    }
  }

  private handleContextLost(viewer: RaidBossGuideModelViewer): void {
    if (viewer !== this.viewer) return;
    const shouldRestoreFocus = this.stage.contains(this.host.ownerDocument.activeElement);
    this.generation++;
    this.viewer = null;
    this.loadedBoss = null;
    this.visibilityObserver?.disconnect();
    this.visibilityObserver = null;
    viewer.destroy();
    this.setState('error');
    this.restoreFocusAfterLoad = false;
    if (shouldRestoreFocus) this.loadButton.focus();
  }

  private observeVisibility(viewer: RaidBossGuideModelViewer): void {
    this.visibilityObserver?.disconnect();
    if (typeof IntersectionObserver === 'undefined') {
      viewer.setOnscreen(true);
      return;
    }
    this.visibilityObserver = new IntersectionObserver((entries) => {
      const entry = entries.find((candidate) => candidate.target === this.stage);
      if (!entry) return;
      this.onscreen = entry.isIntersecting;
      viewer.setOnscreen(this.onscreen);
    });
    this.visibilityObserver.observe(this.stage);
    viewer.setOnscreen(this.onscreen);
  }

  private setState(state: ModelState): void {
    this.host.dataset.state = state;
    this.stage.setAttribute('aria-busy', String(state === 'loading'));
    const options = this.options;
    this.status.textContent =
      state === 'loading'
        ? (options?.loadingText ?? '')
        : state === 'error'
          ? (options?.errorText ?? '')
          : '';
  }
}
