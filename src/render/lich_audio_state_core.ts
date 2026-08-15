const FIRST_HEARTBEAT_DELAY = 2.4;
const HEARTBEAT_INTERVAL = 3.2;

export interface LichHeartbeatStep {
  nextAt: number;
  play: boolean;
}

export function stepLichHeartbeat(
  nextAt: number,
  time: number,
  active: boolean,
  audible: boolean,
): LichHeartbeatStep {
  if (!active) return { nextAt: 0, play: false };
  if (nextAt === 0) return { nextAt: time + FIRST_HEARTBEAT_DELAY, play: false };
  if (!audible || time < nextAt) return { nextAt, play: false };
  return { nextAt: time + HEARTBEAT_INTERVAL, play: true };
}
