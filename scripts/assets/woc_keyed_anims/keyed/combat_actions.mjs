// Combat-ready stances, hit flinch, battle shout, shield bash,
// special 1H/2H strikes, and spellcasting loops/releases (Woc_Combat_Idle_1H,
// Woc_Combat_Idle_2H, Woc_Combat_Idle_Dual, Woc_Hit, Woc_Shout,
// Woc_Shield_Bash, Woc_Special_1H, Woc_Special_2H, Woc_Cast_Directed,
// Woc_Cast_Omni, Woc_Cast_Shoot, Woc_Cast_Omni_Release, Woc_Channel_Directed),
// hand-keyed per fit on the shared combat footing so transitions between idle,
// auto-attacks, ability strikes, and spell casts keep planted feet and clean
// weapon/hand alignments. Beat keys: the README section "How the keys were
// made" covers how their values were chosen.
import { SWORD_FEET, SWORD_GUARD } from './attack1h.mjs';
import { beats } from './beat.mjs';

const R = (at, elbow) => ({ at, elbow });

function feetKeys(fit, duration) {
  const { lead, rear } = SWORD_FEET[fit];
  const rest =
    fit === 'female'
      ? {
          l: { pos: lead, pitch: 0, yaw: 10, knee: 6 },
          r: { pos: rear, pitch: 0, yaw: 30, knee: 8 },
        }
      : {
          l: { pos: lead, pitch: 0, yaw: 18, knee: 6 },
          r: { pos: rear, pitch: 0, yaw: 32, knee: 8 },
        };
  return [
    { t: 0, ease: 1, foot: rest },
    { t: duration, ease: 1, foot: rest },
  ];
}

// --- Combat ready stances ---------------------------------------------------

export const combatIdle1h = {
  clip(fit) {
    const duration = 2.0;
    const g = SWORD_GUARD[fit];
    const inhale =
      fit === 'female'
        ? {
            pelvis: { pos: [-0.02, 0.538, -0.035], rot: [6, -26, 0] },
            spine: [5, 6, -2],
            chest: [6, 7, -3],
            neck: [-6, 6, 1],
            head: [-9, 7, 1],
            clav: { l: [1.5, 0], r: [1.5, 0] },
            reach: {
              r: R([-0.25, 0.555, -0.07], [-0.4, -0.2, -1]),
              l: R([0.23, 0.565, 0.12], [0.6, -0.2, -1]),
            },
            forearm: { l: 25 },
            wrist: { l: [10, 0] },
            blade: { r: [-0.48, -0.15, 0.86] },
          }
        : {
            pelvis: { pos: [-0.03, 0.532, -0.05], rot: [8, -24, 0] },
            spine: [8, 7, -3],
            chest: [9, 8, -4],
            neck: [-10, 5, 2],
            head: [-14, 6, 2],
            clav: { l: [1.5, 0], r: [1.5, 0] },
            reach: {
              r: R([-0.31, 0.545, -0.07], [-0.4, -0.2, -1]),
              l: R([0.3, 0.54, 0.1], [0.6, -0.2, -1]),
            },
            forearm: { l: 25 },
            wrist: { l: [10, 0] },
            blade: { r: [-0.48, -0.17, 0.86] },
          };
    return {
      duration,
      loop: true,
      family: 'combat_idle',
      keys: [
        { t: 0, ...g },
        { t: 1.0, ease: 0.6, ...inhale },
        { t: duration, ...g },
        ...feetKeys(fit, duration),
      ],
      lag: { head: 0.06, neck: 0.04 },
    };
  },
};

const GUARD_2H = {
  male: {
    P: [0, 0.535, -0.04],
    r: [-7, -26, 0],
    T: [39, -9, 12],
    H: [3, 0],
    hR: [-0.22, 0.64, 0.2],
    eR: [-0.26, 0.65, -0.01],
    hL: [-0.18, 0.58, 0.2],
    eL: [0, 0.69, 0.22],
    blade: { r: [-0.51, 0.77, 0.39] },
    clav: { l: [0, 0], r: [0, 0] },
    forearm: { l: 40 },
    wrist: { l: [0, 0] },
  },
  female: {
    P: [0, 0.535, -0.035],
    r: [-6, -28, 0],
    T: [32, -9, 10],
    H: [4, 0],
    hR: [-0.19, 0.63, 0.18],
    eR: [-0.23, 0.65, -0.02],
    hL: [-0.15, 0.57, 0.18],
    eL: [0.02, 0.68, 0.2],
    blade: { r: [-0.51, 0.77, 0.39] },
    clav: { l: [0, 0], r: [0, 0] },
    forearm: { l: 40 },
    wrist: { l: [0, 0] },
  },
};

