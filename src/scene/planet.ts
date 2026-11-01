import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BuildingType } from '../domain/world';

/** All city meshes use metres: one plot is 5 × 5m; its surface is y=0. */
const materials = {
  shell: new THREE.MeshStandardMaterial({ color: '#e0d9cd', roughness: 0.68, metalness: 0.2 }),
  dark: new THREE.MeshStandardMaterial({ color: '#272737', roughness: 0.72, metalness: 0.45 }),
  rust: new THREE.MeshStandardMaterial({ color: '#ce754c', roughness: 0.7, metalness: 0.3 }),
  glass: new THREE.MeshStandardMaterial({ color: '#3aa0ab', emissive: '#246d79', emissiveIntensity: 0.45, roughness: 0.25, metalness: 0.7 }),
  light: new THREE.MeshBasicMaterial({ color: '#8fe8db' }),
  amber: new THREE.MeshBasicMaterial({ color: '#ffc888' }),
  solar: new THREE.MeshStandardMaterial({ color: '#354578', roughness: 0.28, metalness: 0.7 }),
  plants: new THREE.MeshStandardMaterial({ color: '#88a98a', roughness: 1 }),
};

type MaterialKey = keyof typeof materials;
const templates = new Map<BuildingType, THREE.Group>();
const ghostGeometry = new Map<BuildingType, THREE.BufferGeometry>();

