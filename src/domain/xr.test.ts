import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { setupXR, type XROptions, type XRHUD } from '../xr';
import type { WebXRSpaceEventMap } from 'three/src/renderers/webxr/WebXRController.js';

/** Exercise controller state without pretending a simulated session is hardware. */
function fixture(t: TestContext, canTeleport?: (point: THREE.Vector3) => boolean, resolveAim?: XROptions['resolveAim']) {
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const paintedTexts: Array<{ text: string; x: number; y: number; width: number }> = [];
  const contextValues: Record<string, unknown> = { font: '24px sans-serif' };
  const textWidth = (text: string) => text.length * Number(String(contextValues.font).match(/(\d+)px/)?.[1] ?? 24) * 0.6;
  contextValues.measureText = (text: string) => ({ width: textWidth(text) });
  contextValues.fillText = (text: string, x: number, y: number) => paintedTexts.push({ text, x, y, width: textWidth(text) });
  const context = new Proxy(contextValues, { get: (target, key) => Reflect.get(target, key) ?? (() => undefined) });
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
  camera.position.copy(trackingCamera.position);
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
  const state = { aimed: null as THREE.Vector3 | null, selections: 0, cycles: 0, modes: 0, rotations: 0, actions: [] as string[] };
  const hud: XRHUD = { title: 'Habitat', detail: '120 CR', credits: 2400, status: 'Ready', mode: 'Build' };
  const options: XROptions = {
    renderer: { xr: manager } as unknown as THREE.WebGLRenderer,
    scene, rig, camera, ground, canTeleport, resolveAim,
    onAim: point => { state.aimed = point; },
    onSelect: () => { state.selections++; },
    onCycle: direction => { state.cycles += direction; },
    onRotate: () => { state.rotations++; },
    onMode: () => { state.modes++; },
    onAction: id => { state.actions.push(id); },
    getHUD: () => hud,
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
  return { ...api, scene, camera, rig, manager, controllers, left, right, state, hud, paintedTexts, headPosition, targetPoint };
}

function aimAtConsole(xr: ReturnType<typeof fixture>, pixelX: number, pixelY: number): number {
  const console = xr.camera.getObjectByName('colony-console');
  assert.ok(console, 'the action interface must exist in the actual headset scene');
  const controller = xr.controllers[1]!;
  xr.scene.updateMatrixWorld(true);
  const point = console.localToWorld(new THREE.Vector3((pixelX / 1200 - 0.5) * 1.02, (0.5 - pixelY / 800) * 0.68, 0));
  const localPoint = controller.parent!.worldToLocal(point.clone());
  controller.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), localPoint.sub(controller.position).normalize());
  controller.updateWorldMatrix(true, false);
  return controller.getWorldPosition(new THREE.Vector3()).distanceTo(point);
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

test('the right controller can ray-select mission actions in the headset console', t => {
  const xr = fixture(t);
  xr.hud.objective = 'Choose a place for your first habitat.';
  xr.hud.progress = 'A Light in the Dark · 1 / 6';
  xr.hud.actions = [
    { id: 'story', label: 'Begin your story' },
    { id: 'free', label: 'Free build' },
    { id: 'sunleaf', label: 'Plant Sunleaf' },
    { id: 'moonbloom', label: 'Plant Moonbloom' },
    { id: 'undo', label: 'Undo' },
    { id: 'mute', label: 'Mute sound' },
  ];
  xr.update(0.15);
  // Texture pixels are mapped through the real plane's UVs and controller ray.
  const distance = aimAtConsole(xr, 884, 590);
  xr.update(0.15);
  assert.equal(xr.state.aimed, null, 'pointing at the console clears the terrain ghost');
  const ray = xr.controllers[1]!.getObjectByName('controller-ray');
  assert.ok(ray);
  assert.ok(Math.abs(ray.scale.z - distance) < 1e-7, 'the ray stops on the visible action button');
  xr.controllers[1]!.dispatchEvent({ type: 'selectstart', data: xr.right.input });
  assert.deepEqual(xr.state.actions, ['mute']);
  assert.equal(xr.state.selections, 0, 'a console trigger must not also construct a building');
  aimAtConsole(xr, 314, 393);
  xr.controllers[1]!.dispatchEvent({ type: 'selectstart', data: xr.right.input });
  assert.deepEqual(xr.state.actions, ['mute', 'story']);
});

test('disabled and empty console areas block accidental construction and use live action state', t => {
  const xr = fixture(t);
  xr.hud.actions = [{ id: 'beacon', label: 'Activate beacon', disabled: true }];
  xr.update(0.15);
  aimAtConsole(xr, 314, 393);
  xr.controllers[1]!.dispatchEvent({ type: 'selectstart', data: xr.right.input });
  assert.deepEqual(xr.state.actions, []);
  assert.equal(xr.state.selections, 0);
  // Action availability can change between HUD texture refreshes; the command
  // must use current prerequisites rather than the last painted button state.
  xr.hud.actions[0]!.disabled = false;
  xr.controllers[1]!.dispatchEvent({ type: 'selectstart', data: xr.right.input });
  assert.deepEqual(xr.state.actions, ['beacon']);
  aimAtConsole(xr, 600, 330);
  xr.controllers[1]!.dispatchEvent({ type: 'selectstart', data: xr.right.input });
  assert.deepEqual(xr.state.actions, ['beacon']);
  assert.equal(xr.state.selections, 0, 'blank console space must not build through the panel');
});

test('mission guidance wraps in distinct rows and overly long final lines stay inside the console', t => {
  const xr = fixture(t);
  xr.hud.objective = 'Bring your home to life with solar power.';
  xr.hud.detail = 'One solar array powers your whole settlement. No cables or wiring are needed. Place it anywhere on an empty plot and watch your habitat windows light up.';
  xr.hud.status = 'This deliberately long status message '.repeat(12);
  xr.hud.actions = [{ id: 'name', label: 'A very long unbroken label: ' + 'A'.repeat(200) }];
  xr.update(0.15);
  xr.update(0.15);
  const detail = xr.paintedTexts.filter(line => line.y === 221 || line.y === 249);
  assert.equal(detail.length, 2, 'the power explanation gets two readable lines');
  assert.equal(detail.map(line => line.text).join(' '), xr.hud.detail, 'normal mission detail remains complete');
  const objective = xr.paintedTexts.filter(line => line.y === 146 || line.y === 182);
  assert.ok(objective.every(line => line.y < detail[0]!.y - 24), 'objective and detail rows must not overlap');
  const status = xr.paintedTexts.filter(line => line.y === 294 || line.y === 323);
  assert.equal(status.length, 2);
  assert.ok(status.at(-1)!.text.endsWith('…'), 'oversized final status line must be visibly truncated');
  assert.ok([...objective, ...detail, ...status].every(line => line.width <= 1122), 'all guidance stays inside its text rectangle');
  const action = xr.paintedTexts.filter(line => line.y === 388 || line.y === 419);
  assert.ok(action.at(-1)!.text.endsWith('…'));
  assert.ok(action.every(line => line.width <= 508), 'button labels cannot overflow into adjacent actions');
});