export const combatIdle2h = {
  clip(fit, model) {
    const duration = 2.0;
    const key = beats(model);
    const g = GUARD_2H[fit];
    const mid =
      fit === 'female'
        ? {
            ...g,
            P: [0, 0.538, -0.035],
            T: [29, -8, 10],
            H: [2, 0],
            hR: [-0.19, 0.645, 0.185],
            hL: [-0.15, 0.585, 0.185],
          }
        : {
            ...g,
            P: [0, 0.538, -0.04],
            T: [36, -8, 12],
            H: [1, 0],
            hR: [-0.22, 0.655, 0.205],
            hL: [-0.18, 0.595, 0.205],
          };
    const start = key(0, g);
    return {
      duration,
      loop: true,
      family: 'combat_idle',
      keys: [
        start,
        { ...key(1.0, mid), ease: 0.6 },
        { ...start, t: duration },
        ...feetKeys(fit, duration),
      ],
      lag: { head: 0.06, neck: 0.04 },
    };
  },
};

export const combatIdleDual = {
  clip(fit) {
    const duration = 2.0;
    const g = SWORD_GUARD[fit];
    const left0 =
      fit === 'female'
        ? {
            at: [0.24, 0.55, 0.12],
            elbowAt: [0.18, 0.7, 0.04],
            blade: [0.04, -0.16, 0.99],
          }
        : {
            at: [0.29, 0.54, 0.1],
            elbowAt: [0.21, 0.69, 0.03],
            blade: [0.04, -0.16, 0.99],
          };
    const leftMid =
      fit === 'female'
        ? {
            at: [0.245, 0.565, 0.125],
            elbowAt: [0.185, 0.71, 0.04],
            blade: [0.06, -0.14, 0.99],
          }
        : {
            at: [0.295, 0.555, 0.105],
            elbowAt: [0.215, 0.7, 0.03],
            blade: [0.06, -0.14, 0.99],
          };
    const basePose = {
      ...g,
      reach: { r: g.reach.r, l: { at: left0.at, elbowAt: left0.elbowAt } },
      blade: { r: g.blade.r, l: left0.blade },
    };
    const midPose =
      fit === 'female'
        ? {
            ...basePose,
            pelvis: { pos: [-0.02, 0.538, -0.035], rot: [6, -26, 0] },
            spine: [5, 6, -2],
            chest: [6, 7, -3],
            reach: {
              r: R([-0.25, 0.555, -0.07], [-0.4, -0.2, -1]),
              l: { at: leftMid.at, elbowAt: leftMid.elbowAt },
            },
            blade: { r: [-0.48, -0.15, 0.86], l: leftMid.blade },
          }
        : {
            ...basePose,
            pelvis: { pos: [-0.03, 0.532, -0.05], rot: [8, -24, 0] },
            spine: [8, 7, -3],
            chest: [9, 8, -4],
            reach: {
              r: R([-0.31, 0.545, -0.07], [-0.4, -0.2, -1]),
              l: { at: leftMid.at, elbowAt: leftMid.elbowAt },
            },
            blade: { r: [-0.48, -0.17, 0.86], l: leftMid.blade },
          };
    return {
      duration,
      loop: true,
      family: 'combat_idle',
      keys: [
        { t: 0, ...basePose },
        { t: 1.0, ease: 0.6, ...midPose },
        { t: duration, ...basePose },
        ...feetKeys(fit, duration),
      ],
      lag: { head: 0.06, neck: 0.04 },
    };
  },
};

// --- Hit flinch (CombatWound) -----------------------------------------------

