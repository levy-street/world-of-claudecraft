// WebXR "Enter VR" support for the game client.
//
// Approach (kept deliberately non-invasive to the flatscreen path):
//  - The renderer's WebGLRenderer has `xr.enabled = true`; everything here is
//    inert until the user taps "Enter VR".
//  - While presenting, the user camera stays parked at the player's eye in WORLD
//    space (see Renderer.updateCamera) so terrain/sky/cloud streaming keep
//    working, and the post-processing composer is bypassed (WebXR renders to the
//    XR framebuffer). The actual headset view is placed in the world by offsetting
//    the XR reference space to the player each frame, plus an optional snap-turn
//    yaw offset for comfort.
//  - A small canvas-textured panel parented to the user camera replaces the DOM
//    HUD, which is not visible in immersive sessions.
import type { PerspectiveCamera, WebGLRenderer } from 'three';
import { t } from '../ui/i18n';
import {
  initialSnapTurnState,
  pollSnapTurn,
  quatToYaw,
  type SnapTurnState,
  tickSnapTurnCooldown,
} from './vr_comfort';
import { VrHud, type VrHudStats } from './vr_hud';

export interface VrPose {
  x: number;
  y: number;
  z: number;
}

export interface VrSessionOptions {
  getPose: () => VrPose;
  getHudStats: () => VrHudStats;
  onSnapTurn?: (yawDelta: number) => void;
}

export interface VrSessionHandle {
  /** Call once per frame; no-ops unless an immersive session is active. */
  update(dt: number): void;
  readonly presenting: boolean;
  /** Accumulated comfort snap-turn yaw (radians). */
  readonly snapYaw: number;
  /** Headset yaw in radians while presenting, else null. */
  headYaw(): number | null;
}

export function installVrSession(
  webgl: WebGLRenderer,
  camera: PerspectiveCamera,
  opts: VrSessionOptions,
): VrSessionHandle {
  const nav = navigator as Navigator & {
    xr?: {
      isSessionSupported(mode: string): Promise<boolean>;
      requestSession(mode: string, opts?: object): Promise<XRSession>;
    };
  };
  const xr = webgl.xr as {
    enabled: boolean;
    setReferenceSpaceType(type: string): void;
    setSession(session: XRSession | null): Promise<void>;
    getReferenceSpace(): XRReferenceSpace | null;
    setReferenceSpace(space: XRReferenceSpace): void;
    isPresenting: boolean;
    getCamera(): { quaternion: { x: number; y: number; z: number; w: number } };
  };
  let session: XRSession | null = null;
  let baseRef: XRReferenceSpace | null = null;
  let btn: HTMLButtonElement | null = null;
  let snapYaw = 0;
  const snapState: SnapTurnState = initialSnapTurnState();
  const hud = new VrHud(camera);
  const uiRoot = document.getElementById('ui');

  if (nav.xr && typeof nav.xr.isSessionSupported === 'function') {
    nav.xr
      .isSessionSupported('immersive-vr')
      .then((ok) => {
        if (ok) addButton();
      })
      .catch(() => {});
  }

  function setDomHudVisible(visible: boolean): void {
    if (uiRoot) uiRoot.hidden = !visible;
    document.body.classList.toggle('vr-presenting', !visible);
    hud.setVisible(!visible);
  }

  function refreshButton(): void {
    if (!btn) return;
    btn.textContent = session ? t('hudChrome.vr.exit') : t('hudChrome.vr.enter');
  }

  function addButton(): void {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = t('hudChrome.vr.enter');
    btn.setAttribute('aria-label', t('hudChrome.vr.enter'));
    btn.style.cssText =
      'position:fixed;right:14px;bottom:14px;z-index:9999;padding:9px 16px;border-radius:10px;' +
      'border:1px solid #888;background:rgba(10,10,16,.85);color:#fff;font:600 13px system-ui;cursor:pointer';
    btn.addEventListener('click', () => {
      void toggle();
    });
    document.body.appendChild(btn);
  }

  async function toggle(): Promise<void> {
    if (session) {
      await session.end();
      return;
    }
    if (!nav.xr) return;
    try {
      session = await nav.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
    } catch {
      if (btn) {
        btn.textContent = t('hudChrome.vr.unavailable');
        btn.setAttribute('aria-label', t('hudChrome.vr.unavailable'));
      }
      return;
    }
    try {
      xr.setReferenceSpaceType('local-floor');
    } catch {}
    await xr.setSession(session);
    baseRef = xr.getReferenceSpace();
    snapYaw = 0;
    Object.assign(snapState, initialSnapTurnState());
    setDomHudVisible(false);
    refreshButton();
    session.addEventListener('end', () => {
      session = null;
      baseRef = null;
      snapYaw = 0;
      Object.assign(snapState, initialSnapTurnState());
      setDomHudVisible(true);
      refreshButton();
      void xr.setSession(null);
    });
  }

  function pollControllerSnapTurn(dt: number): void {
    if (!session || typeof navigator.getGamepads !== 'function') return;
    tickSnapTurnCooldown(snapState, dt);
    for (const pad of navigator.getGamepads()) {
      if (!pad?.connected) continue;
      const stickX = pad.axes[2] ?? 0;
      const delta = pollSnapTurn(stickX, snapState);
      if (delta === 0) continue;
      snapYaw += delta;
      opts.onSnapTurn?.(delta);
      break;
    }
  }

  function applyReferenceSpace(): void {
    if (!session || !baseRef) return;
    const XRRT = (globalThis as { XRRigidTransform?: typeof XRRigidTransform }).XRRigidTransform;
    if (!XRRT) return;
    const p = opts.getPose();
    let space = baseRef.getOffsetReferenceSpace(new XRRT({ x: -p.x, y: -p.y, z: -p.z }));
    if (snapYaw !== 0) {
      const half = snapYaw / 2;
      space = space.getOffsetReferenceSpace(
        new XRRT({ x: 0, y: 0, z: 0, w: 1 }, { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }),
      );
    }
    try {
      xr.setReferenceSpace(space);
    } catch {}
  }

  return {
    get presenting() {
      return !!session;
    },
    get snapYaw() {
      return snapYaw;
    },
    headYaw(): number | null {
      if (!session || !xr.isPresenting) return null;
      const q = xr.getCamera().quaternion;
      return quatToYaw(q.x, q.y, q.z, q.w);
    },
    update(dt: number): void {
      if (!session || !baseRef) return;
      pollControllerSnapTurn(dt);
      applyReferenceSpace();
      hud.update(opts.getHudStats());
    },
  };
}
