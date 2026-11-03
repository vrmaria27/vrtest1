import * as THREE from 'three';

export interface XRHUDAction {
  id: string;
  label: string;
  disabled?: boolean;
}

export interface XRHUD {
  title: string;
  detail: string;
  credits: number;
  status: string;
  mode: string;
  objective?: string;
  progress?: string;
  actions?: XRHUDAction[];
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
  onAction?: (id: string) => void;
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
  let hoveredAction: string | null = null;

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
  canvas.height = 800;
  const context = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const hudGeometry = new THREE.PlaneGeometry(1.02, 0.68);
  const hudMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
  const hud = new THREE.Mesh(hudGeometry, hudMaterial);
  hud.name = 'colony-console';
  hud.position.set(0, -0.36, -1.35);
  hud.renderOrder = 100;
  hud.visible = false;
  camera.add(hud);

  function controllerRay(index: number): boolean {
    const controller = controllers[index];
    if (!controller || !sources.has(index)) return false;
    controller.updateWorldMatrix(true, false);
    rotation.identity().extractRotation(controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(rotation).normalize();
    raycaster.far = 110;
    return true;
  }

  function groundPoint(index: number, useWorldResolver = false): THREE.Vector3 | null {
    if (!controllerRay(index)) return null;
    const point = useWorldResolver && options.resolveAim
      ? options.resolveAim(raycaster)
      : raycaster.intersectObject(ground, false)[0]?.point ?? null;
    if (!point || point.x < -49 || point.x > 49 || point.z < -49 || point.z > 49) return null;
    return point.clone();
  }

  function actionLayout(state: XRHUD) {
    return (state.actions ?? []).slice(0, 6).map((action, index) => ({
      action,
      x: 38 + (index % 2) * 570,
      y: 352 + Math.floor(index / 2) * 99,
      width: 552,
      height: 83,
    }));
  }

  function consoleHit(index: number) {
    if (!hud.visible || !controllerRay(index)) return null;
    // The console is part of the scene, not a DOM overlay. Its UV coordinates
    // map directly to the same button rectangles used to paint the texture.
    hud.updateWorldMatrix(true, false);
    const hit = raycaster.intersectObject(hud, false)[0];
    if (!hit?.uv) return null;
    const x = hit.uv.x * canvas.width;
    const y = (1 - hit.uv.y) * canvas.height;
    const button = actionLayout(options.getHUD()).find(item =>
      x >= item.x && x <= item.x + item.width && y >= item.y && y <= item.y + item.height,
    );
    return { distance: hit.distance, action: button?.action };
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
      const hit = consoleHit(index);
      if (hit) {
        // A disabled button or blank part of the panel still blocks a trigger
        // from placing a building through the interface into the world.
        options.onAim(null);
        if (hit.action && !hit.action.disabled) options.onAction?.(hit.action.id);
        hudState = '';
        paintHUD();
        return;
      }
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
    hoveredAction = null;
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
    const serialized = JSON.stringify({ ...state, teleporting, hoveredAction });
    if (serialized === hudState) return;
    hudState = serialized;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'rgba(20, 16, 34, 0.95)';
    context.beginPath();
    context.roundRect(0, 0, canvas.width, canvas.height, 28);
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
    context.font = '600 39px system-ui, sans-serif';
    context.fillText(teleporting ? 'Choose your landing spot' : state.title, 38, 102);
    if (state.progress && !teleporting) {
      context.font = '22px system-ui, sans-serif';
      context.textAlign = 'right';
      context.fillStyle = '#b9dccf';
      context.fillText(state.progress, 1160, 96);
      context.textAlign = 'left';
    }
    context.font = '500 31px system-ui, sans-serif';
    context.fillStyle = '#f5f0ff';
    wrapText(teleporting ? 'Aim the left controller. Release the stick to teleport.' : state.objective ?? state.detail, 38, 146, 1122, 36, 2);
    if (state.objective && !teleporting) {
      context.font = '24px system-ui, sans-serif';
      context.fillStyle = '#bdb6cb';
      wrapText(state.detail, 38, 221, 1122, 28, 2);
    }
    context.fillStyle = '#92efd6';
    context.font = '500 25px system-ui, sans-serif';
    wrapText(`${state.mode.toUpperCase()}  ·  ${state.status}`, 38, 294, 1122, 29, 2);
    context.fillStyle = '#4b435d';
    context.fillRect(38, 337, 1122, 1);
    for (const { action, x, y, width, height } of actionLayout(state)) {
      const hovered = hoveredAction === action.id;
      context.fillStyle = action.disabled ? '#292535' : hovered ? '#526c64' : '#303f41';
      context.strokeStyle = action.disabled ? '#494052' : hovered ? '#b9f3df' : '#6e8f85';
      context.beginPath();
      context.roundRect(x, y, width, height, 12);
      context.fill();
      context.stroke();
      context.fillStyle = action.disabled ? '#9d94aa' : '#effbf6';
      context.font = '500 27px system-ui, sans-serif';
      wrapText(action.label, x + 22, y + 36, width - 44, 31, 2);
    }
    context.font = '23px system-ui, sans-serif';
    context.fillStyle = '#f5f0ff';
    context.fillText('Right trigger: build / reclaim or press a console button', 38, 690);
    context.fillText('A / X: choose building    B: build / reclaim    Y: rotate', 38, 732);
    context.fillStyle = '#b5adc5';
    context.fillText('Left stick: aim + release to teleport     Right stick: snap turn', 38, 774);
    texture.needsUpdate = true;
  }

  function wrapText(text: string, x: number, y: number, width: number, lineHeight: number, maxLines: number): void {
    if (!context) return;
    const measure = (value: string) => {
      const metrics = context.measureText(value);
      return metrics && Number.isFinite(metrics.width) ? metrics.width : value.length * 16;
    };
    let remaining = text.trim().replace(/\s+/g, ' ');
    for (let lineIndex = 0; lineIndex < maxLines && remaining; lineIndex++) {
      if (measure(remaining) <= width) {
        context.fillText(remaining, x, y + lineIndex * lineHeight);
        return;
      }
      // Never let a final line grow beyond its allotted rectangle. Long status
      // messages and user-visible labels fit safely, with an explicit ellipsis.
      const suffix = lineIndex === maxLines - 1 ? '…' : '';
      let count = remaining.length;
      while (count > 0 && measure(remaining.slice(0, count) + suffix) > width) count--;
      if (suffix) {
        context.fillText(remaining.slice(0, count).trimEnd() + suffix, x, y + lineIndex * lineHeight);
        return;
      }
      const lastSpace = remaining.lastIndexOf(' ', count);
      // A long unbroken word can be split rather than leaking outside the panel.
      const split = lastSpace > 0 ? lastSpace : Math.max(1, count);
      context.fillText(remaining.slice(0, split), x, y + lineIndex * lineHeight);
      remaining = remaining.slice(split).trimStart();
    }
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
    const activeIndex = aimingIndex();
    const hit = teleporting ? null : consoleHit(activeIndex);
    hoveredAction = hit?.action?.id ?? null;
    options.onAim(teleporting || hit ? null : groundPoint(activeIndex, true));
    for (let index = 0; index < controllers.length; index++) {
      const ray = rays[index]!;
      if (index === activeIndex && hit) {
        ray.scale.z = hit.distance;
        continue;
      }
      const point = groundPoint(index, index === activeIndex);
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