export const hitWound = {
  clip(fit) {
    const duration = 0.58;
    const g = SWORD_GUARD[fit];
    const recoil =
      fit === 'female'
        ? {
            pelvis: { pos: [-0.015, 0.51, -0.045], rot: [-6, -48, 3] },
            spine: [-10, -16, 4],
            chest: [-14, -20, 6],
            neck: [-10, 14, -4],
            head: [-14, 18, -4],
            clav: { l: [6, 4], r: [6, -4] },
            reach: {
              r: R([-0.2, 0.6, -0.16], [-0.4, -0.2, -0.9]),
              l: R([0.1, 0.72, 0.24], [0.7, -0.5, -0.2]),
            },
            forearm: { l: 45, r: 10 },
            wrist: { l: [20, 0], r: [5, 0] },
          }
        : {
            pelvis: { pos: [-0.04, 0.5, -0.08], rot: [-2, -34, 3] },
            spine: [-8, -10, 4],
            chest: [-12, -14, 6],
            neck: [-18, 12, -3],
            head: [-22, 14, -3],
            clav: { l: [6, 4], r: [6, -4] },
            reach: {
              r: R([-0.3, 0.62, -0.08], [-0.5, -0.2, -0.8]),
              l: R([0.24, 0.66, 0.2], [0.6, -0.2, -0.8]),
            },
            forearm: { l: 35, r: 10 },
            wrist: { l: [15, 0], r: [5, 0] },
          };
    const settle =
      fit === 'female'
        ? {
            pelvis: { pos: [-0.01, 0.525, -0.03], rot: [-2, -44, 1] },
            spine: [-4, -10, 2],
            chest: [-6, -12, 3],
            neck: [-2, 18, -2],
            head: [-4, 22, -2],
            clav: { l: [2, 2], r: [2, -2] },
            reach: {
              r: R([-0.18, 0.56, -0.2], [-0.35, -0.1, -0.95]),
              l: R([0.02, 0.72, 0.22], [0.75, -0.55, -0.1]),
            },
            forearm: { l: 42, r: 5 },
            wrist: { l: [20, 0], r: [5, 0] },
          }
        : {
            pelvis: { pos: [-0.035, 0.515, -0.065], rot: [3, -30, 1] },
            spine: [2, -2, 0],
            chest: [2, -3, 0],
            neck: [-14, 8, 0],
            head: [-18, 10, 0],
            clav: { l: [2, 2], r: [2, -2] },
            reach: {
              r: R([-0.31, 0.58, -0.08], [-0.45, -0.2, -0.9]),
              l: R([0.27, 0.58, 0.14], [0.6, -0.2, -0.9]),
            },
            forearm: { l: 30, r: 5 },
            wrist: { l: [12, 0], r: [5, 0] },
          };
    return {
      duration,
      loop: false,
      family: 'hit',
      keys: [
        { t: 0, ...g },
        { t: 0.13, ease: 0.3, ...recoil },
        { t: 0.28, ease: 0.5, ...settle },
        { t: duration, ...g },
        ...feetKeys(fit, duration),
      ],
      lag: { head: 0.02, neck: 0.015 },
    };
  },
};

// --- Battle roar / shout (BattleRoar) ---------------------------------------

export const shoutRoar = {
  clip(fit) {
    const duration = 1.1;
    const g = SWORD_GUARD[fit];
    const coil =
      fit === 'female'
        ? {
            pelvis: { pos: [-0.005, 0.485, -0.01], rot: [10, -24, 0] },
            spine: [12, -2, 0],
            chest: [16, -2, 0],
            neck: [10, 8, 0],
            head: [14, 10, 0],
            clav: { l: [-2, 8], r: [-2, 8] },
            reach: {
              r: R([-0.18, 0.64, 0.22], [-0.5, -0.6, -0.4]),
              l: R([0.18, 0.64, 0.24], [0.5, -0.6, -0.4]),
            },
            forearm: { l: 45, r: 45 },
            wrist: { l: [15, 0], r: [15, 0] },
          }
        : {
            pelvis: { pos: [-0.02, 0.475, -0.03], rot: [14, -14, 0] },
            spine: [16, 2, 0],
            chest: [20, 2, 0],
            neck: [6, 4, 0],
            head: [10, 4, 0],
            clav: { l: [-2, 8], r: [-2, 8] },
            reach: {
              r: R([-0.2, 0.66, 0.24], [-0.5, -0.6, -0.4]),
              l: R([0.2, 0.66, 0.26], [0.5, -0.6, -0.4]),
            },
            forearm: { l: 45, r: 45 },
            wrist: { l: [15, 0], r: [15, 0] },
          };
    const roarPeak =
      fit === 'female'
        ? {
            pelvis: { pos: [0, 0.535, -0.01], rot: [-4, -14, 0] },
            spine: [-10, 0, 0],
            chest: [-14, 0, 0],
            neck: [-12, 4, 0],
            head: [-16, 4, 0],
            clav: { l: [8, -8], r: [8, -8] },
            reach: {
              r: R([-0.34, 0.66, -0.1], [-0.7, -0.4, -0.6]),
              l: R([0.34, 0.66, -0.06], [0.7, -0.4, -0.6]),
            },
            forearm: { l: 20, r: 20 },
            wrist: { l: [-10, 0], r: [-10, 0] },
          }
        : {
            pelvis: { pos: [-0.01, 0.53, -0.04], rot: [-2, -12, 0] },
            spine: [-10, 2, 0],
            chest: [-16, 2, 0],
            neck: [-14, 2, 0],
            head: [-20, 2, 0],
            clav: { l: [8, -8], r: [8, -8] },
            reach: {
              r: R([-0.38, 0.66, -0.1], [-0.7, -0.4, -0.6]),
              l: R([0.38, 0.66, -0.08], [0.7, -0.4, -0.6]),
            },
            forearm: { l: 20, r: 20 },
            wrist: { l: [-10, 0], r: [-10, 0] },
          };
    const roarHold = {
      ...roarPeak,
      spine: [roarPeak.spine[0] + 2, roarPeak.spine[1], 0],
      chest: [roarPeak.chest[0] + 2, roarPeak.chest[1], 0],
    };
    return {
      duration,
      loop: false,
      family: 'shout',
      keys: [
        { t: 0, ...g },
        { t: 0.2, ease: 0.4, ...coil },
        { t: 0.44, ease: 0.3, ...roarPeak },
        { t: 0.72, ease: 0.6, ...roarHold },
        { t: duration, ...g },
        ...feetKeys(fit, duration),
      ],
      lag: { head: 0.03, neck: 0.02 },
    };
  },
};

