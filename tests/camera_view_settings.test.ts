import { describe, expect, it } from 'vitest';
import {
  ACTION_CAM_ZOOM,
  actionCamSideFromSetting,
  applyCameraViewSetting,
  applyCameraViewSettings,
} from '../src/game/camera_view_settings';
import { Settings } from '../src/game/settings';
import type { ActionCamSide } from '../src/render/action_cam_core';

function fakeRenderer() {
  const calls: { fov: number[]; action: Array<[boolean, ActionCamSide]> } = { fov: [], action: [] };
  return {
    calls,
    setCameraFov: (deg: number) => calls.fov.push(deg),
    actionCam: { set: (on: boolean, side: ActionCamSide) => calls.action.push([on, side]) },
  };
}

describe('camera_view_settings', () => {
  it('passes the shoulder slider through as the core offset, clamped', () => {
    expect(actionCamSideFromSetting(-1)).toBe(-1);
    expect(actionCamSideFromSetting(0)).toBe(0);
    expect(actionCamSideFromSetting(0.35)).toBe(0.35);
    expect(actionCamSideFromSetting(4)).toBe(1);
    expect(actionCamSideFromSetting(Number.NaN)).toBe(1);
  });

  it('applies every camera view setting onto a rebuilt renderer', () => {
    const settings = new Settings();
    settings.set('cameraFov', 72);
    settings.set('actionCam', true);
    settings.set('actionCamShoulder', -1);
    const r = fakeRenderer();
    applyCameraViewSettings(r, settings);
    expect(r.calls.fov).toEqual([72]);
    expect(r.calls.action).toEqual([[true, -1]]);
  });

  it('persists and pushes the Action Cam keys, keeping the other half', () => {
    const settings = new Settings();
    const r = fakeRenderer();
    expect(applyCameraViewSetting(r, settings, 'actionCam', true)).toBe(true);
    expect(settings.get('actionCam')).toBe(true);
    expect(r.calls.action.at(-1)).toEqual([true, 1]);
    expect(applyCameraViewSetting(r, settings, 'actionCamShoulder', -0.5)).toBe(true);
    expect(settings.get('actionCamShoulder')).toBe(-0.5);
    expect(r.calls.action.at(-1)).toEqual([true, -0.5]);
    expect(applyCameraViewSetting(r, settings, 'actionCamShoulder', 0)).toBe(true);
    expect(r.calls.action.at(-1)).toEqual([true, 0]);
    expect(applyCameraViewSetting(r, settings, 'actionCam', false)).toBe(true);
    expect(r.calls.action.at(-1)).toEqual([false, 0]);
  });

  it('switching Action Cam on zooms all the way in, once, on the edge only', () => {
    const settings = new Settings();
    settings.set('cameraZoom', 15);
    const zoom = { camDist: 15 };
    const r = fakeRenderer();
    // Boot replay of the saved "off", then the player flips it on. The options
    // toggle writes the store BEFORE notifying, so mirror that order here.
    applyCameraViewSetting(r, settings, 'actionCam', false, zoom);
    settings.set('actionCam', true);
    applyCameraViewSetting(r, settings, 'actionCam', true, zoom);
    expect(ACTION_CAM_ZOOM).toBe(3);
    expect(zoom.camDist).toBe(ACTION_CAM_ZOOM);
    expect(settings.get('cameraZoom')).toBe(ACTION_CAM_ZOOM);
    // The player scrolls back out; a repeat "on" keeps their zoom.
    zoom.camDist = 10;
    applyCameraViewSetting(r, settings, 'actionCam', true, zoom);
    expect(zoom.camDist).toBe(10);
    // Turning it off leaves the zoom alone; on again zooms in again.
    applyCameraViewSetting(r, settings, 'actionCam', false, zoom);
    expect(zoom.camDist).toBe(10);
    applyCameraViewSetting(r, settings, 'actionCam', true, zoom);
    expect(zoom.camDist).toBe(ACTION_CAM_ZOOM);
  });

  it('a saved "on" replayed at boot never overrides the remembered zoom', () => {
    const settings = new Settings();
    settings.set('actionCam', true);
    settings.set('cameraZoom', 14);
    const zoom = { camDist: 14 };
    applyCameraViewSetting(fakeRenderer(), settings, 'actionCam', true, zoom);
    expect(zoom.camDist).toBe(14);
    expect(settings.get('cameraZoom')).toBe(14);
  });

  it('clamps and applies the FOV, and passes on keys it does not own', () => {
    const settings = new Settings();
    const r = fakeRenderer();
    expect(applyCameraViewSetting(r, settings, 'cameraFov', 500)).toBe(true);
    expect(r.calls.fov).toEqual([100]);
    expect(applyCameraViewSetting(r, settings, 'cameraSpeed', 1)).toBe(false);
    expect(r.calls.action).toEqual([]);
  });
});
