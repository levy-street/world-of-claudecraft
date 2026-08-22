import type * as THREE from 'three';
import { isSharedGeometry, isSharedMaterial } from './shared_resource';

export interface InteriorResourceDisposalReport {
  attempted: number;
  disposed: number;
  errors: unknown[];
}

export interface OwnedInteriorResource {
  dispose(): void;
}

/**
 * Resource ownership for one streamed interior root.
 *
 * The dungeon kit, tint cache, glow cache, and water shader are shared by all
 * roots. A root registry therefore contains only resources discovered on that
 * root whose shared-resource marker is absent. Set semantics make repeated
 * discovery harmless, and the disposal report lets a terminal caller remain
 * best-effort without hiding a failed release.
 */
export class OwnedInteriorResourceRegistry {
  private readonly resources = new Set<OwnedInteriorResource>();
  private readonly lateErrors: unknown[] = [];
  private retired = false;

  add<T extends OwnedInteriorResource>(resource: T): T {
    if (this.retired) {
      try {
        resource.dispose();
      } catch (error) {
        this.lateErrors.push(error);
      }
      return resource;
    }
    this.resources.add(resource);
    return resource;
  }

  dispose(): InteriorResourceDisposalReport {
    const errors = this.lateErrors.splice(0);
    if (this.retired) return { attempted: 0, disposed: 0, errors };
    this.retired = true;
    let disposed = 0;
    for (const resource of this.resources) {
      try {
        resource.dispose();
        disposed++;
      } catch (error) {
        errors.push(error);
      }
    }
    const attempted = this.resources.size;
    this.resources.clear();
    return { attempted, disposed, errors };
  }

  get size(): number {
    return this.resources.size;
  }

  get isRetired(): boolean {
    return this.retired;
  }
}

export function createOwnedInteriorResourceRegistry(): OwnedInteriorResourceRegistry {
  return new OwnedInteriorResourceRegistry();
}

export interface InteriorBuildScene {
  remove(object: THREE.Object3D): unknown;
}

export type InteriorBuildFailureReport = InteriorResourceDisposalReport;

/**
 * Run one streamed interior build as a transaction.
 *
 * Builders add partially-created meshes to the group before their later asset
 * or placement awaits can fail. The group is not necessarily in the scene yet,
 * but its children can still be retained by renderer-side light registries. On
 * failure, discover ownership from the partial root before disposing it, and
 * let the caller remove any non-resource registries. The original build error
 * always wins; individual disposal failures are returned to the callback.
 */
export async function runInteriorBuildTransaction<T extends THREE.Group>(
  scene: InteriorBuildScene,
  group: T,
  registry: OwnedInteriorResourceRegistry,
  build: () => Promise<T>,
  onFailure?: (group: T, report: InteriorBuildFailureReport) => void,
): Promise<T> {
  try {
    return await build();
  } catch (error) {
    scene.remove(group);
    // A streamed owner can retire the root while its compile gate is pending.
    // In that case disposeInteriorResources already collected and terminally
    // released the registry. Re-collecting here would call every resource's
    // dispose() a second time, and can release a shared GPU handle twice.
    let report: InteriorBuildFailureReport = { attempted: 0, disposed: 0, errors: [] };
    if (!registry.isRetired) {
      collectOwnedInteriorResources(group, registry);
      report = registry.dispose();
    }
    try {
      onFailure?.(group, report);
    } catch (cleanupError) {
      report.errors.push(cleanupError);
    }
    throw error;
  }
}

interface RenderableWithResources extends THREE.Object3D {
  dispose?(): void;
  geometry?: OwnedInteriorResource & { userData?: Record<string, unknown> };
  isInstancedMesh?: boolean;
  material?:
    | (OwnedInteriorResource & { userData?: Record<string, unknown> })
    | Array<OwnedInteriorResource & { userData?: Record<string, unknown> }>;
}

/** Collect non-shared resources reachable from one completed interior root. */
export function collectOwnedInteriorResources(
  root: THREE.Object3D,
  registry: OwnedInteriorResourceRegistry,
): void {
  root.traverse((object) => {
    const renderable = object as RenderableWithResources;
    if (renderable.isInstancedMesh === true && typeof renderable.dispose === 'function') {
      registry.add(renderable as OwnedInteriorResource);
    }
    const geometry = renderable.geometry;
    if (geometry && !isSharedGeometry(geometry as THREE.BufferGeometry)) registry.add(geometry);
    const materials = renderable.material
      ? Array.isArray(renderable.material)
        ? renderable.material
        : [renderable.material]
      : [];
    for (const material of materials) {
      if (!isSharedMaterial(material as THREE.Material)) registry.add(material);
    }
  });
}