// --- Shield bash / offhand slam (ShieldBash) --------------------------------

export const shieldBash = {
  clip(fit) {
    const duration = 0.8;
    const g = SWORD_GUARD[fit];
    const coil =
      fit === 'female'
        ? {
            pelvis: { pos: [-0.01, 0.52, -0.03], rot: [4, -16, -2] },
            spine: [6, 20, -4],
            chest: [8, 26, -6],
            neck: [2, -10, 2],
            head: [4, -12, 2],
            clav: { l: [4, -6], r: [0, 4] },
            reach: {
              r: R([-0.24, 0.58, -0.08], [-0.4, -0.2, -0.9]),
              l: R([0.3, 0.72, -0.02], [0.8, -0.3, -0.5]),
            },
            forearm: { l: 35, r: 10 },
            wrist: { l: [15, 0], r: [5, 0] },
          }
        : {
            pelvis: { pos: [-0.03, 0.51, -0.06], rot: [8, -10, -2] },
            spine: [10, 22, -4],
            chest: [12, 28, -6],
            neck: [-8, -14, 2],
            head: [-10, -16, 2],
            clav: { l: [4, -6], r: [0, 4] },
            reach: {
              r: R([-0.28, 0.58, -0.04], [-0.4, -0.2, -0.9]),
              l: R([0.34, 0.7, -0.04], [0.8, -0.3, -0.5]),
            },
            forearm: { l: 30, r: 10 },
            wrist: { l: [12, 0], r: [5, 0] },
          };
    const slam =
      fit === 'female'
        ? {
            pelvis: { pos: [0.02, 0.49, 0.04], rot: [8, -48, 3] },
            spine: [12, -26, 6],
            chest: [16, -34, 8],
            neck: [-4, 24, -4],
            head: [-6, 28, -4],
            clav: { l: [6, 12], r: [-2, -6] },
            reach: {
              r: R([-0.16, 0.56, -0.18], [-0.2, -0.2, -1]),
              l: R([-0.06, 0.76, 0.42], [0.4, -0.4, 0.4]),
            },
            forearm: { l: 55, r: 15 },
            wrist: { l: [20, 0], r: [10, 0] },
          }
        : {
            pelvis: { pos: [0.01, 0.48, 0.03], rot: [12, -38, 3] },
            spine: [14, -26, 6],
            chest: [18, -36, 8],
            neck: [-12, 24, -4],
            head: [-14, 28, -4],
            clav: { l: [6, 12], r: [-2, -6] },
            reach: {
              r: R([-0.22, 0.56, -0.16], [-0.2, -0.2, -1]),
              l: R([-0.04, 0.76, 0.44], [0.4, -0.4, 0.4]),
            },
            forearm: { l: 50, r: 15 },
            wrist: { l: [18, 0], r: [10, 0] },
          };
    const follow = {
      ...slam,
      pelvis: {
        pos: [slam.pelvis.pos[0], slam.pelvis.pos[1] - 0.01, slam.pelvis.pos[2] + 0.01],
        rot: slam.pelvis.rot,
      },
      reach: {
        r: slam.reach.r,
        l: R(
          [slam.reach.l.at[0] - 0.03, slam.reach.l.at[1] - 0.02, slam.reach.l.at[2] - 0.02],
          [0.3, -0.4, 0.4],
        ),
      },
    };
    return {
      duration,
      loop: false,
      family: 'attack',
      keys: [
        { t: 0, ...g },
        { t: 0.16, ease: 0.4, ...coil },
        { t: 0.34, ease: -1, ...slam },
        { t: 0.46, ease: 0.5, ...follow },
        { t: duration, ...g },
        ...feetKeys(fit, duration),
      ],
      lag: { head: 0.02, neck: 0.015 },
    };
  },
};

// --- Special 1H & 2H power attacks (Special1H, Special2H) -------------------

