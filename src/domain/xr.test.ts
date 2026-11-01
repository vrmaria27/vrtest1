import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { setupXR, type XROptions } from '../xr';
import type { WebXRSpaceEventMap } from 'three/src/renderers/webxr/WebXRController.js';

/** Exercise controller state without pretending a simulated session is hardware. */
function fixture(t: TestContext, canTeleport?: (point: THREE.Vector3) => boolean, resolveAim?: XROptions['resolveAim']) {
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const context = new Proxy({}, { get: () => () => undefined });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: () => ({ width: 0, height: 0, getContext: () => context }) },
  });
  const scene = new THREE.Scene();
  const rig = new THREE.Group();
  scene.add(rig);
  const camera = new THREE.PerspectiveCamera();
  rig.add(camera);
  // The real WebXRManager's ArrayCamera has no scene-graph parent. Giving it a
  // room-scale offset catches movement code that accidentally ignores the rig.
  const trackingCamera = new THREE.ArrayCamera();
  trackingCamera.position.set(0.45, 1.6, -0.2);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshBasicMaterial());
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const controllers = [new THREE.Group<WebXRSpaceEventMap>(), new THREE.Group<WebXRSpaceEventMap>()];
  const grips = [new THREE.Group(), new THREE.Group()];
  const manager = Object.assign(new THREE.EventDispatcher<{ sessionstart: {}; sessionend: {} }>(), {
    isPresenting: true,
    getController: (index: number) => controllers[index],
    getControllerGrip: (index: number) => grips[index],
    getCamera: () => trackingCamera,
    getSession: () => ({}),
  });
  function source(handedness: 'left' | 'right') {
    const gamepad = { axes: [0, 0, 0, 0], buttons: Array.from({ length: 6 }, () => ({ pressed: false })) };
    const input = { handedness, gamepad } as unknown as XRInputSource;
    return { input, gamepad };
  }
  const left = source('left');
  const right = source('right');
  const state = { aimed: null as THREE.Vector3 | null, selections: 0, cycles: 0, modes: 0, rotations: 0 };
  const options: XROptions = {
    renderer: { xr: manager } as unknown as THREE.WebGLRenderer,
    scene, rig, camera, ground, canTeleport, resolveAim,
    onAim: point => { state.aimed = point; },
    onSelect: () => { state.selections++; },
    onCycle: direction => { state.cycles += direction; },
    onRotate: () => { state.rotations++; },
    onMode: () => { state.modes++; },
    getHUD: () => ({ title: 'Habitat', detail: '120 CR', credits: 2400, status: 'Ready', mode: 'Build' }),
  };
  const api = setupXR(options);
  for (const [index, controller] of controllers.entries()) {
    controller.position.set(0, 1.5, 10);
    controller.rotation.x = -Math.PI / 4;
    controller.dispatchEvent({ type: 'connected', data: index === 0 ? left.input : right.input });
  }
  scene.updateMatrixWorld(true);
  t.after(() => {
    api.dispose();
    ground.geometry.dispose();
    ground.material.dispose();
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  });
  const headPosition = () => rig.localToWorld(trackingCamera.position.clone());
  const targetPoint = () => rig.localToWorld(new THREE.Vector3(0, 0, 8.5));
  return { ...api, scene, camera, rig, manager, controllers, left, right, state, headPosition, targetPoint };
}

function close(actual: THREE.Vector3, expected: THREE.Vector3, message: string) {
  assert.ok(actual.distanceTo(expected) < 1e-7, `${message}: ${actual.toArray()} != ${expected.toArray()}`);
}

test('XR trigger refreshes the right-hand aim and ignores the other trigger', t => {
  const xr = fixture(t);
  xr.update(0.1);
  assert.ok(xr.state.aimed);
  const firstPoint = xr.state.aimed.clone();
  xr.controllers[1]!.position.x = 3;
  xr.controllers[1]!.dispatchEvent({ type: 'selectstart', data: xr.right.input });
  assert.equal(xr.state.selections, 1);
  assert.equal(xr.state.aimed.x, firstPoint.x + 3);
  xr.controllers[0]!.dispatchEvent({ type: 'selectstart', data: xr.left.input });
  assert.equal(xr.state.selections, 1);
});

