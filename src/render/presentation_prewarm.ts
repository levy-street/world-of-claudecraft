// Minimal post-processing warm path. Hiding the scene root makes the
// composer's scene pass clear-only while its fullscreen presentation passes
// still allocate their targets and link their exact live shaders.

export interface PresentationPrewarmScene {
  visible: boolean;
}

export function withSceneHiddenForPresentationPrewarm<T>(
  scene: PresentationPrewarmScene,
  render: () => T,
): T {
  const visible = scene.visible;
  scene.visible = false;
  try {
    return render();
  } finally {
    scene.visible = visible;
  }
}
