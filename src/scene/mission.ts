import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GRID_MAX, GRID_MIN, GRID_SIZE } from '../domain/world';

export interface MissionVisualState {
  story: boolean;
  powered: boolean;
  plantChoice: 'sunleaf' | 'moonbloom' | null;
  plantedGreenhouses: Array<{ id: string; x: number; z: number }>;
  arrival: 'waiting' | 'arriving' | 'arrived';
  arrivalSite: { x: number; z: number } | null;
  occupiedCells?: Array<{ x: number; z: number }>;
  reducedMotion: boolean;
}

// One cached material per state, shared across every habitat. Rebuilding a city
// never creates per-instance material clones or mutates the building templates.
const dimWindow = new THREE.MeshStandardMaterial({ color: '#142332', emissive: '#13202e', emissiveIntensity: 0.08, roughness: 0.8, metalness: 0.2 });
const litWindow = new THREE.MeshStandardMaterial({ color: '#ffe4b7', emissive: '#ffbc69', emissiveIntensity: 1.25, roughness: 0.35, metalness: 0.1 });
const dimStrip = new THREE.MeshBasicMaterial({ color: '#26343d' });
const litStrip = new THREE.MeshBasicMaterial({ color: '#ffe3ae' });

/** Settlement-wide power affects the actual windows, not only the mission text. */
export function setBuildingPower(group: THREE.Group, powered: boolean): void {
  if (group.userData.buildingType !== 'habitat' && group.name !== 'habitat') return;
  group.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object.name === 'building-part-glass') object.material = powered ? litWindow : dimWindow;
    if (object.name === 'building-part-light' || object.name === 'building-part-amber') object.material = powered ? litStrip : dimStrip;
  });
}

/** The original decorative crop stays in free build; story gardens start empty. */
export function setGreenhouseStoryMode(group: THREE.Group, story: boolean): void {
  group.traverse(object => {
    if (object.name === 'building-part-plants') object.visible = !story;
  });
}

type Plant = NonNullable<MissionVisualState['plantChoice']>;
interface Garden { group: THREE.Group; variety: Plant; age: number }

