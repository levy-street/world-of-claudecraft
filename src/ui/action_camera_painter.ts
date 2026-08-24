export interface ActionCameraPainter {
  setVisible(visible: boolean): void;
  dispose(): void;
}

/** Thin DOM painter for the optional action-camera crosshair. */
export function createActionCameraPainter(doc: Document = document): ActionCameraPainter {
  const element = doc.createElement('div');
  element.id = 'action-camera-crosshair';
  element.setAttribute('aria-hidden', 'true');
  element.hidden = true;
  doc.body.appendChild(element);
  return {
    setVisible(visible) {
      element.hidden = !visible;
    },
    dispose() {
      element.remove();
    },
  };
}
