import { describe, expect, it } from 'vitest';
import { controllerDeviceStatusView } from '../src/ui/controller_options_view';

describe('controller options device status view', () => {
  it('selects the first connected device and preserves its hardware name', () => {
    expect(
      controllerDeviceStatusView([
        { connected: false, id: 'Dormant controller' },
        { connected: true, id: 'Wireless Gamepad (Vendor: 1234 Product: 5678)' },
        { connected: true, id: 'Second controller' },
      ]),
    ).toEqual({
      connected: true,
      name: 'Wireless Gamepad (Vendor: 1234 Product: 5678)',
    });
  });

  it('reports the empty and unnamed connected states without inventing a device', () => {
    expect(controllerDeviceStatusView([null, { connected: false, id: 'Offline' }])).toEqual({
      connected: false,
      name: null,
    });
    expect(controllerDeviceStatusView([{ connected: true, id: '   ' }])).toEqual({
      connected: true,
      name: null,
    });
  });
});
