import * as THREE from 'three';
import {
  CONTROL_COLORS,
  CONTROL_SLOT_COUNT,
  type ControlState,
  type ControlSubject,
  createControlState,
  resolveControlStateInto,
} from './combat_status_core';
import type { VfxAnchorResolver } from './vfx_anchor';

interface HeldControl {
  state: ControlState;
  stamp: number;
  drawn: boolean;
}

/** Essential combat information has its own batch. Its capacity follows the
 * live actor set, never a cosmetic quality setting or particle admission rank.
 * Growth is geometric, only on a new high-water mark; frames reuse all storage. */
export class CombatStatusSignals {
  private readonly held = new Map<number, HeldControl>();
  private readonly anchorScratch = new THREE.Vector3();
  private readonly colorScratch = new THREE.Color();
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private geometry!: THREE.InstancedBufferGeometry;
  private centers!: THREE.InstancedBufferAttribute;
  private colors!: THREE.InstancedBufferAttribute;
  private data!: THREE.InstancedBufferAttribute;
  private capacity = 0;
  private frame = 0;
  private count = 0;

  constructor(scene: THREE.Scene) {
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      uniforms: { uViewport: { value: 900 } },
      vertexShader: `
        attribute vec3 aCenter;
        attribute vec3 aColor;
        attribute vec4 aData;
        uniform float uViewport;
        varying vec2 vUv;
        varying vec3 vColor;
        varying vec2 vData;
        void main() {
          vUv = uv * 2.0 - 1.0;
          vColor = aColor;
          vData = aData.xy;
          vec4 center = modelViewMatrix * vec4(aCenter, 1.0);
          float distanceScale = max(1.0, -center.z);
          // A 25 CSS-pixel quad leaves a 22-pixel painted disc after padding.
          float worldSize = max(0.43, 50.0 * distanceScale / (max(1.0, uViewport) * projectionMatrix[1][1]));
          center.xy += (position.xy + aData.zw) * worldSize;
          gl_Position = projectionMatrix * center;
        }`,
      fragmentShader: `
        varying vec2 vUv;
        varying vec3 vColor;
        varying vec2 vData;
        float line(vec2 p, vec2 a, vec2 b) {
          vec2 pa = p-a, ba = b-a;
          return length(pa-ba*clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0));
        }
        float glyph(vec2 p, float kind) {
          float d = 1.0;
          if (kind < 0.5) {
            float a = atan(p.y,p.x);
            d = abs(length(p) - (0.34 + 0.14*cos(a*5.0)))-0.07;
          } else if (kind < 1.5) {
            d = abs(length(p*vec2(1.0,0.8))-0.35)-0.08;
            d = min(d,min(length(p-vec2(-0.15,0.04)),length(p-vec2(0.15,0.04)))-0.075);
            d = min(d,line(p,vec2(-0.15,-0.23),vec2(0.15,-0.23))-0.055);
          } else if (kind < 2.5) {
            d = line(p,vec2(0.0,0.43),vec2(0.0,-0.43))-0.065;
            d = min(d,line(p,vec2(0.0,-0.04),vec2(-0.35,-0.34))-0.055);
            d = min(d,line(p,vec2(0.0,0.14),vec2(0.33,-0.11))-0.055);
          } else if (kind < 3.5) {
            d = max(length(p)-0.44,-(length(p-vec2(0.22,0.15))-0.39));
          } else if (kind < 4.5) {
            d = abs(length(p)-0.37)-0.06;
            d = min(d,line(p,vec2(-0.37,-0.37),vec2(0.37,0.37))-0.07);
          } else if (kind < 5.5) {
            d = min(line(p,vec2(-0.3,0.4),vec2(0.3,-0.4)),line(p,vec2(0.3,0.4),vec2(-0.3,-0.4)))-0.055;
            d = min(d,min(line(p,vec2(-0.3,0.4),vec2(0.3,0.4)),line(p,vec2(-0.3,-0.4),vec2(0.3,-0.4)))-0.055);
          } else if (kind < 6.5) {
            d = abs(length(p)-0.3)-0.07;
            d = min(d,min(length(p-vec2(-0.31,0.29)),length(p-vec2(0.31,0.29)))-0.12);
          } else if (kind < 7.5) {
            d = min(line(p,vec2(-0.25,-0.38),vec2(0.02,-0.02)),line(p,vec2(0.12,0.12),vec2(0.34,0.43)))-0.07;
            d = min(d,line(p,vec2(-0.34,-0.18),vec2(-0.08,-0.39))-0.06);
          } else if (kind < 8.5) {
            d = min(line(p,vec2(-0.28,0.3),vec2(0.0,0.03)),line(p,vec2(0.0,0.03),vec2(0.28,0.3)))-0.055;
            d = min(d,min(line(p,vec2(-0.28,-0.05),vec2(0.0,-0.32)),line(p,vec2(0.0,-0.32),vec2(0.28,-0.05)))-0.055);
          } else if (kind < 9.5) {
            d = abs(abs(p.x)*0.85+abs(p.y)-0.43)-0.065;
            d = min(d,abs(p.x)-0.045);
          } else {
            d = max(abs(p.x)-0.3,abs(p.y+0.14)-0.23);
            d = min(d,max(abs(length(p-vec2(0.0,0.14))-0.22)-0.055,-p.y));
            // School index encoded as radial notches, readable without colour.
            float a = atan(p.y,p.x);
            float ticks = step(0.90,cos(a*7.0));
            if (a > -3.14 && a < -3.14 + (kind-9.0)*0.898) d = min(d,abs(length(p)-0.57)-0.045*ticks);
          }
          return d;
        }
        void main() {
          float radius = length(vUv);
          float aa = max(fwidth(radius),0.018);
          float coverage = 1.0-smoothstep(0.88-aa,0.88+aa,radius);
          if (coverage < 0.01) discard;
          float shape = 1.0-smoothstep(-0.01,0.035,glyph(vUv,vData.x));
          float angle = mod(atan(vUv.x,vUv.y)+6.283185,6.283185)/6.283185;
          float rim = (1.0-smoothstep(0.025,0.055,abs(radius-0.77))) * step(angle,vData.y);
          vec3 ink = mix(vec3(0.015,0.024,0.045),vColor,shape);
          // Static bevel and full track keep simultaneous states readable
          // without adding flashing or depending solely on hue.
          float track = 1.0-smoothstep(0.025,0.055,abs(radius-0.77));
          float bevel = (1.0-smoothstep(0.015,0.04,abs(radius-0.86))) * (0.5+vUv.y*0.35);
          ink += vColor * track * 0.13 + vec3(0.3,0.36,0.42) * bevel;
          ink += vColor * rim * 0.8;
          gl_FragColor = vec4(ink,coverage*0.96);
        }`,
    });
    this.grow(64);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'combat-status-signals';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.userData.renderCategory = 'vfx';
    scene.add(this.mesh);
  }

  private grow(needed: number): void {
    if (needed <= this.capacity) return;
    let capacity = Math.max(64, this.capacity);
    while (capacity < needed) capacity *= 2;
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3),
    );
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.centers = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(
      THREE.DynamicDrawUsage,
    );
    this.colors = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(
      THREE.DynamicDrawUsage,
    );
    this.data = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(
      THREE.DynamicDrawUsage,
    );
    geometry.setAttribute('aCenter', this.centers);
    geometry.setAttribute('aColor', this.colors);
    geometry.setAttribute('aData', this.data);
    geometry.instanceCount = 0;
    this.geometry?.dispose();
    this.geometry = geometry;
    if (this.mesh) this.mesh.geometry = geometry;
    this.capacity = capacity;
  }

  hold(subject: ControlSubject): void {
    let entry = this.held.get(subject.id);
    if (!entry) {
      if (!subject.auras.some((a) => (a.remaining ?? 1) > 0)) return;
      entry = { state: createControlState(), stamp: this.frame, drawn: false };
      this.held.set(subject.id, entry);
    }
    resolveControlStateInto(entry.state, subject);
    entry.stamp = this.frame;
  }

  update(_dt: number, anchor: VfxAnchorResolver): void {
    let needed = 0;
    for (const [id, entry] of this.held) {
      if (entry.stamp !== this.frame) {
        this.held.delete(id);
        continue;
      }
      for (const remaining of entry.state.remaining) if (remaining > 0) needed++;
    }
    this.grow(needed);
    this.count = 0;
    for (const [id, entry] of this.held) {
      entry.drawn = false;
      const at = anchor(id, 1, this.anchorScratch);
      if (!at) continue;
      let signals = 0;
      for (const remaining of entry.state.remaining) if (remaining > 0) signals++;
      let ordinal = 0;
      for (let slot = 0; slot < CONTROL_SLOT_COUNT; slot++) {
        if (entry.state.remaining[slot] <= 0) continue;
        const i = this.count++;
        this.centers.setXYZ(i, at.x, at.y + 0.55, at.z);
        this.colorScratch.setHex(CONTROL_COLORS[slot]);
        this.colors.setXYZ(i, this.colorScratch.r, this.colorScratch.g, this.colorScratch.b);
        const columns = Math.min(4, signals);
        this.data.setXYZW(
          i,
          slot,
          entry.state.remaining[slot] / entry.state.duration[slot],
          ((ordinal % 4) - (columns - 1) / 2) * 1.05,
          Math.floor(ordinal / 4) * 1.05,
        );
        ordinal++;
        entry.drawn = true;
      }
    }
    this.geometry.instanceCount = this.count;
    this.upload(this.centers);
    this.upload(this.colors);
    this.upload(this.data);
    this.frame++;
  }

  private upload(attribute: THREE.InstancedBufferAttribute): void {
    attribute.clearUpdateRanges();
    if (this.count) {
      attribute.addUpdateRange(0, this.count * attribute.itemSize);
      attribute.needsUpdate = true;
    }
  }

  hasDrawn(id: number): boolean {
    return this.held.get(id)?.drawn === true;
  }
  sleep(id: number): void {
    this.held.delete(id);
  }
  setViewportHeight(height: number): void {
    this.material.uniforms.uViewport.value = Math.max(1, height);
  }
  stats(): { actors: number; signals: number; capacity: number } {
    return { actors: this.held.size, signals: this.count, capacity: this.capacity };
  }
  clear(): void {
    this.held.clear();
    this.count = 0;
    this.geometry.instanceCount = 0;
  }
  dispose(): void {
    this.clear();
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