/** Lightweight procedural story changes. Contains no mission or save decisions. */
export function createMissionEffects(scene: THREE.Scene, onArrivalComplete: () => void): {
  sync: (state: MissionVisualState) => void;
  update: (deltaSeconds: number, elapsed: number) => void;
  dispose: () => void;
} {
  const layer = new THREE.Group();
  layer.name = 'mission-world';
  scene.add(layer);
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const ownGeometry = <T extends THREE.BufferGeometry>(geometry: T): T => { geometries.add(geometry); return geometry; };
  const ownMaterial = <T extends THREE.Material>(material: T): T => { materials.add(material); return material; };

  const shell = ownMaterial(new THREE.MeshStandardMaterial({ color: '#e8dbbf', roughness: 0.58, metalness: 0.22 }));
  const charcoal = ownMaterial(new THREE.MeshStandardMaterial({ color: '#282d3b', roughness: 0.7, metalness: 0.35 }));
  const copper = ownMaterial(new THREE.MeshStandardMaterial({ color: '#dd9561', roughness: 0.65, metalness: 0.3 }));
  const glass = ownMaterial(new THREE.MeshStandardMaterial({ color: '#3f8b9f', emissive: '#246879', emissiveIntensity: 0.35, roughness: 0.25, metalness: 0.35 }));
  const cyan = ownMaterial(new THREE.MeshBasicMaterial({ color: '#9af4e0' }));
  const amber = ownMaterial(new THREE.MeshBasicMaterial({ color: '#ffd395' }));
  const beamMaterial = ownMaterial(new THREE.MeshBasicMaterial({ color: '#a1f5dd', transparent: true, opacity: 0.2, depthWrite: false }));

  function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
    const object = new THREE.Mesh(ownGeometry(geometry), material);
    object.position.set(x, y, z);
    return object;
  }

  function createGarden(variety: Plant): THREE.Group {
    const stems: THREE.BufferGeometry[] = [];
    const leaves: THREE.BufferGeometry[] = [];
    const flowers: THREE.BufferGeometry[] = [];
    const transform = (geometry: THREE.BufferGeometry, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, angle = 0): THREE.BufferGeometry => {
      geometry.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, 0)), new THREE.Vector3(sx, sy, sz)));
      geometry.deleteAttribute('uv');
      return geometry;
    };
    for (const [i, [x, z]] of [[-0.75, -0.5], [0.6, -0.7], [-0.65, 0.6], [0.65, 0.55], [0, 0]].entries()) {
      const height = 0.65 + (i % 3) * 0.17;
      stems.push(transform(new THREE.CylinderGeometry(0.045, 0.06, height, 5), x, height / 2, z));
      if (variety === 'sunleaf') {
        for (let k = 0; k < 4; k++) {
          const angle = k * Math.PI / 2 + i * 0.7;
          leaves.push(transform(new THREE.SphereGeometry(0.34, 6, 4), x + Math.cos(angle) * 0.22, height * 0.72 + (k % 2) * 0.12, z + Math.sin(angle) * 0.22, 1.25, 0.23, 0.62, angle));
        }
        flowers.push(transform(new THREE.IcosahedronGeometry(0.16, 0), x, height + 0.1, z, 0.7, 1.1, 0.7));
      } else {
        leaves.push(transform(new THREE.ConeGeometry(0.38, 0.32, 7), x, height + 0.11, z, 1, 1, 1, i));
        for (let k = 0; k < 5; k++) {
          const angle = k * Math.PI * 2 / 5;
          flowers.push(transform(new THREE.SphereGeometry(0.14, 5, 4), x + Math.cos(angle) * 0.23, height + 0.19, z + Math.sin(angle) * 0.23, 1, 0.6, 1));
        }
      }
    }
    const group = new THREE.Group();
    const stemMaterial = ownMaterial(new THREE.MeshStandardMaterial({ color: variety === 'sunleaf' ? '#59866e' : '#4c9caa', roughness: 0.9 }));
    const leafMaterial = ownMaterial(new THREE.MeshStandardMaterial({ color: variety === 'sunleaf' ? '#e5bf67' : '#9a85df', emissive: variety === 'sunleaf' ? '#936824' : '#6348a2', emissiveIntensity: 0.2, roughness: 0.65 }));
    const flowerMaterial = ownMaterial(new THREE.MeshBasicMaterial({ color: variety === 'sunleaf' ? '#ffe4a0' : '#a1eff0' }));
    for (const [parts, material] of [[stems, stemMaterial], [leaves, leafMaterial], [flowers, flowerMaterial]] as const) {
      const geometry = mergeGeometries(parts);
      if (!geometry) throw new Error('Could not create the garden geometry.');
      group.add(new THREE.Mesh(ownGeometry(geometry), material));
      parts.forEach(part => part.dispose());
    }
    group.name = `garden-${variety}`;
    return group;
  }

  // Geometry and materials are shared by all gardens of one variety.
  const gardenTemplates: Record<Plant, THREE.Group> = { sunleaf: createGarden('sunleaf'), moonbloom: createGarden('moonbloom') };
  const gardens = new Map<string, Garden>();

  const nativeLife = new THREE.Group();
  nativeLife.name = 'native-glowwing';
  nativeLife.add(mesh(new THREE.IcosahedronGeometry(0.2, 1), cyan));
  const wingGeometry = ownGeometry(new THREE.SphereGeometry(0.17, 6, 4));
  const wingMaterial = ownMaterial(new THREE.MeshBasicMaterial({ color: '#b5a7ed', transparent: true, opacity: 0.6 }));
  for (const direction of [-1, 1]) {
    const wing = new THREE.Mesh(wingGeometry, wingMaterial);
    wing.position.set(direction * 0.28, 0, 0);
    wing.scale.set(1.9, 0.22, 0.8);
    wing.rotation.z = direction * 0.4;
    nativeLife.add(wing);
  }
  nativeLife.visible = false;
  layer.add(nativeLife);

  const ship = new THREE.Group();
  ship.name = 'first-visitor-ship';
  const body = mesh(new THREE.SphereGeometry(1, 12, 6), shell, 0, 0.5, 0);
  body.scale.set(1.45, 0.46, 1.7);
  ship.add(body);
  ship.add(mesh(new THREE.CylinderGeometry(0.85, 1.05, 0.26, 12), charcoal, 0, 0.12, 0));
  const canopy = mesh(new THREE.SphereGeometry(0.75, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), glass, 0, 0.67, -0.2);
  canopy.scale.set(1, 0.75, 1.15);
  ship.add(canopy);
  for (const direction of [-1, 1]) {
    const wing = mesh(new THREE.BoxGeometry(1.1, 0.13, 1.3), copper, direction * 1.35, 0.35, 0.4);
    wing.rotation.z = direction * -0.09;
    ship.add(wing);
    ship.add(mesh(new THREE.BoxGeometry(0.23, 0.12, 0.58), cyan, direction * 1.42, 0.25, 0.95));
    ship.add(mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.38, 5), charcoal, direction * 0.8, -0.05, 0.8));
  }
  ship.add(mesh(new THREE.BoxGeometry(0.6, 0.07, 0.14), amber, 0, 0.63, 1.5));
  ship.visible = false;
  layer.add(ship);

  const robot = new THREE.Group();
  robot.name = 'companion-pip';
  robot.add(mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.2, 10), charcoal, 0, 0.24));
  robot.add(mesh(new THREE.CylinderGeometry(0.26, 0.29, 0.08, 10), cyan, 0, 0.42));
  robot.add(mesh(new THREE.BoxGeometry(0.55, 0.7, 0.42), shell, 0, 0.84));
  robot.add(mesh(new THREE.BoxGeometry(0.25, 0.15, 0.025), copper, 0, 0.9, 0.225));
  const head = mesh(new THREE.BoxGeometry(0.7, 0.42, 0.46), shell, 0, 1.43);
  robot.add(head);
  robot.add(mesh(new THREE.BoxGeometry(0.57, 0.25, 0.025), charcoal, 0, 1.43, 0.246));
  const eyeGeometry = ownGeometry(new THREE.SphereGeometry(0.055, 6, 4));
  for (const x of [-0.15, 0.15]) {
    const eye = new THREE.Mesh(eyeGeometry, cyan);
    eye.position.set(x, 1.47, 0.275);
    robot.add(eye);
  }
  robot.add(mesh(new THREE.BoxGeometry(0.14, 0.025, 0.02), cyan, 0, 1.37, 0.275));
  robot.add(mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.26, 5), charcoal, 0.2, 1.77));
  robot.add(mesh(new THREE.IcosahedronGeometry(0.07, 0), amber, 0.2, 1.94));
  for (const direction of [-1, 1]) {
    const arm = mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.52, 5), copper, direction * 0.4, 0.88);
    arm.rotation.z = direction * 0.28;
    robot.add(arm);
    robot.add(mesh(new THREE.SphereGeometry(0.09, 6, 4), shell, direction * 0.47, 0.61));
  }
  robot.visible = false;
  layer.add(robot);

  const beacon = new THREE.Group();
  beacon.name = 'welcome-beacon';
  const beam = mesh(new THREE.CylinderGeometry(0.08, 0.18, 18, 8, 1, true), beamMaterial, 0, 9.45, 0);
  beacon.add(beam);
  const beaconRing = mesh(new THREE.TorusGeometry(2.05, 0.035, 4, 32), cyan, 0, 0.5, 0);
  beaconRing.rotation.x = Math.PI / 2;
  beacon.add(beaconRing);
  beacon.visible = false;
  layer.add(beacon);

  let current: MissionVisualState = { story: false, powered: false, plantChoice: null, plantedGreenhouses: [], arrival: 'waiting', arrivalSite: null, reducedMotion: false };
  let arrivalElapsed = 0;
  let notified = false;
  let disposed = false;
  const target = new THREE.Vector3();
  const start = new THREE.Vector3();
  const companionTarget = new THREE.Vector3();

  function chooseCompanionSite(site: { x: number; z: number }, occupied: Array<{ x: number; z: number }> = []): void {
    const used = new Set(occupied.map(cell => `${cell.x},${cell.z}`));
    used.add(`${site.x},${site.z}`); // The ship occupies the pad itself.
    const candidates: Array<{ x: number; z: number; distance: number }> = [];
    for (let x = GRID_MIN; x <= GRID_MAX; x++) {
      for (let z = GRID_MIN; z <= GRID_MAX; z++) {
        if (!used.has(`${x},${z}`)) candidates.push({ x, z, distance: (x - site.x) ** 2 + (z - site.z) ** 2 });
      }
    }
    candidates.sort((a, b) => a.distance - b.distance || a.z - b.z || a.x - b.x);
    // A validated world always leaves its reserved arrival cells empty.
    const chosen = candidates[0] ?? { x: site.x, z: site.z };
    companionTarget.set(chosen.x * GRID_SIZE, 0.08, chosen.z * GRID_SIZE);
  }

  function sync(state: MissionVisualState): void {
    if (disposed) return;
    const newArrival = state.arrival === 'arriving' && (current.arrival !== 'arriving'
      || current.arrivalSite?.x !== state.arrivalSite?.x || current.arrivalSite?.z !== state.arrivalSite?.z
      || !current.story);
    if (newArrival || state.arrival === 'waiting' || !state.story) { arrivalElapsed = 0; notified = false; }
    current = state;
    const keep = new Set<string>();
    if (state.story && state.plantChoice) {
      for (const greenhouse of state.plantedGreenhouses) {
        keep.add(greenhouse.id);
        let garden = gardens.get(greenhouse.id);
        if (!garden || garden.variety !== state.plantChoice) {
          if (garden) layer.remove(garden.group);
          garden = { group: gardenTemplates[state.plantChoice].clone(true), variety: state.plantChoice, age: 0 };
          garden.group.name = `planted-greenhouse-${greenhouse.id}`;
          gardens.set(greenhouse.id, garden);
          layer.add(garden.group);
        }
        garden.group.position.set(greenhouse.x * GRID_SIZE, 0.69, greenhouse.z * GRID_SIZE);
        if (state.reducedMotion) garden.age = 2;
        garden.group.scale.setScalar(Math.max(0.02, Math.min(1, garden.age / 1.6)));
      }
    }
    for (const [id, garden] of gardens) {
      if (!keep.has(id)) { layer.remove(garden.group); gardens.delete(id); }
    }
    nativeLife.visible = state.story && gardens.size > 0;
    const hasVisitor = state.story && state.arrival !== 'waiting' && !!state.arrivalSite;
    ship.visible = hasVisitor;
    robot.visible = hasVisitor && state.arrival === 'arrived';
    beacon.visible = hasVisitor;
    beam.visible = state.arrival === 'arriving';
    if (state.arrivalSite) {
      target.set(state.arrivalSite.x * GRID_SIZE, 0.68, state.arrivalSite.z * GRID_SIZE);
      chooseCompanionSite(state.arrivalSite, state.occupiedCells);
      beacon.position.set(target.x, 0, target.z);
      if (state.arrival === 'arrived') {
        ship.position.copy(target);
        ship.rotation.set(0, 0, 0);
        robot.position.copy(companionTarget);
      } else if (newArrival) {
        start.copy(target).add(new THREE.Vector3(12, 17, -11));
        ship.position.copy(start);
      }
    }
  }

  function update(deltaSeconds: number, elapsed: number): void {
    if (disposed || !current.story) return;
    const delta = Math.max(0, Math.min(deltaSeconds, 0.1));
    for (const garden of gardens.values()) {
      garden.age = current.reducedMotion ? 2 : Math.min(2, garden.age + delta);
      const progress = Math.min(1, garden.age / 1.6);
      // Smooth growth from the soil, with no overshoot or flashing.
      garden.group.scale.setScalar(Math.max(0.02, progress * progress * (3 - 2 * progress)));
    }
    const firstGarden = gardens.values().next().value as Garden | undefined;
    if (firstGarden) {
      const offset = current.reducedMotion ? 0 : elapsed * 0.35;
      nativeLife.position.set(firstGarden.group.position.x + 2.35 + Math.cos(offset) * 0.4, 2.1 + (current.reducedMotion ? 0 : Math.sin(elapsed * 0.8) * 0.24), firstGarden.group.position.z + Math.sin(offset) * 0.9);
      nativeLife.rotation.y = current.reducedMotion ? 0.25 : elapsed * 0.22;
    }
    if (current.arrival === 'arriving' && current.arrivalSite) {
      arrivalElapsed += delta;
      const duration = current.reducedMotion ? 0.25 : 5;
      const progress = Math.min(1, arrivalElapsed / duration);
      const flight = Math.min(1, progress / 0.72);
      const ease = flight * flight * (3 - 2 * flight);
      ship.position.lerpVectors(start, target, current.reducedMotion ? 1 : ease);
      ship.rotation.z = current.reducedMotion ? 0 : Math.sin(flight * Math.PI) * -0.12;
      robot.visible = progress >= 0.72;
      const walk = Math.max(0, Math.min(1, (progress - 0.72) / 0.28));
      robot.position.set(THREE.MathUtils.lerp(target.x, companionTarget.x, walk), 0.08, THREE.MathUtils.lerp(target.z, companionTarget.z, walk));
      beamMaterial.opacity = current.reducedMotion ? 0.18 : 0.15 + Math.sin(elapsed * 2) * 0.035;
      if (progress >= 1 && !notified) {
        notified = true;
        // A callback can synchronously call sync(arrived); notify only once.
        onArrivalComplete();
      }
    } else if (current.arrival === 'arrived') {
      robot.position.y = current.reducedMotion ? 0.08 : 0.08 + Math.sin(elapsed * 1.3) * 0.025;
      robot.rotation.y = 0.3;
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    scene.remove(layer);
    gardens.clear();
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
  }

  return { sync, update, dispose };
}
