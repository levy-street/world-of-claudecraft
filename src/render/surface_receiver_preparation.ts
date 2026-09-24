import type * as THREE from 'three';
import type { CharacterVisual, FarBakeGate } from './characters/visual';
import { compileTargetPrepared } from './compile_target_readiness';

interface ReceiverView {
  compileReady: Promise<void> | null;
  surfaceCompilePending?: boolean;
}
interface Host {
  webgl: { properties: Parameters<typeof compileTargetPrepared>[0] };
  farBakeGate: FarBakeGate;
  gateSwapFlagOnCompile(target: THREE.Object3D, settled: () => void): void;
}

/** A live body replacement keeps its outgoing rig until the new contact
 * variants and ordinary materials have both passed the existing reveal gate. */
export function gateSurfaceReplacement(
  host: object,
  view: { visualCompilePending: boolean; group: THREE.Group },
  next: CharacterVisual,
  outgoing: CharacterVisual,
): void {
  const surface = stageSurfaceReceiver(host, next);
  view.visualCompilePending = true;
  (host as Host).gateSwapFlagOnCompile(next.root, () => {
    surface();
    view.visualCompilePending = false;
    view.group.remove(outgoing.root);
    outgoing.dispose();
  });
}

/** A lazy form owns one existing reveal gate; metamorph's visible body instead
 * prepares only its cosmetic contact variant on the paced background lane. */
export function gateSurfaceForm(
  host: object,
  visual: CharacterVisual,
  view: { formCompilePending: THREE.Object3D | null },
  gateCompile: boolean,
): void {
  const settle = stageSurfaceReceiver(host, visual, gateCompile);
  if (!gateCompile) return;
  view.formCompilePending = visual.root;
  (host as Host).gateSwapFlagOnCompile(visual.root, () => {
    settle();
    if (view.formCompilePending === visual.root) view.formCompilePending = null;
  });
}

/** Add hidden surface twins BEFORE the existing view/form compile collector.
 * The returned callback settles them AFTER that gate. An ungated body instead
 * uses the same paced background lane, without hiding its normal materials. */
export function stageSurfaceReceiver(
  host: object,
  visual: CharacterVisual | null | undefined,
  owner: ReceiverView | boolean = true,
): () => void {
  const ticket = visual?.stageSurfaceResponsePreparation();
  if (!ticket) return () => undefined;
  const h = host as Host;
  const view = typeof owner === 'object' ? owner : null;
  const settle = (prepared?: boolean) => {
    ticket.settle(prepared);
    if (view) view.surfaceCompilePending = false;
  };
  if (view) view.surfaceCompilePending = true;
  if (owner === false) {
    h.farBakeGate(ticket.root, (ready) => settle(ready?.() ?? false));
    return () => undefined;
  }
  return () => {
    if (!view) settle(compileTargetPrepared(h.webgl.properties, ticket.root));
    else if (view.compileReady) {
      view.compileReady = view.compileReady.then(
        () => settle(compileTargetPrepared(h.webgl.properties, ticket.root)),
        (error) => {
          settle(false);
          throw error;
        },
      );
    } else h.farBakeGate(ticket.root, (ready) => settle(ready?.() ?? false));
  };
}