function buildingTemplate(type: BuildingType): THREE.Group {
  const found = templates.get(type);
  if (found) return found;
  const buckets = new Map<MaterialKey, THREE.BufferGeometry[]>();
  const part = (
    key: MaterialKey, geometry: THREE.BufferGeometry,
    x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0,
  ) => {
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
      new THREE.Vector3(1, 1, 1),
    );
    geometry.applyMatrix4(matrix);
    // Every primitive supplies these attributes. Removing unused UVs lets them merge.
    geometry.deleteAttribute('uv');
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(geometry);
  };
  const box = (key: MaterialKey, w: number, h: number, d: number, x = 0, y = h / 2, z = 0, rx = 0, ry = 0, rz = 0) =>
    part(key, new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz);
  const cylinder = (key: MaterialKey, top: number, bottom: number, height: number, y: number, sides = 12, x = 0, z = 0) =>
    part(key, new THREE.CylinderGeometry(top, bottom, height, sides), x, y, z);

  cylinder('dark', 2.22, 2.3, 0.14, 0.07, 8);
  if (type === 'habitat') {
    cylinder('rust', 1.8, 1.95, 0.25, 0.26, 8);
    cylinder('shell', 1.78, 1.78, 1.85, 1.25, 8);
    cylinder('dark', 1.8, 1.8, 0.46, 1.55, 8);
    cylinder('glass', 1.815, 1.815, 0.28, 1.56, 8);
    cylinder('shell', 1.86, 1.86, 0.2, 1.86, 8);
    cylinder('rust', 1.25, 1.83, 0.55, 2.22, 8);
    cylinder('dark', 0.5, 0.68, 0.12, 2.56, 8);
    box('dark', 0.65, 1.25, 0.2, 0, 0.89, 1.8);
    box('amber', 0.41, 0.06, 0.04, 0, 1.65, 1.92);
    box('shell', 0.9, 0.12, 0.55, 0, 0.32, 2);
    for (let i = -1; i <= 1; i += 2) {
      box('shell', 0.16, 1.95, 0.2, i * 1.25, 1.2, 1.12, 0, -i * Math.PI / 4);
    }
    box('light', 0.12, 0.8, 0.05, -0.65, 0.96, 1.82);
  } else if (type === 'power') {
    cylinder('rust', 0.62, 0.88, 0.6, 0.43, 8);
    cylinder('shell', 0.38, 0.4, 1.95, 1.65, 8);
    cylinder('amber', 0.45, 0.45, 0.24, 2.32, 8);
    cylinder('dark', 0.48, 0.56, 0.18, 2.53, 8);
    for (const x of [-1.18, 1.18]) {
      box('dark', 1.72, 0.14, 3.1, x, 1.65, 0, -0.28);
      box('solar', 1.62, 0.08, 2.96, x, 1.77, -0.03, -0.28);
      for (let row = 0; row < 5; row++) {
        box('shell', 1.65, 0.025, 0.025, x, 1.78 - (row - 2) * 0.14, (row - 2) * 0.49, -0.28);
      }
      box('shell', 0.035, 0.025, 3, x, 1.82, -0.03, -0.28);
      box('dark', 0.14, 0.7, 0.16, x, 0.78, 0.25);
    }
    cylinder('light', 0.12, 0.12, 0.22, 2.74, 6);
  } else if (type === 'greenhouse') {
    cylinder('shell', 1.96, 2.08, 0.4, 0.34, 16);
    cylinder('dark', 1.9, 1.95, 0.12, 0.6, 16);
    part('glass', new THREE.SphereGeometry(1.88, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.64, 0);
    for (let i = 0; i < 6; i++) {
      const rotation = i * Math.PI / 6;
      part('shell', new THREE.TorusGeometry(1.9, 0.025, 4, 20, Math.PI), 0, 0.64, 0, 0, rotation);
    }
    part('shell', new THREE.TorusGeometry(1.55, 0.025, 4, 20), 0, 1.72, 0, Math.PI / 2);
    cylinder('light', 1.98, 1.98, 0.035, 0.65, 16);
    box('rust', 0.85, 1.05, 0.7, 0, 0.83, 1.7);
    box('dark', 0.56, 0.78, 0.04, 0, 0.72, 2.07);
    for (const x of [-0.8, 0.8]) {
      for (const z of [-0.65, 0.5]) cylinder('plants', 0.23, 0.4, 0.8, 0.95, 5, x, z);
    }
  } else if (type === 'tower') {
    cylinder('rust', 1.55, 1.9, 0.55, 0.38, 6);
    cylinder('shell', 0.87, 1.22, 4.1, 2.65, 6);
    cylinder('dark', 1.02, 1.1, 0.5, 2.1, 6);
    cylinder('glass', 1.035, 1.085, 0.3, 2.14, 6);
    cylinder('dark', 1.7, 1.1, 0.5, 4.67, 8);
    cylinder('glass', 1.7, 1.7, 0.66, 5.24, 8);
    cylinder('shell', 1.81, 1.81, 0.2, 5.66, 8);
    cylinder('rust', 0.9, 1.81, 0.4, 5.96, 8);
    cylinder('dark', 0.12, 0.2, 1.8, 6.96, 6);
    cylinder('amber', 0.15, 0.15, 0.16, 7.87, 6);
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI * 2 / 3;
      box('rust', 0.16, 3.1, 0.24, Math.sin(a), 2.05, Math.cos(a), 0, a);
    }
    box('light', 0.12, 1.7, 0.06, 0, 2.9, 1.03);
  } else if (type === 'landing') {
    cylinder('shell', 2.16, 2.25, 0.2, 0.25, 12);
    cylinder('dark', 1.92, 1.98, 0.06, 0.38, 12);
    part('light', new THREE.TorusGeometry(1.74, 0.025, 4, 32), 0, 0.42, 0, Math.PI / 2);
    box('shell', 0.12, 0.025, 1.23, -0.4, 0.43);
    box('shell', 0.12, 0.025, 1.23, 0.4, 0.43);
    box('shell', 0.8, 0.025, 0.12, 0, 0.43);
    for (let i = 0; i < 4; i++) {
      const a = (i + 0.5) * Math.PI / 2;
      const x = Math.sin(a) * 1.73, z = Math.cos(a) * 1.73;
      box('rust', 0.22, 0.38, 0.22, x, 0.49, z);
      box('amber', 0.18, 0.07, 0.18, x, 0.72, z);
    }
  }

  const group = new THREE.Group();
  group.name = type;
  group.userData.buildingType = type;
  for (const [key, geometries] of buckets) {
    const geometry = mergeGeometries(geometries);
    if (!geometry) throw new Error(`Could not create ${type} geometry`);
    const mesh = new THREE.Mesh(geometry, materials[key]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    geometries.forEach(g => g.dispose());
  }
  templates.set(type, group);
  return group;
}

/** Shared static geometry keeps the number of allocations low as the city grows. */
export function createBuildingMesh(type: BuildingType, ghost = false): THREE.Group {
  const template = buildingTemplate(type);
  if (!ghost) return template.clone(true);
  let geometry = ghostGeometry.get(type);
  if (!geometry) {
    geometry = mergeGeometries(template.children.map(mesh => (mesh as THREE.Mesh).geometry))!;
    ghostGeometry.set(type, geometry);
  }
  const group = new THREE.Group();
  group.name = `${type}-preview`;
  const material = new THREE.MeshBasicMaterial({ color: '#9ffff1', transparent: true, opacity: 0.4, depthWrite: false });
  group.add(new THREE.Mesh(geometry, material));
  group.userData.ghost = true;
  return group;
}

export function setGhostValidity(group: THREE.Group, valid: boolean): void {
  group.traverse(object => {
    if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshBasicMaterial) {
      object.material.color.set(valid ? '#9ffff1' : '#ff807c');
    }
  });
}

