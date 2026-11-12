// Click proxies an effect lends to a body: invisible meshes, carrying the
// BODY's `userData.entityId`, that WorldPicking.pickDirect raycasts beside
// the views' own click capsules. A click on one is exactly a click on that
// body (the same pick resolution, the same interaction path, the same
// authoritative outcome); the proxy only widens where the body can be
// clicked. The Smith's Heart loot coffer is the first lender
// (smith_heart_fx/loot_coffer_fx.ts): a click on the coffer is a click on
// the corpse it stands beside.
//
// A module registry rather than a renderer field, so a hosted effect can
// lend one without the renderer coordinator growing a hook. A lender
// registers each proxy once, sets or clears its `userData.entityId` as its
// body comes and goes (a proxy with no id never resolves to anything), and
// removes it when it is disposed.

import type * as THREE from 'three';

const proxies: THREE.Object3D[] = [];

/** Lend `proxy` to picking (idempotent). */
export function addFxPickProxy(proxy: THREE.Object3D): void {
  if (!proxies.includes(proxy)) proxies.push(proxy);
}

/** Take `proxy` back (idempotent). */
export function removeFxPickProxy(proxy: THREE.Object3D): void {
  const i = proxies.indexOf(proxy);
  if (i >= 0) proxies.splice(i, 1);
}

/** The lent proxies (picking reads it; never mutate). */
export function fxPickProxies(): readonly THREE.Object3D[] {
  return proxies;
}
