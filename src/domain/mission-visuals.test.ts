import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBuildingMesh } from '../scene/planet';
import { createMissionEffects, setBuildingPower, setGreenhouseStoryMode, type MissionVisualState } from '../scene/mission';

const state = (overrides: Partial<MissionVisualState> = {}): MissionVisualState => ({
  story: true, powered: false, plantChoice: null, plantedGreenhouses: [],
  arrival: 'waiting', arrivalSite: null, reducedMotion: false, ...overrides,
});

function materialOf(group: THREE.Group, name: string): THREE.Material {
  const object = group.getObjectByName(name);
  assert.ok(object instanceof THREE.Mesh);
  assert.ok(!Array.isArray(object.material));
  return object.material;
}

test('first light changes real habitat windows without mutating another building', () => {
  const one = createBuildingMesh('habitat');
  const two = createBuildingMesh('habitat');
  const original = materialOf(two, 'building-part-glass');
  setBuildingPower(one, false);
  const dark = materialOf(one, 'building-part-glass');
  assert.notEqual(dark, original);
  assert.equal(materialOf(two, 'building-part-glass'), original);
  setBuildingPower(one, true);
  const lit = materialOf(one, 'building-part-glass');
  assert.ok(lit instanceof THREE.MeshStandardMaterial);
  assert.ok(dark instanceof THREE.MeshStandardMaterial);
  assert.ok(lit.emissiveIntensity > dark.emissiveIntensity);
  assert.notEqual(lit.color.getHex(), dark.color.getHex());
  setBuildingPower(two, true);
  assert.equal(materialOf(two, 'building-part-glass'), lit, 'lit material is cached rather than cloned for every rebuild');
});

test('story greenhouses are empty before planting and their dome lets plants show', () => {
  const greenhouse = createBuildingMesh('greenhouse');
  const crops = greenhouse.getObjectByName('building-part-plants');
  assert.ok(crops);
  setGreenhouseStoryMode(greenhouse, true);
  assert.equal(crops.visible, false);
  const glass = materialOf(greenhouse, 'building-part-gardenGlass');
  assert.equal(glass.transparent, true);
  assert.ok(glass.opacity < 0.5);
  setGreenhouseStoryMode(greenhouse, false);
  assert.equal(crops.visible, true);
});

test('the two plant choices have distinct geometry and growth does not restart on state sync', () => {
  const scene = new THREE.Scene();
  const fx = createMissionEffects(scene, () => assert.fail('not arriving'));
  const planted = state({ plantChoice: 'sunleaf', plantedGreenhouses: [{ id: 'garden', x: 2, z: -1 }] });
  fx.sync(planted);
  const garden = scene.getObjectByName('planted-greenhouse-garden');
  assert.ok(garden instanceof THREE.Group);
  assert.deepEqual(garden.position.toArray(), [10, 0.69, -5]);
  for (let i = 0; i < 8; i++) fx.update(0.1, i / 10);
  const partialGrowth = garden.scale.x;
  assert.ok(partialGrowth > 0.1 && partialGrowth < 1);
  const sunleafGeometry = (garden.children[1] as THREE.Mesh).geometry;
  fx.sync({ ...planted, powered: true });
  fx.update(0, 1);
  assert.equal(garden.scale.x, partialGrowth, 'ordinary commands must not restart the growth animation');
  for (let i = 0; i < 10; i++) fx.update(0.1, i / 10 + 1);
  assert.equal(garden.scale.x, 1);
  fx.sync({ ...planted, plantChoice: 'moonbloom' });
  const moonbloom = scene.getObjectByName('planted-greenhouse-garden');
  assert.ok(moonbloom instanceof THREE.Group);
  const moonbloomGeometry = (moonbloom.children[1] as THREE.Mesh).geometry;
  assert.notEqual(moonbloomGeometry, sunleafGeometry);
  assert.notEqual(moonbloomGeometry.getAttribute('position').count, sunleafGeometry.getAttribute('position').count);
  assert.equal(scene.getObjectByName('native-glowwing')?.visible, true);
  fx.sync(state());
  assert.equal(scene.getObjectByName('planted-greenhouse-garden'), undefined);
  assert.equal(scene.getObjectByName('native-glowwing')?.visible, false);
  fx.dispose();
});

test('arrival completes once, leaves one companion and recovers an arriving save', () => {
  const scene = new THREE.Scene();
  let arrivals = 0;
  const arriving = state({ arrival: 'arriving', arrivalSite: { x: 2, z: 1 }, occupiedCells: [{ x: 2, z: 1 }, { x: 2, z: 0 }] });
  const fx = createMissionEffects(scene, () => { arrivals++; });
  fx.sync(arriving);
  assert.equal(arrivals, 0, 'sync must never call back reentrantly');
  const ship = scene.getObjectByName('first-visitor-ship');
  assert.ok(ship);
  assert.ok(ship.position.y > 10, 'a fresh arrival begins visibly above the pad');
  for (let i = 0; i < 60; i++) {
    fx.sync({ ...arriving });
    fx.update(0.1, i / 10);
  }
  assert.equal(arrivals, 1);
  fx.sync({ ...arriving, arrival: 'arrived' });
  const robot = scene.getObjectByName('companion-pip');
  assert.ok(robot);
  assert.equal(robot.visible, true);
  assert.notDeepEqual([robot.position.x, robot.position.z], [10, 0], 'the companion avoids an occupied neighboring plot');
  const robots: THREE.Object3D[] = [];
  scene.traverse(object => { if (object.name === 'companion-pip') robots.push(object); });
  assert.equal(robots.length, 1);
  fx.dispose();
  assert.equal(scene.getObjectByName('mission-world'), undefined);

  const restored = createMissionEffects(scene, () => { arrivals++; });
  restored.sync(arriving);
  for (let i = 0; i < 65; i++) restored.update(0.1, i / 10);
  assert.equal(arrivals, 2, 'a restored in-flight visual recovers once without creating duplicate visitors');
  restored.dispose();
});

test('reduced motion finishes growth, keeps native life still, and shortens arrival without synchronous callbacks', () => {
  const scene = new THREE.Scene();
  let arrivals = 0;
  const fx = createMissionEffects(scene, () => { arrivals++; });
  fx.sync(state({ plantChoice: 'moonbloom', plantedGreenhouses: [{ id: 'still', x: 0, z: -2 }], reducedMotion: true, arrival: 'arriving', arrivalSite: { x: 2, z: 2 } }));
  assert.equal(arrivals, 0);
  fx.update(0.1, 1);
  const garden = scene.getObjectByName('planted-greenhouse-still');
  assert.equal(garden?.scale.x, 1);
  const life = scene.getObjectByName('native-glowwing');
  assert.ok(life);
  const position = life.position.clone();
  const rotation = life.rotation.clone();
  fx.update(0.1, 100);
  assert.deepEqual(life.position, position);
  assert.deepEqual(life.rotation.toArray(), rotation.toArray());
  fx.update(0.1, 101);
  assert.equal(arrivals, 1);
  fx.update(0.1, 102);
  assert.equal(arrivals, 1);
  fx.dispose();
  fx.dispose();
});