export const special1h = {
  clip(fit) {
    const duration = 0.9;
    const g = SWORD_GUARD[fit];
    const windup =
      fit === 'female'
        ? {
            pelvis: { pos: [-0.02, 0.535, -0.03], rot: [-4, -52, -2] },
            spine: [-8, -18, -4],
            chest: [-12, -24, -6],
            neck: [6, 26, 2],
            head: [8, 30, 2],
            clav: { r: [12, -6], l: [2, 4] },
            reach: {
              r: R([-0.26, 0.98, -0.14], [-0.8, 0.2, -0.4]),
              l: R([0.14, 0.68, 0.28], [0.7, -0.4, 0.1]),
            },
            forearm: { l: 45 },
            wrist: { l: [15, 0] },
            blade: { r: [0.1, 0.78, -0.62] },
          }
        : {
            pelvis: { pos: [-0.04, 0.53, -0.06], rot: [-2, -38, -2] },
            spine: [-6, -18, -4],
            chest: [-10, -24, -6],
            neck: [2, 20, 2],
            head: [4, 24, 2],
            clav: { r: [12, -6], l: [2, 4] },
            reach: {
              r: R([-0.3, 1.02, -0.14], [-0.8, 0.2, -0.4]),
              l: R([0.22, 0.64, 0.26], [0.7, -0.4, 0.1]),
            },
            forearm: { l: 35 },
            wrist: { l: [12, 0] },
            blade: { r: [0.1, 0.78, -0.62] },
          };
    const strike =
      fit === 'female'
        ? {
            pelvis: { pos: [0.02, 0.45, 0.05], rot: [12, -8, 3] },
            spine: [16, 28, 8],
            chest: [22, 36, 10],
            neck: [-8, -22, -4],
            head: [-10, -26, -4],
            clav: { r: [2, 10], l: [-2, -6] },
            reach: {
              r: R([0.12, 0.52, 0.42], [-0.2, -0.8, 0.2]),
              l: R([0.24, 0.54, -0.14], [0.5, -0.3, -0.8]),
            },
            forearm: { l: 30 },
            wrist: { l: [10, 0] },
            blade: { r: [0.32, -0.28, 0.9] },
          }
        : {
            pelvis: { pos: [0.02, 0.44, 0.04], rot: [14, -6, 3] },
            spine: [18, 30, 8],
            chest: [24, 40, 10],
            neck: [-12, -24, -4],
            head: [-14, -28, -4],
            clav: { r: [2, 10], l: [-2, -6] },
            reach: {
              r: R([0.14, 0.5, 0.44], [-0.2, -0.8, 0.2]),
              l: R([0.28, 0.54, -0.16], [0.5, -0.3, -0.8]),
            },
            forearm: { l: 25 },
            wrist: { l: [10, 0] },
            blade: { r: [0.32, -0.28, 0.9] },
          };
    const follow = {
      ...strike,
      pelvis: {
        pos: [strike.pelvis.pos[0], strike.pelvis.pos[1] - 0.015, strike.pelvis.pos[2] - 0.01],
        rot: strike.pelvis.rot,
      },
      reach: {
        r: R([0.2, 0.42, 0.26], [0.1, -0.6, -0.6]),
        l: strike.reach.l,
      },
      blade: { r: [0.65, -0.35, 0.67] },
    };
    return {
      duration,
      loop: false,
      family: 'attack',
      keys: [
        { t: 0, ...g },
        { t: 0.22, ease: 0.4, ...windup },
        { t: 0.4, ease: -1, ...strike },
        { t: 0.54, ease: 0.5, ...follow },
        { t: duration, ...g },
        ...feetKeys(fit, duration),
      ],
      lag: { head: 0.025, neck: 0.015 },
    };
  },
};

export const special2h = {
  clip(fit, model) {
    const duration = 1.05;
    const key = beats(model);
    const g = GUARD_2H[fit];
    const start = key(0, g);
    const windup = key(0.26, {
      ...g,
      P: [0, 0.535, -0.03],
      r: [-4, -46, -2],
      T: [-12, -26, 8],
      H: [-4, -12],
      hR: [-0.18, 1.06, -0.06],
      eR: [-0.24, 0.9, -0.14],
      hL: [-0.1, 1.02, 0.08],
      eL: [0.06, 0.88, 0.12],
      blade: { r: [0.12, 0.72, -0.68] },
    });
    const smash = key(0.46, {
      ...g,
      P: [0.02, 0.42, 0.04],
      r: [-8, 8, -2],
      T: [46, 28, -14],
      H: [14, 10],
      hR: [0.12, 0.42, 0.32],
      eR: [-0.04, 0.56, 0.24],
      hL: [0.18, 0.42, 0.2],
      eL: [0.22, 0.58, 0.04],
      blade: { r: [0.36, -0.34, 0.87] },
    });
    const hold = key(0.62, {
      ...g,
      P: [0.02, 0.43, 0.02],
      r: [-8, 6, -2],
      T: [48, 32, -16],
      H: [16, 12],
      hR: [0.16, 0.38, 0.22],
      eR: [-0.02, 0.54, 0.18],
      hL: [0.2, 0.4, 0.1],
      eL: [0.22, 0.56, -0.02],
      blade: { r: [0.58, -0.4, 0.71] },
    });
    return {
      duration,
      loop: false,
      family: 'attack',
      grip: { hand: 'l' },
      keys: [
        start,
        { ...windup, ease: 0.4 },
        { ...smash, ease: -1 },
        { ...hold, ease: 0.5 },
        { ...start, t: duration },
        ...feetKeys(fit, duration),
      ],
      lag: { head: 0.025, neck: 0.015 },
    };
  },
};

