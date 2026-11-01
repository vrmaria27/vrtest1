import * as THREE from 'three';

export interface XRHUD {
  title: string;
  detail: string;
  credits: number;
  status: string;
  mode: string;
}

export interface XROptions {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  rig: THREE.Group;
  camera: THREE.PerspectiveCamera;
  ground: THREE.Mesh;
  onAim: (point: THREE.Vector3 | null) => void;
  onSelect: () => void;
  onCycle: (direction: number) => void;
  onRotate: () => void;
  onMode: () => void;
  canTeleport?: (point: THREE.Vector3) => boolean;
  resolveAim?: (raycaster: THREE.Raycaster) => THREE.Vector3 | null;
  getHUD: () => XRHUD;
}

/** Controller interaction is kept separate from world commands and persistence. */
export function setupXR(options: XROptions): {
  update: (deltaSeconds: number) => void;
  dispose: () => void;
} {
  const { renderer, scene, rig, camera, ground } = options;
  const raycaster = new THREE.Raycaster();
  const rotation = new THREE.Matrix4();
  const headBefore = new THREE.Vector3();
  const headAfter = new THREE.Vector3();
  const sources = new Map<number, XRInputSource>();
  const previousButtons = new Map<XRInputSource, boolean[]>();
  let turning = false;
  let teleporting = false;
  let teleportTarget: THREE.Vector3 | null = null;
  let hudState = '';
  let hudElapsed = 0;
  let disposed = false;

  const rayGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(), new THREE.Vector3(0, 0, -1),
  ]);
  const rayMaterial = new THREE.LineBasicMaterial({ color: 0x8ef4dd, transparent: true, opacity: 0.8 });
  const gripGeometry = new THREE.CapsuleGeometry(0.022, 0.085, 3, 6);
  const gripMaterial = new THREE.MeshStandardMaterial({ color: 0x343048, emissive: 0x233447, roughness: 0.6 });
  const controllers = [renderer.xr.getController(0), renderer.xr.getController(1)];
  const grips = [renderer.xr.getControllerGrip(0), renderer.xr.getControllerGrip(1)];
  const rays: THREE.Line[] = [];
  const selectHandlers: Array<() => void> = [];
  const connectHandlers: Array<(event: { data: XRInputSource }) => void> = [];
  const disconnectHandlers: Array<() => void> = [];
  const gripMeshes: THREE.Mesh[] = [];

  const markerGeometry = new THREE.RingGeometry(0.32, 0.48, 32);
  const markerMaterial = new THREE.MeshBasicMaterial({ color: 0x8ef4dd, side: THREE.DoubleSide, depthWrite: false });
  const marker = new THREE.Mesh(markerGeometry, markerMaterial);
  marker.rotation.x = -Math.PI / 2;
  marker.visible = false;
  scene.add(marker);

  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 420;
  const context = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const hudGeometry = new THREE.PlaneGeometry(0.86, 0.301);
  const hudMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
  const hud = new THREE.Mesh(hudGeometry, hudMaterial);
  hud.position.set(0, -0.43, -1.2);
  hud.renderOrder = 100;
  hud.visible = false;
  camera.add(hud);

  function groundPoint(index: number, useWorldResolver = false): THREE.Vector3 | null {
    const controller = controllers[index];
    if (!controller || !sources.has(index)) return null;
    controller.updateWorldMatrix(true, false);
    rotation.identity().extractRotation(controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(rotation).normalize();
    raycaster.far = 110;
    const point = useWorldResolver && options.resolveAim
      ? options.resolveAim(raycaster)
      : raycaster.intersectObject(ground, false)[0]?.point ?? null;
    if (!point || point.x < -49 || point.x > 49 || point.z < -49 || point.z > 49) return null;
    return point.clone();
  }

  function aimingIndex(): number {
    for (const [index, source] of sources) {
      if (source.handedness === 'right') return index;
    }
    return sources.keys().next().value ?? 0;
  }

  controllers.forEach((controller, index) => {
    const ray = new THREE.Line(rayGeometry, rayMaterial);
    ray.scale.z = 12;
    ray.name = 'controller-ray';
    controller.add(ray);
    rays.push(ray);
    rig.add(controller);
    const model = new THREE.Mesh(gripGeometry, gripMaterial);
    model.rotation.x = Math.PI / 3;
    grips[index]!.add(model);
    gripMeshes.push(model);
    rig.add(grips[index]!);

    const connect = (event: { data: XRInputSource }): void => { sources.set(index, event.data); };
    const disconnect = (): void => {
      const source = sources.get(index);
      if (source) previousButtons.delete(source);
      sources.delete(index);
    };
    const select = (): void => {
      if (!renderer.xr.isPresenting || teleporting || index !== aimingIndex()) return;
      // Refresh the ray before committing; no stale ghost location after a turn.
      options.onAim(groundPoint(index, true));
      options.onSelect();
    };
    controller.addEventListener('connected', connect);
    controller.addEventListener('disconnected', disconnect);
    controller.addEventListener('selectstart', select);
    connectHandlers.push(connect);
    disconnectHandlers.push(disconnect);
    selectHandlers.push(select);
  });

  function resetSession(): void {
    previousButtons.clear();
    turning = false;
    teleporting = false;
    teleportTarget = null;
    marker.visible = false;
    hud.visible = renderer.xr.isPresenting;
    hudState = '';
    options.onAim(null);
  }
  renderer.xr.addEventListener('sessionstart', resetSession);
  renderer.xr.addEventListener('sessionend', resetSession);

  function getHeadWorldPosition(target: THREE.Vector3): THREE.Vector3 {
    // WebXRManager's ArrayCamera is detached from the scene graph. Its position
    // is the current tracking-space pose; getWorldPosition() would ignore rig.
    rig.updateWorldMatrix(true, false);
    return target.copy(renderer.xr.getCamera().position).applyMatrix4(rig.matrixWorld);
  }

  function teleport(point: THREE.Vector3): void {
    // Room-scale head offset must be subtracted so the player, rather than the
    // tracking origin, lands on the target. Teleport preserves the user's height.
    getHeadWorldPosition(headBefore);
    rig.position.x += point.x - headBefore.x;
    rig.position.z += point.z - headBefore.z;
    rig.updateMatrixWorld(true);
  }

  function snapTurn(direction: number): void {
    getHeadWorldPosition(headBefore);
    rig.rotation.y -= direction * Math.PI / 6;
    rig.updateMatrixWorld(true);
    getHeadWorldPosition(headAfter);
    rig.position.x += headBefore.x - headAfter.x;
    rig.position.z += headBefore.z - headAfter.z;
    rig.updateMatrixWorld(true);
  }

  function paintHUD(): void {
    if (!context) return;
    const state = options.getHUD();
    const serialized = JSON.stringify({ ...state, teleporting });
    if (serialized === hudState) return;
    hudState = serialized;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'rgba(20, 16, 34, 0.95)';
    context.beginPath();
    context.roundRect(0, 0, 1200, 420, 28);
    context.fill();
    context.strokeStyle = '#5e6073';
    context.lineWidth = 2;
    context.stroke();
    context.fillStyle = '#92efd6';
    context.font = '600 22px system-ui, sans-serif';
    context.fillText('AURELIA  ·  COLONY CONSOLE', 38, 44);
    context.textAlign = 'right';
    context.fillStyle = '#ffbb84';
    context.fillText(`${Math.floor(state.credits).toLocaleString()} CR`, 1160, 44);
    context.textAlign = 'left';
    context.fillStyle = '#f5f0ff';
    context.font = '600 45px system-ui, sans-serif';
    context.fillText(teleporting ? 'Choose your landing spot' : state.title.slice(0, 40), 38, 105);
    context.font = '27px system-ui, sans-serif';
    context.fillStyle = '#c1b9d1';
    context.fillText(teleporting ? 'Aim the left controller. Release the stick to teleport.' : state.detail.slice(0, 80), 38, 150);
    context.fillStyle = '#92efd6';
    context.font = '600 26px system-ui, sans-serif';
    context.fillText(`${state.mode.toUpperCase()}  ·  ${state.status}`.slice(0, 83), 38, 200);
    context.fillStyle = '#4b435d';
    context.fillRect(38, 228, 1122, 1);
    context.font = '25px system-ui, sans-serif';
    context.fillStyle = '#f5f0ff';
    context.fillText('Right trigger: build / remove     A / X: choose building', 38, 270);
    context.fillText('B: build / remove mode             Y: rotate building', 38, 315);
    context.fillStyle = '#b5adc5';
    context.fillText('Left stick: aim + release to teleport     Right stick: snap turn', 38, 370);
    texture.needsUpdate = true;
  }

  function update(deltaSeconds: number): void {
    if (disposed || !renderer.xr.isPresenting) { hud.visible = false; return; }
    hud.visible = true;
    const session = renderer.xr.getSession();
    if (!session) return;
    let leftStick = 0;
    let leftIndex = -1;
    let rightAxis = 0;
    for (const [index, source] of sources) {
      const gamepad = source.gamepad;
      if (!gamepad) continue;
      const horizontal = gamepad.axes.length >= 4 ? gamepad.axes[2] ?? 0 : gamepad.axes[0] ?? 0;
      const vertical = gamepad.axes.length >= 4 ? gamepad.axes[3] ?? 0 : gamepad.axes[1] ?? 0;
      if (source.handedness === 'left') {
        leftStick = Math.hypot(horizontal, vertical);
        leftIndex = index;
      }
      if (source.handedness === 'right') rightAxis = horizontal;
      const buttons = gamepad.buttons.map(button => button.pressed);
      const previous = previousButtons.get(source) ?? [];
      const pressed = (button: number): boolean => !!buttons[button] && !previous[button];
      if (source.handedness === 'right') {
        if (pressed(4)) options.onCycle(1);
        if (pressed(5)) options.onMode();
      } else if (source.handedness === 'left') {
        if (pressed(4)) options.onCycle(-1);
        if (pressed(5)) options.onRotate();
      }
      previousButtons.set(source, buttons);
    }
    if (!turning && Math.abs(rightAxis) > 0.65) { snapTurn(Math.sign(rightAxis)); turning = true; }
    if (Math.abs(rightAxis) < 0.25) turning = false;

    if (leftIndex >= 0 && leftStick > 0.65) teleporting = true;
    if (teleporting) {
      // Releasing a disconnected controller cancels instead of teleporting.
      if (leftIndex < 0) {
        teleporting = false;
        teleportTarget = null;
      } else if (leftStick < 0.25) {
        if (teleportTarget && options.canTeleport?.(teleportTarget) !== false) teleport(teleportTarget);
        teleporting = false;
        teleportTarget = null;
      } else {
        const point = groundPoint(leftIndex);
        teleportTarget = point && options.canTeleport?.(point) !== false ? point : null;
      }
    }
    marker.visible = teleporting && !!teleportTarget;
    if (teleportTarget) marker.position.set(teleportTarget.x, 0.025, teleportTarget.z);
    options.onAim(teleporting ? null : groundPoint(aimingIndex(), true));
    for (let index = 0; index < controllers.length; index++) {
      const point = groundPoint(index, index === aimingIndex());
      const ray = rays[index]!;
      if (point) {
        controllers[index]!.getWorldPosition(headBefore);
        ray.scale.z = Math.min(110, headBefore.distanceTo(point));
      } else ray.scale.z = 12;
    }
    hudElapsed += Math.min(Math.max(deltaSeconds, 0), 0.1);
    if (hudElapsed > 0.12) { paintHUD(); hudElapsed = 0; }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    renderer.xr.removeEventListener('sessionstart', resetSession);
    renderer.xr.removeEventListener('sessionend', resetSession);
    controllers.forEach((controller, index) => {
      controller.removeEventListener('connected', connectHandlers[index]!);
      controller.removeEventListener('disconnected', disconnectHandlers[index]!);
      controller.removeEventListener('selectstart', selectHandlers[index]!);
      controller.remove(rays[index]!);
      rig.remove(controller);
      grips[index]!.remove(gripMeshes[index]!);
      rig.remove(grips[index]!);
    });
    scene.remove(marker);
    camera.remove(hud);
    for (const resource of [rayGeometry, rayMaterial, gripGeometry, gripMaterial, markerGeometry, markerMaterial, hudGeometry, hudMaterial, texture]) resource.dispose();
    sources.clear();
    previousButtons.clear();
  }

  return { update, dispose };
}
