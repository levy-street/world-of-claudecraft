type Pose = Map<string, number[]>;
export function warriorControlPerformances(
  idle: Pose,
  bladePose: (
    donor: number,
    time: number,
    hipOffset: number[],
    turn: number,
    lean: number,
    roll?: number,
  ) => Pose,
  openArms: (pose: Pose, weight: number, targets: number[][]) => Pose,
): [string, [number, Pose][]][];