function randomSequence(seed = 4287) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export function createPlanetScene(): {
  scene: THREE.Scene;
  ground: THREE.Mesh;
  update: (timeSeconds: number) => void;
  dispose: () => void;
} {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#241e35');
  scene.fog = new THREE.FogExp2('#73546b', 0.0038);
  const random = randomSequence();
  const surfaceHeight = (x: number, z: number) => {
    const amplitude = THREE.MathUtils.smoothstep(Math.hypot(x, z), 65, 210);
    const wave = Math.sin(x * 0.024 + z * 0.012) * Math.cos(z * 0.028 - x * 0.009);
    return amplitude * (Math.abs(wave) * 20 + 2.5);
  };

  const skyGeometry = new THREE.SphereGeometry(1600, 32, 24);
  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      zenith: { value: new THREE.Color('#171c38') },
      horizon: { value: new THREE.Color('#b77d87') },
      glow: { value: new THREE.Color('#f9bc91') },
    },
    vertexShader: `varying vec3 direction; void main(){direction=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `
      uniform vec3 zenith; uniform vec3 horizon; uniform vec3 glow; varying vec3 direction;
      void main(){
        vec3 dir=normalize(direction);
        float elevation=max(0.0,dir.y);
        vec3 color=mix(horizon,zenith,pow(elevation,0.45));
        float sun=pow(max(0.0,dot(dir,normalize(vec3(-0.7,0.12,-0.9)))),12.0);
        color=mix(color,glow,sun*0.55*(1.0-elevation));
        gl_FragColor=vec4(color,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const sky = new THREE.Mesh(skyGeometry, skyMaterial);
  sky.renderOrder = -10;
  scene.add(sky);

  scene.add(new THREE.HemisphereLight('#b6c1f0', '#9c625d', 2.2));
  const sun = new THREE.DirectionalLight('#ffd2a0', 3.4);
  sun.position.set(-100, 80, -80);
  scene.add(sun);
  const fill = new THREE.DirectionalLight('#a0c7ea', 1.15);
  fill.position.set(60, 35, 80);
  scene.add(fill);

  const terrainGeometry = new THREE.PlaneGeometry(1800, 1800, 120, 120);
  terrainGeometry.rotateX(-Math.PI / 2);
  const positions = terrainGeometry.getAttribute('position');
  const terrainColors = new Float32Array(positions.count * 3);
  const low = new THREE.Color('#695060'), high = new THREE.Color('#ad8084');
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getZ(i);
    const radial = Math.hypot(x, z);
    const amplitude = THREE.MathUtils.smoothstep(radial, 65, 210);
    const wave = Math.sin(x * 0.024 + z * 0.012) * Math.cos(z * 0.028 - x * 0.009);
    const height = amplitude * (Math.abs(wave) * 20 + random() * 5) - 0.12;
    positions.setY(i, height);
    const color = low.clone().lerp(high, THREE.MathUtils.clamp(height / 26, 0, 1) * 0.65 + random() * 0.08);
    color.toArray(terrainColors, i * 3);
  }
  terrainGeometry.setAttribute('color', new THREE.BufferAttribute(terrainColors, 3));
  terrainGeometry.computeVertexNormals();
  const terrainMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
  const terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
  terrain.name = 'planet-terrain';
  scene.add(terrain);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(110, 110),
    new THREE.MeshStandardMaterial({ color: '#70545e', roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.name = 'build-surface';
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.GridHelper(105, 21, '#cbaa99', '#cbaa99');
  grid.position.set(0, 0.014, 0);
  const gridMaterial = grid.material as THREE.LineBasicMaterial;
  gridMaterial.transparent = true;
  gridMaterial.opacity = 0.13;
  scene.add(grid);

  // One instanced draw call each for the boulders and their smaller shards.
  const rockMaterial = new THREE.MeshStandardMaterial({ color: '#6a4c5e', roughness: 1, flatShading: true });
  const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), rockMaterial, 120);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 120; i++) {
    const a = random() * Math.PI * 2;
    const radius = 65 + random() * 125;
    const size = 0.5 + random() * 3.1;
    const x = Math.sin(a) * radius, z = Math.cos(a) * radius;
    dummy.position.set(x, surfaceHeight(x, z) + 0.3, z);
    dummy.scale.set(size * (0.8 + random()), size * 0.8, size);
    dummy.rotation.set(random(), random() * Math.PI, random());
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
    rocks.setColorAt(i, new THREE.Color().setHSL(0.89 + random() * 0.03, 0.15, 0.29 + random() * 0.12));
  }
  rocks.instanceMatrix.needsUpdate = true;
  scene.add(rocks);

  const crystalMaterial = new THREE.MeshStandardMaterial({ color: '#a7b6c7', emissive: '#4c7a83', emissiveIntensity: 0.35, roughness: 0.35, metalness: 0.4, flatShading: true });
  const crystals = new THREE.InstancedMesh(new THREE.ConeGeometry(0.9, 4, 5), crystalMaterial, 40);
  for (let i = 0; i < 40; i++) {
    const a = random() * Math.PI * 2;
    const radius = 63 + random() * 30;
    const x = Math.sin(a) * radius, z = Math.cos(a) * radius;
    dummy.position.set(x, surfaceHeight(x, z) + 1.1, z);
    dummy.scale.setScalar(0.6 + random() * 0.65);
    dummy.rotation.set(random() * 0.25, a, (random() - 0.5) * 0.45);
    dummy.updateMatrix();
    crystals.setMatrixAt(i, dummy.matrix);
  }
  scene.add(crystals);

  const mountainMaterial = new THREE.MeshStandardMaterial({ color: '#72536b', roughness: 1, flatShading: true });
  const mountains = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 6, 1), mountainMaterial, 40);
  for (let i = 0; i < 40; i++) {
    const a = i * Math.PI * 2 / 40 + random() * 0.12;
    const radius = 300 + random() * 100;
    const height = 36 + random() * 65;
    dummy.position.set(Math.sin(a) * radius, height / 2 - 1, Math.cos(a) * radius);
    dummy.scale.set(45 + random() * 70, height, 45 + random() * 70);
    dummy.rotation.set(0, random() * Math.PI * 2, 0);
    dummy.updateMatrix();
    mountains.setMatrixAt(i, dummy.matrix);
    mountains.setColorAt(i, new THREE.Color().setHSL(0.86, 0.14, 0.37 + random() * 0.12));
  }
  scene.add(mountains);

  // The ringed gas giant is intentionally behind terrain, at a convincing sky scale.
  const planet = new THREE.Group();
  planet.position.set(-175, 120, -510);
  planet.rotation.z = -0.4;
  const gasGeometry = new THREE.SphereGeometry(68, 40, 28);
  const gasPositions = gasGeometry.getAttribute('position');
  const gasColors = new Float32Array(gasPositions.count * 3);
  const gasPale = new THREE.Color('#e5d1b9'), gasBand = new THREE.Color('#a8768a');
  for (let i = 0; i < gasPositions.count; i++) {
    const latitude = gasPositions.getY(i) / 68;
    const stripe = Math.sin(latitude * 38 + Math.sin(latitude * 11) * 2) * 0.5 + 0.5;
    gasPale.clone().lerp(gasBand, stripe * 0.52).toArray(gasColors, i * 3);
  }
  gasGeometry.setAttribute('color', new THREE.BufferAttribute(gasColors, 3));
  const gasMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, fog: false });
  planet.add(new THREE.Mesh(gasGeometry, gasMaterial));
  const ringMaterial = new THREE.MeshBasicMaterial({ color: '#c4a8ab', side: THREE.DoubleSide, transparent: true, opacity: 0.55, fog: false, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(85, 119, 96), ringMaterial);
  ring.rotation.x = -1.25;
  planet.add(ring);
  const outerRing = new THREE.Mesh(new THREE.RingGeometry(123, 129, 96), ringMaterial);
  outerRing.rotation.x = -1.25;
  planet.add(outerRing);
  scene.add(planet);

  const moon = new THREE.Mesh(new THREE.SphereGeometry(16, 16, 12), new THREE.MeshStandardMaterial({ color: '#d2c3cd', roughness: 1, fog: false }));
  moon.position.set(225, 155, -550);
  scene.add(moon);

  const starPositions = new Float32Array(550 * 3);
  const starColors = new Float32Array(550 * 3);
  for (let i = 0; i < 550; i++) {
    const azimuth = random() * Math.PI * 2;
    const elevation = 0.1 + random() * 1.35;
    const radius = 1300;
    starPositions.set([Math.cos(azimuth) * Math.cos(elevation) * radius, Math.sin(elevation) * radius, Math.sin(azimuth) * Math.cos(elevation) * radius], i * 3);
    const brightness = 0.35 + random() * 0.65;
    starColors.set([brightness, brightness * 0.9, brightness], i * 3);
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  starGeometry.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
  const starMaterial = new THREE.PointsMaterial({ size: 1.3, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.7, fog: false, depthWrite: false });
  scene.add(new THREE.Points(starGeometry, starMaterial));

  return {
    scene,
    ground,
    update(timeSeconds: number) {
      // Subtle rotation is only a visual effect; it never changes shared city data.
      planet.rotation.y = Math.sin(timeSeconds * 0.005) * 0.015;
    },
    dispose() {
      const geometries = new Set<THREE.BufferGeometry>();
      const sceneMaterials = new Set<THREE.Material>();
      scene.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.LineSegments) {
          geometries.add(object.geometry);
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) sceneMaterials.add(material);
        }
      });
      geometries.forEach(g => g.dispose());
      sceneMaterials.forEach(m => m.dispose());
    },
  };
}
