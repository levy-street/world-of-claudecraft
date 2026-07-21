// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountWelcomeStage, type WelcomeStagePreview } from '../src/ui/welcome_screen_stage';

function fakePreview() {
  return {
    setContainer: vi.fn((_el: HTMLElement) => {}),
    syncSize: vi.fn(() => {}),
  } satisfies WelcomeStagePreview;
}

describe('mountWelcomeStage', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });

  it('re-parents the live preview into the stage and syncs its size across frames', () => {
    // Arrange
    const container = document.createElement('div');
    const preview = fakePreview();

    // Act
    const handle = mountWelcomeStage(
      container,
      () => preview,
      () => true,
    );

    // Assert: container handed to the preview, sized now plus the two
    // post-layout frames (the syncPreviewAfterPanelLayout mirror).
    expect(handle).not.toBeNull();
    expect(preview.setContainer).toHaveBeenCalledWith(container);
    expect(preview.syncSize).toHaveBeenCalledTimes(2);
  });

  it('returns null when the desktop-stage gate is false (mobile keeps no stage)', () => {
    const preview = fakePreview();
    expect(
      mountWelcomeStage(
        document.createElement('div'),
        () => preview,
        () => false,
      ),
    ).toBeNull();
    expect(preview.setContainer).not.toHaveBeenCalled();
  });

  it('returns null when no live preview exists (WebGL failed or assets warming)', () => {
    expect(
      mountWelcomeStage(
        document.createElement('div'),
        () => null,
        () => true,
      ),
    ).toBeNull();
  });

  it('fails soft when the preview throws: null out, no escaping exception', () => {
    const preview = fakePreview();
    preview.setContainer.mockImplementation(() => {
      throw new Error('context lost');
    });
    expect(
      mountWelcomeStage(
        document.createElement('div'),
        () => preview,
        () => true,
      ),
    ).toBeNull();
  });
});
