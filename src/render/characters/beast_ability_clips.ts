import * as THREE from 'three';

const TIMES = [0, 0.07, 0.15, 0.21, 0.34, 0.49, 0.66];
const RAM = [0, -0.28, 0.42, 0.3, -0.08, -0.025, 0];
const PAW = [0, -0.55, 0.65, 0.28, -0.12, -0.03, 0];
const UTILITY_IDS = ['frenzied_regeneration', 'enrage', 'tigers_fury', 'prowl', 'dash', 'primal_reflexes', 'feral_charge'];
const BEAR_IDS = [
  ...UTILITY_IDS,
  'maul',
  'swipe',
  'marrowbreak',
  'bash',
  'growl',
  'demoralizing_roar',
  'challenging_roar',
  'skull_bash',
];
const IDS = [
  ...UTILITY_IDS,
  'claw',
  'rake',
  'rip',
  'ferocious_bite',
  'pounce',
  'redharvest',
  'skull_bash',
];

/** Rig-native poses sampled once at preparation. Feet/root stay planted;
 * only the live movement system translates a beast. No humanoid retargeting. */
export function prepareBeastAbilityClips(
  key: string,
  clips: Map<string, THREE.AnimationClip>,
): void {
  const wolf = key === 'form_cat';
  const bear = key === 'form_bear';
  if (
    !wolf &&
    !bear &&
    key !== 'player_druid' &&
    key !== 'player_druid_modular' &&
    key !== 'player_mech' &&
    key !== 'form_moonkin'
  )
    return;
  const idle = clips.get('Idle');
  if (!idle) return;
  for (const id of wolf ? IDS : bear ? BEAR_IDS : ['skull_bash']) {
    const utility = UTILITY_IDS.includes(id);
    const crouch = id === 'prowl' || id === 'dash' || id === 'primal_reflexes';
    const ram = id === 'skull_bash';
    const bite = id === 'ferocious_bite';
    const paired = id === 'redharvest' || id === 'rake' || id === 'pounce';
    const roar = id === 'growl' || id === 'demoralizing_roar' || id === 'challenging_roar';
    const source = bear && !ram && !roar && !utility ? (clips.get('Attack') ?? idle) : idle;
    const tracks = source.tracks.map((track) => {
      const out = track.clone(),
        sampler = track.createInterpolant(),
        values: number[] = [];
      const bone = track.name.slice(0, track.name.lastIndexOf('.'));
      for (let frame = 0; frame < TIMES.length; frame++) {
        const sample = sampler.evaluate(
          source !== idle && track.name.endsWith('.quaternion')
            ? source.duration * [0, 0.14, 0.46, 0.58, 0.73, 0.88, 1][frame]
            : 0,
        );
        if (track.name.endsWith('.quaternion')) {
          let angle = 0,
            roll = 0;
          if (bone === (wolf ? 'Head' : 'head'))
            angle = RAM[frame] * (ram ? 1.2 : bite ? 0.65 : 0.28);
          if (wolf && bone === 'Chin' && bite) angle = [0, 0.48, -0.08, -0.06, 0.1, 0.02, 0][frame];
          if (bone === (wolf ? 'Spine_4' : bear ? 'neck' : 'spine'))
            angle = RAM[frame] * (ram ? 0.6 : 0.2);
          if (ram) {
            if (bone === (wolf ? 'Head' : 'head')) angle = RAM[frame] * 1.55;
            if (bone === (wolf ? 'Spine_3' : bear ? 'spine_02' : 'chest'))
              angle = RAM[frame] * 0.85;
            if (bone === (wolf ? 'Hips' : 'hips')) angle = RAM[frame] * -0.3;
            if (wolf && bone.startsWith('Front_Leg_Upper_')) angle = RAM[frame] * -0.45;
            if (wolf && bone.startsWith('Front_Leg_Lower_')) angle = RAM[frame] * 0.65;
            if (bear && (bone === 'upperarmL' || bone === 'upperarmR')) angle = RAM[frame] * -0.4;
            if (bear && (bone === 'forearmL' || bone === 'forearmR')) angle = RAM[frame] * 0.6;
            if (!wolf && !bear && (bone === 'upperlegr' || bone === 'upperlegl'))
              angle = RAM[frame] * -0.45;
            if (!wolf && !bear && (bone === 'lowerlegr' || bone === 'lowerlegl'))
              angle = RAM[frame] * 0.7;
            if (!wolf && !bear && (bone === 'upperarmr' || bone === 'upperarml')) {
              angle = RAM[frame] * -0.4;
              roll = RAM[frame] * (bone.endsWith('r') ? 0.35 : -0.35);
            }
          }
          if (wolf && !ram && !bite && !utility && bone.startsWith('Front_Leg_Shoulder_')) {
            const left = bone.endsWith('_L');
            const paw =
              id === 'redharvest' && !left ? [0, 0, -0.4, -0.55, 0.7, 0.2, 0][frame] : PAW[frame];
            angle =
              paw *
              (id === 'rip'
                ? left
                  ? 0.2
                  : 1.2
                : id === 'pounce'
                  ? 0.7
                  : paired
                    ? 0.85
                    : left
                      ? 1
                      : 0.15);
            roll = PAW[frame] * (left ? -0.18 : 0.18);
          }
          if (bear && !ram) {
            if (roar) {
              const voice = [0, 0.18, 0.6, 0.55, 0.3, 0.08, 0][frame];
              if (bone === 'jaw') angle = voice;
              if (bone === 'neck' || bone === 'head') angle = -voice * 0.35;
              if (bone === 'spine_02') angle = -voice * 0.23;
            } else {
              const heavy = id === 'marrowbreak' ? 1.5 : id === 'maul' ? 1 : 0.6;
              if (bone === 'head') angle = RAM[frame] * heavy * 0.3;
              if (bone === 'spine_02') angle = RAM[frame] * heavy * 0.25;
              if (bone === 'shoulderL' || bone === 'shoulderR') {
                const left = bone.endsWith('L');
                roll = PAW[frame] * (left ? -1 : 1) * (id === 'swipe' ? 0.55 : 0.14);
                angle += PAW[frame] * (id === 'swipe' ? 0.2 : left ? 0.08 : 0.35) * heavy;
              }
            }
          }
          if (utility) {
            angle = 0;
            roll = 0;
            const pulse = [0, 0.16, 0.38, 0.32, 0.2, 0.08, 0][frame];
            if (bone === (wolf ? 'Head' : 'head')) angle = pulse * (crouch ? 0.4 : -0.7);
            if (bone === (wolf ? 'Chin' : 'jaw')) angle = crouch ? 0 : pulse * 0.9;
            if (bone === (wolf ? 'Spine_4' : 'spine_02')) angle = pulse * (crouch ? 0.18 : -0.35);
            if (wolf && bone.startsWith('Front_Leg_Upper_')) angle = pulse * -0.35;
            if (wolf && bone.startsWith('Front_Leg_Lower_')) angle = pulse * 0.5;
            if (bear && (bone === 'upperarmL' || bone === 'upperarmR')) angle = pulse * -0.25;
            if (bear && (bone === 'forearmL' || bone === 'forearmR')) angle = pulse * 0.4;
          }
          const q = new THREE.Quaternion()
            .fromArray(sample)
            .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(angle, 0, roll)))
            .normalize();
          values.push(q.x, q.y, q.z, q.w);
        } else {
          for (let i = 0; i < sample.length; i++) values.push(sample[i]);
        }
      }
      out.times = new Float32Array(TIMES);
      out.values = new Float32Array(values);
      return out;
    });
    clips.set(`Signature_${id}`, new THREE.AnimationClip(`Signature_${id}`, 0.66, tracks));
  }
}
