import * as T from 'three';
import type {Primitive, Vec3} from '../ray/types';
import type {ShadowState} from './types';

export interface ShadowScene {
  scene: T.Scene;
  primitives: Primitive[];
  meshes: T.Mesh[];
  triangleCount: number;
  dispose(): void;
}

/** Rasterization and reference rays share these exact, transformed triangles. */
export function createShadowScene(state: ShadowState): ShadowScene {
  const scene = new T.Scene();
  const meshes: T.Mesh[] = [];

  const add = (
    name: string,
    geometry: T.BufferGeometry,
    color: T.ColorRepresentation,
    position: Vec3,
    rotation: Vec3 = [0, 0, 0],
  ) => {
    const material = new T.MeshBasicMaterial({color, side: T.DoubleSide});
    const mesh = new T.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    mesh.userData.objectId = meshes.length;
    meshes.push(mesh);
    scene.add(mesh);
    return mesh;
  };

  // PlaneGeometry winds toward +Z; this rotation makes its front normal +Y.
  add('ground', new T.PlaneGeometry(10, 10), '#d8d4cb', [0, 0, 0], [-Math.PI / 2, 0, 0]);

  if (state.preset === 'contact') {
    add('contact-cube', new T.BoxGeometry(1.2, 1.2, 1.2), '#c9774f', [-1.35, .6, .2]);
    add('raised-plate', new T.BoxGeometry(1.6, .14, 1.4), '#4d8590', [.8, state.height + .07, .65]);
    add('faceted-sphere', new T.SphereGeometry(.58, 24, 16), '#d3ad59', [1.65, .58, -1.5]);
  } else if (state.preset === 'steps') {
    const heights = [.75, 1.3, 1.85, 2.4];
    const colors = ['#b87551', '#c99b57', '#708f7d', '#567f92'];
    for (let i = 0; i < heights.length; i++) {
      const height = heights[i];
      add(`column-${i + 1}`, new T.BoxGeometry(.36, height, .48), colors[i], [-1.65 + i * 1.1, height / 2, .75]);
    }
    add('sloped-receiver', new T.BoxGeometry(4.8, .14, 2.4), '#a5b7af', [0, .48, -1.35], [.28, 0, 0]);
  } else {
    add('lower-layer', new T.BoxGeometry(2.9, .12, 2.15), '#b9865c', [-.4, .36, .15]);
    add('middle-layer', new T.BoxGeometry(2.5, .12, 1.9), '#658e96', [.2, .55 + state.height * .65, -.15], [0, .18, 0]);
    add('upper-layer', new T.BoxGeometry(2.05, .12, 1.65), '#c1ad70', [-.2, 2.85, -.45], [0, -.16, 0]);
  }

  scene.updateMatrixWorld(true);
  const primitives: Primitive[] = [];
  const vertex = new T.Vector3();
  for (const mesh of meshes) {
    const geometry = mesh.geometry;
    const positions = geometry.getAttribute('position');
    const index = geometry.getIndex();
    const count = index ? index.count : positions.count;
    const worldVertex = (offset: number): Vec3 => {
      vertex.fromBufferAttribute(positions, index ? index.getX(offset) : offset);
      vertex.applyMatrix4(mesh.matrixWorld);
      return [vertex.x, vertex.y, vertex.z];
    };
    for (let offset = 0; offset < count; offset += 3) {
      primitives.push({
        kind: 'triangle',
        a: worldVertex(offset),
        b: worldVertex(offset + 1),
        c: worldVertex(offset + 2),
        radius: 0,
        id: primitives.length,
        objectId: mesh.userData.objectId,
        materialId: mesh.userData.objectId,
        previousOffset: [0, 0, 0],
      });
    }
  }

  return {
    scene,
    primitives,
    meshes,
    triangleCount: primitives.length,
    dispose() {
      for (const mesh of meshes) {
        mesh.geometry.dispose();
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) material.dispose();
      }
      scene.clear();
    },
  };
}
