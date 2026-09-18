export interface ControllerDeviceSnapshot {
  connected: boolean;
  id: string;
}

export interface ControllerDeviceStatusView {
  connected: boolean;
  name: string | null;
}

export function controllerDeviceStatusView(
  devices: readonly (ControllerDeviceSnapshot | null)[],
): ControllerDeviceStatusView {
  const device = devices.find((candidate) => candidate?.connected);
  if (!device) return { connected: false, name: null };

  const name = device.id.trim();
  return { connected: true, name: name || null };
}
