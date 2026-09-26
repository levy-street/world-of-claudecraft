// The renderer-side camera VIEW settings (field of view and the Action Cam),
// applied from the settings store. Render modules never read the store, so
// main.ts pushes these through here: once per changed key from its settings
// router, and all at once onto a freshly rebuilt renderer.

import type { ActionCamSide } from '../render/action_cam_core';
import { type GameSettings, SETTING_RANGES } from './settings';

export interface CameraViewRenderer {
  setCameraFov(deg: number): void;
  readonly actionCam: { set(enabled: boolean, side: ActionCamSide): void };
}

export interface CameraViewSettingsStore {
  get<K extends 'cameraFov' | 'actionCam' | 'actionCamShoulder'>(key: K): GameSettings[K];
  set(key: 'cameraFov' | 'actionCamShoulder' | 'cameraZoom', value: number): number;
  set(key: 'actionCam', value: boolean): boolean;
}

/** The player's zoom (Input.camDist): Action Cam pulls it all the way in. */
export interface CameraZoomTarget {
  camDist: number;
}

/** The closest zoom, which the Action Cam snaps to when switched on. */
export const ACTION_CAM_ZOOM = SETTING_RANGES.cameraZoom.min;

// The last Action Cam state applied per zoom target (the one Input). The
// options toggle writes the store BEFORE it notifies, so the store cannot
// tell an edge; this can. The first apply (the boot apply-all replaying a
// saved choice) only records, so a remembered zoom is never overridden.
const lastApplied = new WeakMap<CameraZoomTarget, boolean>();

/** True only on an off-to-on flip after the first apply for this target. */
export function actionCamTurnedOn(zoom: CameraZoomTarget, on: boolean): boolean {
  const prev = lastApplied.get(zoom);
  lastApplied.set(zoom, on);
  return prev === false && on;
}

/** The stored shoulder slider (-1 full left .. 0 center .. 1 full right). */
export function actionCamSideFromSetting(v: number): ActionCamSide {
  return Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 1;
}

function pushActionCam(renderer: CameraViewRenderer, store: CameraViewSettingsStore): void {
  renderer.actionCam.set(
    store.get('actionCam'),
    actionCamSideFromSetting(store.get('actionCamShoulder')),
  );
}

/** Push every camera view setting onto a renderer (a rebuilt one). */
export function applyCameraViewSettings(
  renderer: CameraViewRenderer,
  store: CameraViewSettingsStore,
): void {
  renderer.setCameraFov(store.get('cameraFov'));
  pushActionCam(renderer, store);
}

/**
 * Persist and apply one changed setting when it is a camera view key.
 * Returns false for any other key so the caller's router carries on.
 */
export function applyCameraViewSetting(
  renderer: CameraViewRenderer,
  store: CameraViewSettingsStore,
  key: string,
  value: number | boolean,
  zoom?: CameraZoomTarget,
): boolean {
  if (key === 'cameraFov') {
    renderer.setCameraFov(store.set('cameraFov', Number(value)));
    return true;
  }
  if (key === 'actionCam' || key === 'actionCamShoulder') {
    if (key === 'actionCam') {
      const on = store.set('actionCam', !!value);
      if (zoom && actionCamTurnedOn(zoom, on)) {
        zoom.camDist = store.set('cameraZoom', ACTION_CAM_ZOOM);
      }
    } else store.set('actionCamShoulder', Number(value));
    pushActionCam(renderer, store);
    return true;
  }
  return false;
}
