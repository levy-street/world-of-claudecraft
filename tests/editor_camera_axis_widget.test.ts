import { describe, expect, it } from 'vitest';
import { dominantCameraPlane, projectCameraAxes } from '../src/editor/3d/camera_axis_widget';

describe('editor camera axis widget projection', () => {
  it('projects opposite world axes to opposite screen positions', () => {
    const axes = projectCameraAxes(0.7, 0.4, 31);
    const positiveX = axes.find((entry) => entry.axis === 'positiveX');
    const negativeX = axes.find((entry) => entry.axis === 'negativeX');

    expect(positiveX).toBeDefined();
    expect(negativeX).toBeDefined();
    expect(positiveX?.x).toBeCloseTo(-(negativeX?.x ?? 0), 6);
    expect(positiveX?.y).toBeCloseTo(-(negativeX?.y ?? 0), 6);
    expect(positiveX?.depth).toBeCloseTo(-(negativeX?.depth ?? 0), 6);
  });

  it('moves the projected handles when the camera rotates', () => {
    const before = projectCameraAxes(0, 0, 31).find((entry) => entry.axis === 'positiveX');
    const after = projectCameraAxes(Math.PI / 2, 0, 31).find((entry) => entry.axis === 'positiveX');

    expect(Math.abs(before?.x ?? 0)).toBeGreaterThan(30);
    expect(Math.abs(after?.x ?? 0)).toBeLessThan(0.001);
    expect(after?.depth).toBeLessThan(-0.99);
  });

  it('brings the positive Y handle toward the viewer in a top view', () => {
    const positiveY = projectCameraAxes(0, 1.52, 31).find((entry) => entry.axis === 'positiveY');

    expect(positiveY?.projectedLength).toBeLessThan(0.06);
    expect(positiveY?.depth).toBeGreaterThan(0.99);
    expect(positiveY?.scale).toBeGreaterThan(1);
  });

  it('matches the accent plane to the signed axis facing the camera', () => {
    const positiveX = dominantCameraPlane(projectCameraAxes(-Math.PI / 2, 0, 31));
    const negativeZ = dominantCameraPlane(projectCameraAxes(0, 0, 31));
    const positiveY = dominantCameraPlane(projectCameraAxes(0, 1.52, 31));

    expect(positiveX).toEqual({ axis: 'positiveX', plane: 'x' });
    expect(negativeZ).toEqual({ axis: 'negativeZ', plane: 'z' });
    expect(positiveY).toEqual({ axis: 'positiveY', plane: 'y' });
  });
});
