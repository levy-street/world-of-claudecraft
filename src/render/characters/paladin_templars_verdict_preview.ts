import * as THREE from 'three';
import { assetsReady } from '../assets/preload';
import type { AnimState } from './anim_state';
import {
  PALADIN_TEMPLARS_VERDICT_IMPACT_NORMALIZED,
  PALADIN_TEMPLARS_VERDICT_IMPACT_TIME,
} from './paladin_templars_verdict_clip';
import { CharacterVisual } from './visual';

const PREVIEW_STATE: AnimState = {
  speed: 0,
  moving: false,
  running: false,
  airborne: false,
  backwards: false,
  dead: false,
  casting: false,
  swimming: false,
  submerged: false,
  swimPitch: 0,
  wading: false,
  sitting: false,
};

export interface PaladinTemplarsVerdictPreview {
  replay(): void;
  pauseAt(seconds: number): void;
  dispose(): void;
}

/**
 * Mounts a repeatable comparison at the normal 60 degree, 12-unit gameplay
 * camera distance. Space and the on-screen button replay both attacks.
 */
export async function mountPaladinTemplarsVerdictPreview(
  host: HTMLElement = document.body,
): Promise<PaladinTemplarsVerdictPreview> {
  await assetsReady();

  const stage = document.createElement('div');
  stage.style.cssText =
    'position:fixed;inset:0;background:#090d16;color:#f7e7a9;font:600 18px system-ui;overflow:hidden';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100%;height:100%';
  stage.appendChild(canvas);

  const title = document.createElement('div');
  title.textContent = 'Ataque básico 1H                         Final Edict';
  title.style.cssText =
    'position:absolute;left:0;right:0;top:24px;text-align:center;white-space:pre;color:#ffe58b;text-shadow:0 2px 5px #000';
  stage.appendChild(title);

  const timing = document.createElement('div');
  timing.textContent = `Impacto Final Edict: ${PALADIN_TEMPLARS_VERDICT_IMPACT_TIME.toFixed(2)} s / normalizado ${PALADIN_TEMPLARS_VERDICT_IMPACT_NORMALIZED.toFixed(2)}`;
  timing.style.cssText =
    'position:absolute;left:24px;bottom:24px;color:#d8cfae;text-shadow:0 2px 5px #000';
  stage.appendChild(timing);

  const replayButton = document.createElement('button');
  replayButton.type = 'button';
  replayButton.textContent = 'Repetir (Espacio)';
  replayButton.style.cssText =
    'position:absolute;right:24px;bottom:20px;padding:10px 16px;border:1px solid #e8bd51;border-radius:6px;background:#33270d;color:#ffe58b;font:600 16px system-ui;cursor:pointer';
  stage.appendChild(replayButton);
  host.replaceChildren(stage);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x090d16);
  scene.fog = new THREE.Fog(0x090d16, 15, 25);
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(4.4, 5.1, 10.5);
  camera.lookAt(0, 1.3, 0);

  scene.add(new THREE.HemisphereLight(0xfff4d4, 0x17213d, 2.2));
  const keyLight = new THREE.DirectionalLight(0xffe6a3, 3.2);
  keyLight.position.set(-4, 8, -5);
  keyLight.castShadow = true;
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0x7ca8ff, 1.8);
  rimLight.position.set(5, 4, 6);
  scene.add(rimLight);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(9, 64),
    new THREE.MeshStandardMaterial({ color: 0x151b27, roughness: 0.92, metalness: 0.05 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const basic = new CharacterVisual('player_paladin', 0xffffff);
  const verdict = new CharacterVisual('player_paladin', 0xffffff);
  basic.root.position.x = -2.15;
  verdict.root.position.x = 2.15;
  scene.add(basic.root, verdict.root);
  basic.update(0, PREVIEW_STATE, true);
  verdict.update(0, PREVIEW_STATE, true);

  let disposed = false;
  let paused = false;
  let lastFrame = performance.now();
  let nextReplay = lastFrame;
  let frameId = 0;

  const replay = (): void => {
    paused = false;
    basic.playAttack();
    verdict.playAttack('final_edict');
    nextReplay = performance.now() + 1_450;
  };

  const pauseAt = (seconds: number): void => {
    paused = true;
    basic.playAttack();
    verdict.playAttack('final_edict');
    basic.update(seconds, PREVIEW_STATE, true);
    verdict.update(seconds, PREVIEW_STATE, true);
    renderer.render(scene, camera);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== 'Space') return;
    event.preventDefault();
    replay();
  };
  const onResize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  replayButton.addEventListener('click', replay);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', onResize);

  const animate = (now: number): void => {
    if (disposed) return;
    const dt = Math.min(0.1, (now - lastFrame) / 1_000);
    lastFrame = now;
    if (!paused) {
      basic.update(dt, PREVIEW_STATE, true);
      verdict.update(dt, PREVIEW_STATE, true);
      if (now >= nextReplay) replay();
    }
    renderer.render(scene, camera);
    frameId = requestAnimationFrame(animate);
  };
  frameId = requestAnimationFrame(animate);
  replay();

  return {
    replay,
    pauseAt,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frameId);
      replayButton.removeEventListener('click', replay);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
      basic.dispose();
      verdict.dispose();
      renderer.dispose();
      stage.remove();
    },
  };
}
