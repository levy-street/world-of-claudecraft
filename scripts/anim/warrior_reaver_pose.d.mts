type Pose = Map<string, number[]>;
export function warriorReaverPerformance(
  idle: Pose,
  bladePose: (
    donor: number,
    time: number,
    hipOffset: number[],
    turn: number,
    lean: number,
    roll?: number,
  ) => Pose,
): [string, [number, Pose][]];