// --- Spellcasting loops and releases ----------------------------------------

function castFocusBase(fit) {
  return fit === 'female'
    ? {
        pelvis: { pos: [-0.005, 0.53, -0.015], rot: [4, -24, 0] },
        spine: [6, 6, 0],
        chest: [8, 8, 0],
        neck: [-4, 10, 0],
        head: [-6, 12, 0],
        clav: { l: [2, 6], r: [2, 6] },
        reach: {
          r: R([-0.14, 0.78, 0.26], [-0.6, -0.6, -0.2]),
          l: R([0.14, 0.8, 0.28], [0.6, -0.6, -0.2]),
        },
        forearm: { l: 45, r: 45 },
        wrist: { l: [15, -5], r: [15, -5] },
      }
    : {
        pelvis: { pos: [-0.02, 0.525, -0.04], rot: [8, -18, 0] },
        spine: [10, 6, 0],
        chest: [12, 8, 0],
        neck: [-10, 6, 0],
        head: [-12, 8, 0],
        clav: { l: [2, 6], r: [2, 6] },
        reach: {
          r: R([-0.16, 0.78, 0.26], [-0.6, -0.6, -0.2]),
          l: R([0.16, 0.8, 0.28], [0.6, -0.6, -0.2]),
        },
        forearm: { l: 45, r: 45 },
        wrist: { l: [15, -5], r: [15, -5] },
      };
}

export const castDirected = {
  clip(fit) {
    const duration = 1.2;
    const base = castFocusBase(fit);
    const wide = {
      ...base,
      pelvis: {
        pos: [base.pelvis.pos[0], base.pelvis.pos[1] + 0.006, base.pelvis.pos[2] - 0.005],
        rot: base.pelvis.rot,
      },
      spine: [base.spine[0] - 3, base.spine[1] - 4, 0],
      chest: [base.chest[0] - 4, base.chest[1] - 6, 0],
      clav: { l: [5, 2], r: [5, 2] },
      reach: {
        r: R([-0.22, 0.84, 0.22], [-0.7, -0.5, -0.3]),
        l: R([0.22, 0.86, 0.24], [0.7, -0.5, -0.3]),
      },
      forearm: { l: 55, r: 55 },
      wrist: { l: [10, -8], r: [10, -8] },
    };
    const condense = {
      ...base,
      pelvis: {
        pos: [base.pelvis.pos[0], base.pelvis.pos[1] - 0.008, base.pelvis.pos[2] + 0.008],
        rot: base.pelvis.rot,
      },
      spine: [base.spine[0] + 3, base.spine[1] + 4, 0],
      chest: [base.chest[0] + 4, base.chest[1] + 6, 0],
      clav: { l: [1, 8], r: [1, 8] },
      reach: {
        r: R([-0.12, 0.74, 0.3], [-0.5, -0.7, -0.1]),
        l: R([0.12, 0.76, 0.32], [0.5, -0.7, -0.1]),
      },
      forearm: { l: 35, r: 35 },
      wrist: { l: [20, 0], r: [20, 0] },
    };
    return {
      duration,
      loop: true,
      family: 'cast',
      keys: [
        { t: 0, ...base },
        { t: 0.4, ease: 0.5, ...wide },
        { t: 0.8, ease: 0.5, ...condense },
        { t: duration, ...base },
        ...feetKeys(fit, duration),
      ],
      lag: { head: 0.05, neck: 0.03 },
    };
  },
};

