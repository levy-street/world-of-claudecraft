import * as THREE from 'three';
import { assetsReady } from './assets/preload';
import type { AnimState } from './characters/anim_state';
import { CharacterVisual } from './characters/visual';
import { PaladinConsecrationVisuals } from './paladin_consecration_visual';
import {
  PALADIN_BASTION_SWEEP_DURATION,
  PALADIN_BASTION_SWEEP_IMPACT_TIME,
  PALADIN_DAWNFALL_DURATION,
  PALADIN_DAWNFALL_IMPACT_NORMALIZED,
  PALADIN_DAWNFALL_IMPACT_TIME,
  PALADIN_HOLY_SHOCK_DURATION,
  PALADIN_HOLY_SHOCK_IMPACT_TIME,
  PALADIN_HOLY_SHOCK_LINK_TIME,
} from './paladin_spell_vfx';
import { Vfx } from './vfx';

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

export const PALADIN_SPELL_VFX_PREVIEW_MODES = [
  'holy',
  'sunward',
  'bastion',
  'dawnfall',
  'consecration',
] as const;
export type PreviewMode = (typeof PALADIN_SPELL_VFX_PREVIEW_MODES)[number];

export interface PaladinSpellVfxPreview {
  replayHoly(): void;
  replaySunward(): void;
  replayBastion(): void;
  replayDawnfall(): void;
  replayConsecration(): void;
  pauseAt(mode: PreviewMode, seconds: number): void;
  dispose(): void;
}

interface PreviewActor {
  id: number;
  visual: CharacterVisual;
}

