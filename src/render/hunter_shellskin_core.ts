export interface ShellskinAura {
  id: string;
  kind: string;
  value: number;
  remaining?: number;
  duration?: number;
}

/** Borrow the mirrored aura; no timer, authority or allocation in presentation. */
export function shellskinAura(auras: readonly ShellskinAura[], dead = false): ShellskinAura | null {
  if (dead) return null;
  for (const aura of auras) {
    if (
      aura.id === 'shellskin' &&
      aura.kind === 'shield_wall' &&
      aura.value > 0 &&
      (aura.remaining === undefined || aura.remaining > 0)
    )
      return aura;
  }
  return null;
}

export function shellskinReveal(aura: ShellskinAura): number {
  // A held buff first seen after camera culling is already assembled.
  if (aura.duration === undefined || aura.remaining === undefined) return 1;
  const age = Math.max(0, aura.duration - aura.remaining);
  return 0.12 + 0.88 * (1 - (1 - Math.min(1, age / 0.22)) ** 3);
}

export interface ShellskinPlatePose {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  sx: number;
  sy: number;
  sz: number;
}
export const SHELLSKIN_PLATE_COUNT = 26;

/** Fitted back, breast, shoulder and forearm scutes in a 1.8-yard body frame. */
export function shellskinPlateInto(index: number, mobile: boolean, out: ShellskinPlatePose): void {
  out.rx = 0;
  out.ry = 0;
  out.rz = 0;
  out.sx = 0.3;
  out.sy = 0.34;
  out.sz = 0.4;
  if (index < 12) {
    const row = Math.floor(index / 3),
      column = (index % 3) - 1;
    out.x = column * 0.29;
    out.y = 0.7 + row * 0.255;
    out.z = -0.42 - (1 - Math.abs(column)) * 0.12;
    out.ry = Math.PI - column * 0.48;
    out.rx = (row - 1.5) * 0.13;
    out.rz = column * 0.1;
    out.sx = column === 0 ? 0.33 : 0.3;
  } else if (index < 18) {
    const row = Math.floor((index - 12) / 2),
      side = index % 2 ? 1 : -1;
    out.x = side * (mobile ? 0.22 : 0.155);
    out.y = 0.76 + row * 0.25;
    out.z = mobile ? 0.24 : 0.31;
    out.ry = side * (mobile ? 0.6 : 0.22);
    out.sx = mobile ? 0.25 : 0.31;
    out.sy = 0.31;
  } else if (index < 20) {
    const side = index === 18 ? -1 : 1;
    out.x = side * (mobile ? 0.51 : 0.47);
    out.y = 1.43;
    out.z = -0.015;
    out.rx = -0.65;
    out.ry = side * 0.7;
    out.rz = side * -0.3;
    out.sx = 0.37;
    out.sy = 0.32;
    out.sz = 0.6;
  } else {
    const side = index < 23 ? -1 : 1,
      row = (index - 20) % 3;
    out.x = side * 0.62;
    out.y = 1.13 - row * 0.13;
    out.z = 0.1;
    out.ry = side * 0.8;
    out.sx = 0.19;
    out.sy = 0.22;
    out.sz = 0.3;
  }
  // Native Hunters have a broad head and compact torso. Fit the shell to
  // chest/shoulder anatomy so defenses leave the face, hands and feet readable.
  out.x *= 0.74;
  out.y = 0.7 + (out.y - 1.2) * 0.55;
  out.z *= 0.72;
  out.sx *= 0.74;
  out.sy *= index >= 20 ? 0.7 : 0.55;
  out.sz *= 0.8;
}