export const castOmni = {
  clip(fit) {
    const duration = 1.2;
    const low =
      fit === 'female'
        ? {
            pelvis: { pos: [-0.005, 0.53, -0.015], rot: [-2, -20, 0] },
            spine: [-4, 6, 0],
            chest: [-5, 10, 0],
            neck: [-6, 8, 0],
            head: [-10, 10, 0],
            clav: { l: [6, -2], r: [6, -2] },
            reach: {
              r: R([-0.27, 0.92, 0.16], [-0.7, -0.5, -0.2]),
              l: R([0.27, 0.92, 0.18], [0.7, -0.5, -0.2]),
            },
            forearm: { l: 65, r: 65 },
            wrist: { l: [10, 0], r: [10, 0] },
          }
        : {
            pelvis: { pos: [-0.02, 0.528, -0.035], rot: [2, -16, 0] },
            spine: [-4, 6, 0],
            chest: [-8, 6, 0],
            neck: [-10, 6, 0],
            head: [-14, 8, 0],
            clav: { l: [6, -2], r: [6, -2] },
            reach: {
              r: R([-0.32, 0.93, 0.16], [-0.7, -0.5, -0.2]),
              l: R([0.32, 0.93, 0.18], [0.7, -0.5, -0.2]),
            },
            forearm: { l: 65, r: 65 },
            wrist: { l: [10, 0], r: [10, 0] },
          };
    const high = {
      ...low,
      pelvis: {
        pos: [low.pelvis.pos[0], low.pelvis.pos[1] + 0.006, low.pelvis.pos[2]],
        rot: low.pelvis.rot,
      },
      spine: [low.spine[0] - 3, low.spine[1], 0],
      chest: [low.chest[0] - 4, low.chest[1], 0],
      neck: [low.neck[0] - 3, low.neck[1], 0],
      head: [low.head[0] - 4, low.head[1], 0],
      clav: { l: [10, -4], r: [10, -4] },
      reach: {
        r: R(
          [low.reach.r.at[0] + 0.03, low.reach.r.at[1] + 0.08, low.reach.r.at[2] + 0.02],
          [-0.6, -0.4, -0.2],
        ),
        l: R(
          [low.reach.l.at[0] - 0.03, low.reach.l.at[1] + 0.08, low.reach.l.at[2] + 0.02],
          [0.6, -0.4, -0.2],
        ),
      },
    };
    return {
      duration,
      loop: true,
      family: 'cast',
      keys: [
        { t: 0, ...low },
        { t: 0.6, ease: 0.6, ...high },
        { t: duration, ...low },
        ...feetKeys(fit, duration),
      ],
      lag: { head: 0.05, neck: 0.03 },
    };
  },
};

export const castShoot = {
  clip(fit) {
    const duration = 0.8;
    const base = castFocusBase(fit);
    const coil = {
      ...base,
      pelvis: {
        pos: [base.pelvis.pos[0] - 0.01, base.pelvis.pos[1] - 0.015, base.pelvis.pos[2] - 0.02],
        rot: [base.pelvis.rot[0] - 2, base.pelvis.rot[1] - 12, 0],
      },
      spine: [base.spine[0] - 6, base.spine[1] - 16, -3],
      chest: [base.chest[0] - 8, base.chest[1] - 20, -4],
      neck: [base.neck[0] + 4, base.neck[1] + 18, 2],
      head: [base.head[0] + 4, base.head[1] + 22, 2],
      clav: { l: [2, 4], r: [6, -6] },
      reach: {
        r: R([-0.26, 0.82, 0.08], [-0.8, -0.4, -0.5]),
        l: R([0.22, 0.76, 0.28], [0.7, -0.5, 0.3]),
      },
      forearm: { l: 40, r: 50 },
      wrist: { l: [10, 0], r: [10, 0] },
    };
    const release = {
      ...base,
      pelvis: {
        pos: [base.pelvis.pos[0] + 0.015, base.pelvis.pos[1] - 0.02, base.pelvis.pos[2] + 0.035],
        rot: [base.pelvis.rot[0] + 4, base.pelvis.rot[1] + 10, 0],
      },
      spine: [base.spine[0] + 6, base.spine[1] + 14, 2],
      chest: [base.chest[0] + 8, base.chest[1] + 18, 4],
      neck: [base.neck[0] - 4, base.neck[1] - 14, -2],
      head: [base.head[0] - 6, base.head[1] - 16, -2],
      clav: { l: [2, 10], r: [2, 12] },
      reach: {
        r: R([-0.12, 0.8, 0.38], [-0.4, -0.6, 0.2]),
        l: R([0.15, 0.78, 0.36], [0.5, -0.6, 0]),
      },
      forearm: { l: 10, r: 10 },
      wrist: { l: [-25, 0], r: [-25, 0] },
    };
    const hold = {
      ...release,
      reach: {
        r: R([-0.13, 0.79, 0.36], [-0.4, -0.6, 0.2]),
        l: R([0.16, 0.77, 0.34], [0.5, -0.6, 0]),
      },
    };
    return {
      duration,
      loop: false,
      family: 'cast',
      keys: [
        { t: 0, ...base },
        { t: 0.15, ease: 0.4, ...coil },
        { t: 0.34, ease: -1, ...release },
        { t: 0.48, ease: 0.5, ...hold },
        { t: duration, ...base },
        ...feetKeys(fit, duration),
      ],
      lag: { head: 0.02, neck: 0.015 },
    };
  },
};