/** Repeatable normal-camera preview for the Paladin spell VFX suite. */
export async function mountPaladinSpellVfxPreview(
  host: HTMLElement = document.body,
): Promise<PaladinSpellVfxPreview> {
  await assetsReady();

  const stage = document.createElement('div');
  stage.style.cssText =
    'position:fixed;inset:0;background:#080c14;color:#ffe8a0;font:600 16px system-ui;overflow:hidden';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100%;height:100%';
  stage.appendChild(canvas);
  const title = document.createElement('div');
  title.style.cssText =
    'position:absolute;left:16px;right:16px;top:18px;text-align:center;color:#ffe28a;text-shadow:0 2px 5px #000';
  stage.appendChild(title);
  const timing = document.createElement('div');
  timing.style.cssText =
    'position:absolute;left:18px;bottom:18px;color:#d9cfaa;text-shadow:0 2px 5px #000';
  stage.appendChild(timing);
  const controls = document.createElement('div');
  controls.style.cssText =
    'position:absolute;right:18px;bottom:14px;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end';
  const holyButton = document.createElement('button');
  const sunwardButton = document.createElement('button');
  const bastionButton = document.createElement('button');
  const dawnButton = document.createElement('button');
  const consecrationButton = document.createElement('button');
  for (const button of [holyButton, sunwardButton, bastionButton, dawnButton, consecrationButton]) {
    button.type = 'button';
    button.style.cssText =
      'min-height:40px;padding:10px 12px;border:1px solid #d9ae3b;border-radius:6px;background:#31250c;color:#ffe28a;font:600 14px system-ui;cursor:pointer';
    controls.appendChild(button);
  }
  holyButton.textContent = 'Solar Invocation (H)';
  sunwardButton.textContent = 'Sunward (S)';
  bastionButton.textContent = 'Bastion Sweep (B)';
  dawnButton.textContent = 'Dawnfall (D)';
  consecrationButton.textContent = 'Consecration (C)';
  stage.appendChild(controls);
  host.replaceChildren(stage);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x080c14);
  scene.fog = new THREE.Fog(0x080c14, 18, 30);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);

  scene.add(new THREE.HemisphereLight(0xfff2cf, 0x17213b, 2.2));
  const key = new THREE.DirectionalLight(0xffe2a0, 3.1);
  key.position.set(-5, 9, -4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x7ea6ff, 1.5);
  rim.position.set(6, 5, 7);
  scene.add(rim);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(13, 64),
    new THREE.MeshStandardMaterial({ color: 0x171b24, roughness: 0.94 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const paladin = new CharacterVisual(
    'player_paladin',
    0xffffff,
    0,
    null,
    null,
    'eastbrook_buckler',
  );
  const healTarget = new CharacterVisual('player_priest', 0xffffff);
  const damageTarget = new CharacterVisual('player_warrior', 0xffffff);
  const warrior = new CharacterVisual('player_warrior', 0xffffff);
  const actors: PreviewActor[] = [
    { id: 1, visual: paladin },
    { id: 2, visual: healTarget },
    { id: 3, visual: damageTarget },
    { id: 10, visual: warrior },
  ];
  for (let index = 0; index < 6; index++) {
    actors.push({ id: 20 + index, visual: new CharacterVisual('player_warrior', 0xffffff) });
  }
  for (const actor of actors) {
    actor.visual.update(0, PREVIEW_STATE, true);
    scene.add(actor.visual.root);
  }

  const radiusGuide = new THREE.Mesh(
    new THREE.RingGeometry(5.92, 6, 72),
    new THREE.MeshBasicMaterial({
      color: 0xb48a23,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  radiusGuide.rotation.x = -Math.PI / 2;
  radiusGuide.position.y = 0.025;
  scene.add(radiusGuide);
  const bastionArcGuide = new THREE.Mesh(
    new THREE.RingGeometry(0.25, 6, 64, 1, Math.PI, Math.PI),
    new THREE.MeshBasicMaterial({
      color: 0xf3c64f,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  bastionArcGuide.rotation.x = -Math.PI / 2;
  bastionArcGuide.position.y = 0.035;
  bastionArcGuide.visible = false;
  scene.add(bastionArcGuide);

  const vfx = new Vfx(scene, (id, heightFraction) => {
    const actor = actors.find((candidate) => candidate.id === id);
    if (!actor) return null;
    return actor.visual.root.position.clone().add(new THREE.Vector3(0, heightFraction * 2, 0));
  });
  vfx.setQuality(1);
  const consecrationFx = new PaladinConsecrationVisuals(scene, () => 0);

  let mode: PreviewMode = 'holy';
  let paused = false;
  let disposed = false;
  let lastFrame = performance.now();
  let nextReplay = lastFrame;
  let frameId = 0;
  let sunwardElapsed = 0;
  let sunwardHop = 0;
  let bastionElapsed = 0;
  let bastionImpactsEmitted = false;

  const positionCamera = (nextMode: PreviewMode): void => {
    const narrow = window.innerWidth / Math.max(1, window.innerHeight) < 0.75;
    if (nextMode === 'holy') {
      camera.position.set(narrow ? 6.2 : 4.4, narrow ? 7.2 : 5.1, narrow ? 15.8 : 10.5);
      camera.lookAt(0, 1.15, 0);
    } else if (nextMode === 'sunward') {
      camera.position.set(narrow ? 0.5 : 5.8, narrow ? 9.5 : 5.6, narrow ? 24 : 12.2);
      camera.lookAt(0.7, 1.1, 0);
    } else if (nextMode === 'bastion') {
      camera.position.set(narrow ? 6.8 : 8.8, narrow ? 10.8 : 7.2, narrow ? 16.5 : 13.8);
      camera.lookAt(0, 0.9, 1.3);
    } else if (nextMode === 'dawnfall') {
      camera.position.set(narrow ? 5 : 5.5, narrow ? 8.2 : 8.2, narrow ? 18.5 : 16);
      camera.lookAt(narrow ? 0 : 0.6, 1, 0);
    } else {
      camera.position.set(narrow ? 7.2 : 8.4, narrow ? 13.8 : 11.5, narrow ? 17.5 : 12.8);
      camera.lookAt(0, 0, 0);
    }
  };

  const placeHoly = (): void => {
    paladin.root.position.set(0, 0, 2.2);
    paladin.root.rotation.y = Math.PI;
    healTarget.root.position.set(-3.6, 0, -1.1);
    damageTarget.root.position.set(3.6, 0, -1.1);
    warrior.root.visible = false;
    radiusGuide.visible = false;
    bastionArcGuide.visible = false;
    for (const actor of actors.filter((candidate) => candidate.id >= 20))
      actor.visual.root.visible = false;
    healTarget.root.visible = true;
    damageTarget.root.visible = true;
    positionCamera('holy');
    title.textContent = 'Solar Invocation: aliado (suave)                 enemigo (juicio)';
    timing.textContent = `Conexión ${PALADIN_HOLY_SHOCK_LINK_TIME.toFixed(2)} s | impacto ${PALADIN_HOLY_SHOCK_IMPACT_TIME.toFixed(2)} s | duración ${PALADIN_HOLY_SHOCK_DURATION.toFixed(2)} s`;
  };

  const placeSunward = (): void => {
    paladin.root.position.set(-4.8, 0, 1.7);
    paladin.root.rotation.y = -Math.PI / 2.4;
    healTarget.root.position.set(-1.6, 0, -0.7);
    healTarget.root.rotation.y = Math.PI / 2;
    damageTarget.root.position.set(2, 0, 0.65);
    damageTarget.root.rotation.y = -Math.PI / 2;
    warrior.root.position.set(5, 0, -1.15);
    warrior.root.rotation.y = Math.PI / 2;
    healTarget.root.visible = true;
    damageTarget.root.visible = true;
    warrior.root.visible = true;
    radiusGuide.visible = false;
    bastionArcGuide.visible = false;
    for (const actor of actors.filter((candidate) => candidate.id >= 20))
      actor.visual.root.visible = false;
    positionCamera('sunward');
    title.textContent = 'Sunward: ward solar invocada · tres impactos';
    timing.textContent = 'Formación 0.04 s | cada rebote viaja desde el impacto anterior';
  };

  const placeBastion = (): void => {
    paladin.root.position.set(0, 0, -1);
    paladin.root.rotation.y = 0;
    healTarget.root.visible = false;
    damageTarget.root.visible = false;
    warrior.root.visible = false;
    radiusGuide.visible = false;
    bastionArcGuide.visible = true;
    bastionArcGuide.position.set(0, 0.035, -1);
    const dummies = actors.filter((candidate) => candidate.id >= 20);
    const angles = [-75, -36, 0, 36, 75, 145];
    for (let index = 0; index < dummies.length; index++) {
      const angle = THREE.MathUtils.degToRad(angles[index]);
      const distance = index === dummies.length - 1 ? 4 : 4.8;
      dummies[index].visual.root.visible = true;
      dummies[index].visual.root.position.set(
        Math.sin(angle) * distance,
        0,
        -1 + Math.cos(angle) * distance,
      );
      dummies[index].visual.root.rotation.y = angle + Math.PI;
    }
    positionCamera('bastion');
    title.textContent = 'Bastion Sweep: barrido frontal de escudo, sin knockback';
    timing.textContent = `Impacto ${PALADIN_BASTION_SWEEP_IMPACT_TIME.toFixed(2)} s | duración ${PALADIN_BASTION_SWEEP_DURATION.toFixed(2)} s | arco 180° | radio 6 m`;
  };

  const placeDawnfall = (): void => {
    const narrow = window.innerWidth / Math.max(1, window.innerHeight) < 0.75;
    paladin.root.position.set(narrow ? 0 : -3.8, 0, 0);
    paladin.root.rotation.y = 0;
    warrior.root.position.set(5.5, 0, 0);
    warrior.root.rotation.y = 0;
    warrior.root.visible = !narrow;
    healTarget.root.visible = false;
    damageTarget.root.visible = false;
    radiusGuide.visible = true;
    bastionArcGuide.visible = false;
    radiusGuide.position.x = paladin.root.position.x;
    const dummies = actors.filter((candidate) => candidate.id >= 20);
    for (let index = 0; index < dummies.length; index++) {
      const angle = (index / dummies.length) * Math.PI * 2;
      dummies[index].visual.root.visible = true;
      const dummyRadius = narrow ? 3.2 : 4.1;
      dummies[index].visual.root.position.set(
        paladin.root.position.x + Math.cos(angle) * dummyRadius,
        0,
        Math.sin(angle) * dummyRadius,
      );
      dummies[index].visual.root.rotation.y = angle + Math.PI;
    }
    positionCamera('dawnfall');
    title.textContent = narrow
      ? 'Dawnfall'
      : 'Dawnfall                                           giro del Warrior';
    timing.textContent = `Impacto visual ${PALADIN_DAWNFALL_IMPACT_TIME.toFixed(2)} s | animación normalizada ${PALADIN_DAWNFALL_IMPACT_NORMALIZED.toFixed(2)} | radio 6 m | duración ${PALADIN_DAWNFALL_DURATION.toFixed(2)} s`;
  };

  const placeConsecration = (): void => {
    paladin.root.position.set(0, 0, 0);
    paladin.root.rotation.y = Math.PI;
    healTarget.root.visible = false;
    damageTarget.root.visible = false;
    warrior.root.visible = false;
    radiusGuide.visible = true;
    bastionArcGuide.visible = false;
    radiusGuide.position.x = 0;
    const dummies = actors.filter((candidate) => candidate.id >= 20);
    for (let index = 0; index < dummies.length; index++) {
      const angle = (index / dummies.length) * Math.PI * 2;
      dummies[index].visual.root.visible = true;
      dummies[index].visual.root.position.set(Math.cos(angle) * 4.7, 0, Math.sin(angle) * 4.7);
      dummies[index].visual.root.rotation.y = angle + Math.PI;
    }
    positionCamera('consecration');
    title.textContent = 'Consecration: territorio santificado';
    timing.textContent = 'Sello solar por capas | pulso 1.10 s | radio real 6 m';
  };

  const startHoly = (): void => {
    mode = 'holy';
    placeHoly();
    consecrationFx.sync([]);
    vfx.clear();
    vfx.paladinHolyShock(1, 2, 'heal');
    vfx.paladinHolyShock(1, 3, 'damage');
  };

  const startSunward = (): void => {
    mode = 'sunward';
    placeSunward();
    consecrationFx.sync([]);
    vfx.clear();
    sunwardElapsed = 0;
    sunwardHop = 0;
    paladin.playAttack('sunward_disc');
    vfx.paladinSunwardDisc(1, 2, 0, 3);
  };

  const startBastion = (): void => {
    mode = 'bastion';
    placeBastion();
    consecrationFx.sync([]);
    vfx.clear();
    bastionElapsed = 0;
    bastionImpactsEmitted = false;
    paladin.playAttack('bastion_sweep');
    vfx.paladinBastionSweep(1, 6, 180, 0);
  };

  const startDawnfall = (): void => {
    mode = 'dawnfall';
    placeDawnfall();
    consecrationFx.sync([]);
    vfx.clear();
    paladin.playAttack('dawnfall');
    warrior.playAttack('whirlwind');
    vfx.paladinDawnfall(1, 6);
    for (const actor of actors.filter((candidate) => candidate.id >= 20)) {
      vfx.paladinDawnfallImpact(actor.id);
    }
  };

  const startConsecration = (): void => {
    mode = 'consecration';
    placeConsecration();
    vfx.clear();
    consecrationFx.sync([]);
    consecrationFx.sync([
      {
        id: 'preview-consecration',
        x: 0,
        z: 0,
        radius: 6,
        duration: 9,
        remaining: 9,
      },
    ]);
  };

  const stepPreview = (dt: number): void => {
    if (mode === 'sunward') {
      sunwardElapsed += dt;
      if (sunwardHop === 0 && sunwardElapsed >= 0.2) {
        sunwardHop = 1;
        vfx.paladinSunwardDisc(2, 3, 1, 3);
      }
      if (sunwardHop === 1 && sunwardElapsed >= 0.37) {
        sunwardHop = 2;
        vfx.paladinSunwardDisc(3, 10, 2, 3);
      }
    }
    if (mode === 'bastion') {
      bastionElapsed += dt;
      if (!bastionImpactsEmitted && bastionElapsed >= PALADIN_BASTION_SWEEP_IMPACT_TIME) {
        bastionImpactsEmitted = true;
        for (const actor of actors.filter((candidate) => candidate.id >= 20).slice(0, 5)) {
          vfx.paladinBastionSweepImpact(actor.id);
        }
      }
    }
    vfx.update(dt);
    consecrationFx.update(dt);
    for (const actor of actors) actor.visual.update(dt, PREVIEW_STATE, true);
  };

  const replayHoly = (): void => {
    paused = false;
    startHoly();
    nextReplay = performance.now() + 1_250;
  };
  const replaySunward = (): void => {
    paused = false;
    startSunward();
    nextReplay = performance.now() + 1_250;
  };
  const replayBastion = (): void => {
    paused = false;
    startBastion();
    nextReplay = performance.now() + 1_350;
  };
  const replayDawnfall = (): void => {
    paused = false;
    startDawnfall();
    nextReplay = performance.now() + 1_450;
  };
  const replayConsecration = (): void => {
    paused = false;
    startConsecration();
    nextReplay = performance.now() + 9_000;
  };
  const pauseAt = (nextMode: PreviewMode, seconds: number): void => {
    paused = true;
    if (nextMode === 'holy') startHoly();
    else if (nextMode === 'sunward') startSunward();
    else if (nextMode === 'bastion') startBastion();
    else if (nextMode === 'dawnfall') startDawnfall();
    else startConsecration();
    let remaining = Math.max(0, seconds);
    while (remaining > 0) {
      const step = Math.min(1 / 60, remaining);
      stepPreview(step);
      remaining -= step;
    }
    renderer.render(scene, camera);
  };

  const onResize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    positionCamera(mode);
    camera.updateProjectionMatrix();
    vfx.setViewportScale(window.innerHeight, camera.fov);
    const narrow = window.innerWidth / Math.max(1, window.innerHeight) < 0.75;
    timing.style.bottom = narrow ? '205px' : '18px';
    timing.style.fontSize = narrow ? '12px' : '16px';
    timing.style.right = narrow ? '18px' : 'auto';
    timing.style.textAlign = narrow ? 'center' : 'left';
    controls.style.left = narrow ? '12px' : 'auto';
    controls.style.right = narrow ? '12px' : '18px';
    controls.style.bottom = narrow ? '10px' : '14px';
    controls.style.justifyContent = narrow ? 'center' : 'flex-end';
    title.style.fontSize = narrow ? '13px' : '16px';
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'KeyH') replayHoly();
    else if (event.code === 'KeyS') replaySunward();
    else if (event.code === 'KeyB') replayBastion();
    else if (event.code === 'KeyD') replayDawnfall();
    else if (event.code === 'KeyC') replayConsecration();
  };
  holyButton.addEventListener('click', replayHoly);
  sunwardButton.addEventListener('click', replaySunward);
  bastionButton.addEventListener('click', replayBastion);
  dawnButton.addEventListener('click', replayDawnfall);
  consecrationButton.addEventListener('click', replayConsecration);
  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onKeyDown);
  onResize();

  const animate = (now: number): void => {
    if (disposed) return;
    const dt = Math.min(0.1, (now - lastFrame) / 1_000);
    lastFrame = now;
    if (!paused) {
      stepPreview(dt);
      if (now >= nextReplay) {
        if (mode === 'holy') replayHoly();
        else if (mode === 'sunward') replaySunward();
        else if (mode === 'bastion') replayBastion();
        else if (mode === 'dawnfall') replayDawnfall();
        else replayConsecration();
      }
    }
    renderer.render(scene, camera);
    frameId = requestAnimationFrame(animate);
  };
  frameId = requestAnimationFrame(animate);
  replayHoly();

  return {
    replayHoly,
    replaySunward,
    replayBastion,
    replayDawnfall,
    replayConsecration,
    pauseAt,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frameId);
      holyButton.removeEventListener('click', replayHoly);
      sunwardButton.removeEventListener('click', replaySunward);
      bastionButton.removeEventListener('click', replayBastion);
      dawnButton.removeEventListener('click', replayDawnfall);
      consecrationButton.removeEventListener('click', replayConsecration);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeyDown);
      vfx.clear();
      consecrationFx.dispose();
      for (const actor of actors) actor.visual.dispose();
      radiusGuide.geometry.dispose();
      (radiusGuide.material as THREE.Material).dispose();
      bastionArcGuide.geometry.dispose();
      (bastionArcGuide.material as THREE.Material).dispose();
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
      renderer.dispose();
      stage.remove();
    },
  };
}