test('XR face buttons fire on press edges, including catalog direction and mode', t => {
  const xr = fixture(t);
  xr.right.gamepad.buttons[4]!.pressed = true;
  xr.update(0.1);
  xr.update(0.1);
  assert.equal(xr.state.cycles, 1);
  xr.right.gamepad.buttons[4]!.pressed = false;
  xr.left.gamepad.buttons[4]!.pressed = true;
  xr.right.gamepad.buttons[5]!.pressed = true;
  xr.left.gamepad.buttons[5]!.pressed = true;
  xr.update(0.1);
  xr.update(0.1);
  assert.equal(xr.state.cycles, 0);
  assert.equal(xr.state.modes, 1);
  assert.equal(xr.state.rotations, 1);
});

test('snap turning pivots around the room-scale head and latches until release', t => {
  const xr = fixture(t);
  xr.rig.position.set(11, 0, -7);
  const head = xr.headPosition();
  xr.right.gamepad.axes[2] = 1;
  xr.update(0.1);
  assert.ok(Math.abs(xr.rig.rotation.y + Math.PI / 6) < 1e-9);
  close(xr.headPosition(), head, 'turn must not orbit the player around the tracking origin');
  xr.update(0.1);
  assert.ok(Math.abs(xr.rig.rotation.y + Math.PI / 6) < 1e-9);
  xr.right.gamepad.axes[2] = 0;
  xr.update(0.1);
  xr.right.gamepad.axes[2] = -1;
  xr.update(0.1);
  assert.ok(Math.abs(xr.rig.rotation.y) < 1e-9);
  close(xr.headPosition(), head, 'opposite turn preserves head position');
});

test('repeated teleports land the head at the target and suppress building while aiming', t => {
  const xr = fixture(t);
  xr.rig.position.set(11, 0, -7);
  for (let attempt = 0; attempt < 2; attempt++) {
    const destination = xr.targetPoint();
    xr.left.gamepad.axes[3] = -1;
    xr.update(0.1);
    assert.equal(xr.state.aimed, null);
    xr.controllers[1]!.dispatchEvent({ type: 'selectstart', data: xr.right.input });
    assert.equal(xr.state.selections, 0);
    xr.left.gamepad.axes[3] = 0;
    xr.update(0.1);
    destination.y = 1.6;
    close(xr.headPosition(), destination, 'head should land on the requested point at its original height');
  }
});

test('teleport rejects occupied destinations at aim and rechecks before committing', t => {
  let allowed = false;
  const xr = fixture(t, () => allowed);
  const original = xr.headPosition();
  xr.left.gamepad.axes[3] = -1;
  xr.update(0.1);
  xr.left.gamepad.axes[3] = 0;
  xr.update(0.1);
  close(xr.headPosition(), original, 'occupied destination cannot be aimed');
  allowed = true;
  xr.left.gamepad.axes[3] = -1;
  xr.update(0.1);
  // A later server update could occupy a cell while the user is aiming.
  allowed = false;
  xr.left.gamepad.axes[3] = 0;
  xr.update(0.1);
  close(xr.headPosition(), original, 'destination must still be empty on release');
});

test('disconnect cancels pending teleport and cleanup can run twice', t => {
  const xr = fixture(t);
  const original = xr.headPosition();
  xr.left.gamepad.axes[3] = -1;
  xr.update(0.1);
  xr.controllers[0]!.dispatchEvent({ type: 'disconnected', data: xr.left.input });
  xr.update(0.1);
  close(xr.headPosition(), original, 'lost controller must not commit stale teleport');
  xr.manager.isPresenting = false;
  xr.manager.dispatchEvent({ type: 'sessionend' });
  xr.update(0.1);
  xr.dispose();
  xr.dispose();
  assert.equal(xr.camera.children.length, 0);
  assert.equal(xr.controllers[0]!.parent, null);
  assert.equal(xr.controllers[1]!.parent, null);
});


test('world aim resolver selects a building while teleportation still targets the floor', t => {
  const building = new THREE.Vector3(4, 0, -7);
  let resolverCalls = 0;
  const xr = fixture(t, undefined, raycaster => {
    assert.ok(raycaster.ray.direction.y < 0, 'resolver receives the current controller ray');
    resolverCalls++;
    return building;
  });
  xr.update(0.1);
  close(xr.state.aimed!, building, 'construction uses the world resolver');
  xr.controllers[1]!.dispatchEvent({ type: 'selectstart', data: xr.right.input });
  assert.equal(xr.state.selections, 1);
  close(xr.state.aimed!, building, 'trigger refresh also uses the world resolver');
  assert.ok(resolverCalls >= 2);
  const floor = xr.targetPoint();
  xr.left.gamepad.axes[3] = -1;
  xr.update(0.1);
  xr.left.gamepad.axes[3] = 0;
  xr.update(0.1);
  floor.y = 1.6;
  close(xr.headPosition(), floor, 'teleport must ignore building aim resolver');
});