export const castOmniRelease = {
  clip(fit) {
    const duration = 0.85;
    const base = castFocusBase(fit);
    const gather = {
      ...base,
      pelvis: {
        pos: [base.pelvis.pos[0], base.pelvis.pos[1] - 0.025, base.pelvis.pos[2]],
        rot: base.pelvis.rot,
      },
      spine: [base.spine[0] + 6, base.spine[1], 0],
      chest: [base.chest[0] + 8, base.chest[1], 0],
      reach: {
        r: R([-0.14, 0.7, 0.22], [-0.5, -0.7, -0.2]),
        l: R([0.14, 0.7, 0.24], [0.5, -0.7, -0.2]),
      },
      forearm: { l: 55, r: 55 },
      wrist: { l: [20, 0], r: [20, 0] },
    };
    const sky =
      fit === 'female'
        ? {
            pelvis: { pos: [-0.005, 0.532, -0.01], rot: [-4, -18, 0] },
            spine: [-10, 6, 0],
            chest: [-14, 8, 0],
            neck: [-10, 6, 0],
            head: [-16, 8, 0],
            clav: { l: [12, -4], r: [12, -4] },
            reach: {
              r: R([-0.28, 1.06, 0.14], [-0.6, -0.3, -0.2]),
              l: R([0.28, 1.06, 0.16], [0.6, -0.3, -0.2]),
            },
            forearm: { l: 60, r: 60 },
            wrist: { l: [-10, 0], r: [-10, 0] },
          }
        : {
            pelvis: { pos: [-0.02, 0.528, -0.035], rot: [0, -14, 0] },
            spine: [-10, 6, 0],
            chest: [-14, 6, 0],
            neck: [-14, 4, 0],
            head: [-20, 6, 0],
            clav: { l: [12, -4], r: [12, -4] },
            reach: {
              r: R([-0.3, 1.08, 0.14], [-0.6, -0.3, -0.2]),
              l: R([0.3, 1.08, 0.16], [0.6, -0.3, -0.2]),
            },
            forearm: { l: 60, r: 60 },
            wrist: { l: [-10, 0], r: [-10, 0] },
          };
    const hold = {
      ...sky,
      reach: {
        r: R(
          [sky.reach.r.at[0] - 0.02, sky.reach.r.at[1] - 0.02, sky.reach.r.at[2]],
          [-0.6, -0.3, -0.2],
        ),
        l: R(
          [sky.reach.l.at[0] + 0.02, sky.reach.l.at[1] - 0.02, sky.reach.l.at[2]],
          [0.6, -0.3, -0.2],
        ),
      },
    };
    return {
      duration,
      loop: false,
      family: 'cast',
      keys: [
        { t: 0, ...base },
        { t: 0.16, ease: 0.4, ...gather },
        { t: 0.38, ease: 0.3, ...sky },
        { t: 0.54, ease: 0.6, ...hold },
        { t: duration, ...base },
        ...feetKeys(fit, duration),
      ],
      lag: { head: 0.03, neck: 0.02 },
    };
  },
};

export const channelDirected = {
  clip(fit) {
    const duration = 1.0;
    const base = castFocusBase(fit);
    const beam = {
      ...base,
      spine: [base.spine[0] + 4, base.spine[1] + 6, 0],
      chest: [base.chest[0] + 6, base.chest[1] + 8, 0],
      clav: { l: [3, 10], r: [3, 10] },
      reach: {
        r: R([-0.13, 0.8, 0.36], [-0.5, -0.6, 0.1]),
        l: R([0.13, 0.81, 0.37], [0.5, -0.6, 0.1]),
      },
      forearm: { l: 15, r: 15 },
      wrist: { l: [-20, 0], r: [-20, 0] },
    };
    const pulse = {
      ...beam,
      pelvis: {
        pos: [beam.pelvis.pos[0], beam.pelvis.pos[1] - 0.008, beam.pelvis.pos[2] - 0.01],
        rot: beam.pelvis.rot,
      },
      spine: [beam.spine[0] - 2, beam.spine[1], 0],
      chest: [beam.chest[0] - 3, beam.chest[1], 0],
      reach: {
        r: R([-0.15, 0.78, 0.32], [-0.5, -0.6, 0.1]),
        l: R([0.15, 0.79, 0.33], [0.5, -0.6, 0.1]),
      },
    };
    return {
      duration,
      loop: true,
      family: 'cast',
      keys: [
        { t: 0, ...beam },
        { t: 0.5, ease: 0.6, ...pulse },
        { t: duration, ...beam },
        ...feetKeys(fit, duration),
      ],
      lag: { head: 0.04, neck: 0.025 },
    };
  },
};
