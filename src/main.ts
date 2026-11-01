import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BUILDINGS, GRID_SIZE, MAX_SAVE_BYTES, applyCommand, canPlace, createWorld, isReservedCell, parseWorld, serializeWorld, type BuildingType, type QuarterTurn, type World, type WorldCommand } from './domain/world';
import { LocalWorldRepository } from './persistence';
import { createBuildingMesh, createPlanetScene, setGhostValidity } from './scene/planet';
import { setupXR } from './xr';
import './style.css';

const icons: Record<BuildingType, string> = {
  habitat: '<path d="M4 21V9l8-5 8 5v12M8 21v-7h8v7M3 21h18M8 10h1m6 0h1"/>',
  power: '<path d="m5 4-3 12h20L19 4ZM4 10h16M12 4v12m-5 5h10m-5-5v5"/>',
  greenhouse: '<path d="M3 21V10l9-7 9 7v11ZM3 10h18M12 3v18m-4-5c0-4 4-4 4 0 0-4 4-4 4 0s-4 4-4 4-4 0-4-4Z"/>',
  tower: '<path d="M6 21h12m-10 0V11h8v10M5 11h14M7 11a5 5 0 0 1 10 0M12 3V1m-2 15h4"/>',
  landing: '<path d="m3 8 9-5 9 5v9l-9 5-9-5ZM8 9v7m8-7v7m-8-4h8"/>',
};
const icon = (paths: string, cls = '') => `<svg class="${cls}" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const types = Object.keys(BUILDINGS) as BuildingType[];
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <main class="world-app">
    <div id="viewport" aria-label="Interactive 3D planet. Click the ground to build; drag to orbit." role="region"></div>
    <div class="atmosphere" aria-hidden="true"></div>
    <header class="topbar">
      <a class="brand" href="./" aria-label="Aurelia home">${icon('<circle cx="12" cy="12" r="6"/><ellipse cx="12" cy="12" rx="11" ry="3" transform="rotate(-30 12 12)"/>')}<span>AURELIA<small>A WORLD TO MAKE YOUR OWN</small></span></a>
      <div class="world-label"><span class="live-dot"></span>NEW MERIDIAN<span class="label-divider">/</span><span class="muted">YOUR FIRST FRONTIER</span></div>
      <button class="vr-button" id="enter-vr">${icon('<rect x="2" y="6" width="20" height="12" rx="4"/><path d="m9 18 3-4 3 4M7 11h1m8 0h1"/>')}<span>Enter VR</span>${icon('<path d="M7 17 17 7M7 7h10v10"/>', 'button-arrow')}</button>
    </header>

    <section class="intro"><div class="eyebrow">EXOPLANET 07 <span>·</span> FIRST LIGHT</div><h1>A new world.<br><em>Your</em> next chapter.</h1><p>A quiet corner of the universe.<br>Build something that belongs here.</p></section>

    <aside class="build-panel" aria-label="Construction tools">
      <div class="panel-heading"><div><span class="eyebrow">YOUR SETTLEMENT</span><h2>Make yourself at home.</h2></div><span class="panel-index">01</span></div>
      <div class="mode-tabs" role="group" aria-label="Tool mode"><button id="build-mode" class="active" aria-pressed="true">${icon('<path d="M12 5v14M5 12h14"/>')}Build</button><button id="reclaim-mode" aria-pressed="false">${icon('<path d="m4 9 8-5 8 5-8 5ZM4 9v8l8 5 8-5V9M12 14v8"/>')}Reclaim</button></div>
      <div class="building-list">${types.map((type, i) => `<button class="building-card ${i === 0 ? 'selected' : ''}" data-building="${type}" aria-pressed="${i === 0}" title="${BUILDINGS[type].description}"><span class="building-icon" style="--building-color:${BUILDINGS[type].color}">${icon(icons[type])}</span><span class="building-copy"><strong>${BUILDINGS[type].label}</strong><span>${['A place to begin', 'Power your possibilities', 'Grow a greener tomorrow', 'Look a little further', 'Room for new arrivals'][i]}</span></span><span class="building-cost"><span class="credit-icon">◈</span> ${BUILDINGS[type].cost}<small>${i + 1}</small></span></button>`).join('')}</div>
      <div class="selection-footer"><span id="selection-hint">Click the terrain to place</span><button id="rotate" title="Rotate building (R)">${icon('<path d="M20 7v5h-5M20 12a8 8 0 1 0-2 6"/>')}<span id="rotation-label">0°</span></button></div>
    </aside>

    <div class="planet-coordinate"><span class="crosshair">+</span><div>NEW MERIDIAN<small>24.8° N &nbsp; 108.2° E</small></div><span class="coordinate-line"></span></div>
    <div class="scene-caption"><span class="live-dot"></span> A LITTLE FURTHER FROM ORDINARY</div>

    <footer class="bottom-bar">
      <div class="resource"><span class="resource-icon">◈</span><div><span class="eyebrow">COLONY CREDITS</span><strong id="credits">0</strong></div></div>
      <div class="resource structures"><span class="resource-icon">⌂</span><div><span class="eyebrow">STRUCTURES</span><strong><span id="building-count">0</span><small> / 432</small></strong></div></div>
      <div class="save-indicator"><span class="live-dot" id="save-dot"></span><span id="save-state">Saved on this device</span></div>
      <div class="utility-buttons"><button id="undo" title="Undo last change (Ctrl/⌘ Z)" aria-label="Undo last change">${icon('<path d="M9 5 3 11l6 6M3 11h11a6 6 0 0 1 0 12"/>')}</button><button id="home-view" title="Reset camera" aria-label="Reset camera">${icon('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 1v4m0 14v4M1 12h4m14 0h4"/>')}</button><span class="utility-divider"></span><button id="export" title="Download world backup" aria-label="Export world">${icon('<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>')}</button><button id="import" title="Load world backup" aria-label="Import world">${icon('<path d="M12 15V3m-4 4 4-4 4 4M4 16v5h16v-5"/>')}</button><button id="help" aria-label="Controls and headset setup">${icon('<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1.5.5-1.5 1.5-1.5 2m0 3h.01"/>')}</button></div>
    </footer>
    <div class="desktop-controls"><span><kbd>DRAG</kbd> Orbit</span><span><kbd>SCROLL</kbd> Zoom</span><span><kbd>R</kbd> Rotate</span><span class="local-badge">SINGLE PLAYER · LOCAL SAVE</span></div>
    <div id="toast" class="toast" role="status" aria-live="polite"></div>
    <input id="world-file" type="file" accept=".json,application/json" hidden />
    <dialog id="guide" aria-labelledby="guide-title">
      <button class="close-dialog" id="close-guide" aria-label="Close guide">×</button><span class="eyebrow">WELCOME TO AURELIA</span><h2 id="guide-title">Your next frontier.</h2><p>Build a small settlement on an alien planet. Your city saves in this browser. Export a backup to keep it safe or move it to another device.</p>
      <div class="guide-section"><h3>On Meta Quest 3 / 3S</h3><p>Open this site's <strong>HTTPS address</strong> in Meta Quest Browser, then choose <strong>Enter VR</strong> and allow immersive mode. This first version uses two controllers.</p><dl><dt>Right trigger</dt><dd>Place or reclaim a building</dd><dt>A / X</dt><dd>Next / previous building</dd><dt>B / Y</dt><dd>Switch build/reclaim / rotate</dd><dt>Left thumbstick</dt><dd>Push, aim the left ray, release to teleport</dd><dt>Right thumbstick</dt><dd>Snap turn</dd></dl><p class="guide-note">Teleport to empty terrain. The headset menu exits VR. Hand tracking is not supported yet.</p></div>
      <div class="guide-section"><h3>On your computer</h3><p>Click to build. Drag to look around. Scroll to zoom. Use <kbd>1</kbd>–<kbd>5</kbd> to choose, <kbd>R</kbd> to rotate, <kbd>D</kbd> to reclaim (75% refund), <kbd>B</kbd> to build, and <kbd>Ctrl/⌘ Z</kbd> to undo.</p></div>
      <div id="vr-diagnostic" class="guide-note"></div><p class="guide-note">First expedition · Single player today. Shared worlds are planned; multiplayer is not active.</p><button id="guide-done" class="primary-button">Let's build something</button>
    </dialog>
  </main>`;

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
let status = 'Welcome to your new world.';
let toastTimer: ReturnType<typeof setTimeout>;
function notify(message: string, error = false) {
  status = message;
  $('#toast').textContent = message;
  $('#toast').classList.toggle('error', error);
  $('#toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4200);
}

function starterWorld(): World {
  let initial = createWorld();
  for (const [type, x, z] of [['habitat', -1, -1], ['habitat', 0, -1], ['power', 1, -1], ['greenhouse', -1, 0], ['tower', 1, 0], ['landing', 0, 1]] as const) {
    const result = applyCommand(initial, { type: 'place', id: `outpost-${type}-${x}-${z}`, buildingType: type, x, z, rotation: 0 });
    if (result.ok) initial = result.world;
  }
  return initial;
}

let repository: LocalWorldRepository | null = null;
let world = starterWorld();
let persistenceBlocked = false;
let storageHealthy = false;
try {
  repository = new LocalWorldRepository(window.localStorage);
  world = repository.load() ?? world;
} catch {
  persistenceBlocked = true;
  notify('Local save unavailable or unreadable. Your existing save is preserved; export a backup of this session.', true);
}
const history: World[] = [];
let selected: BuildingType = 'habitat';
let rotation: QuarterTurn = 0;
let mode: 'build' | 'reclaim' = 'build';
let hover: { x: number; z: number } | null = null;
const planet = createPlanetScene();
const rig = new THREE.Group();
planet.scene.add(rig);
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2200);
rig.add(camera);
const viewport = $('#viewport');
let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
} catch {
  viewport.innerHTML = '<div class="fatal-message"><h2>Your planet needs WebGL</h2><p>Enable hardware acceleration or open this site in Meta Quest Browser.</p></div>';
  throw new Error('WebGL rendering unavailable.');
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
viewport.appendChild(renderer.domElement);
renderer.domElement.setAttribute('aria-label', 'Alien planet construction view');
renderer.domElement.tabIndex = 0;
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 9;
controls.maxDistance = 110;
controls.maxPolarAngle = Math.PI / 2 - 0.08;
controls.minPolarAngle = 0.12;
controls.target.set(0, 0, 0);
function resetCamera() {
  if (renderer.xr.isPresenting) return;
  rig.position.set(0, 0, 0);
  rig.rotation.set(0, 0, 0);
  camera.position.set(24, 12, 36);
  controls.target.set(-3, 3, 0);
  controls.update();
}
resetCamera();

const buildingLayer = new THREE.Group();
planet.scene.add(buildingLayer);
let ghost = createBuildingMesh(selected, true);
ghost.visible = false;
planet.scene.add(ghost);
const cellOutline = new THREE.Mesh(new THREE.PlaneGeometry(4.9, 4.9), new THREE.MeshBasicMaterial({ color: 0x87eadb, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
cellOutline.rotation.x = -Math.PI / 2;
cellOutline.position.y = 0.04;
cellOutline.visible = false;
planet.scene.add(cellOutline);
// Buildings share geometry/material caches; dropping a group must not dispose shared assets.
function renderBuildings() {
  buildingLayer.clear();
  for (const building of world.buildings) {
    const mesh = createBuildingMesh(building.type);
    mesh.position.set(building.x * GRID_SIZE, 0, building.z * GRID_SIZE);
    mesh.rotation.y = building.rotation * Math.PI / 2;
    mesh.userData.buildingId = building.id;
    buildingLayer.add(mesh);
  }
}
function save(): boolean {
  if (persistenceBlocked || !repository) {
    storageHealthy = false;
    $('#save-state').textContent = 'Export to keep this session';
    $('#save-dot').classList.add('warning');
    return false;
  }
  try {
    repository.save(world);
    $('#save-state').textContent = 'Saved on this device';
    $('#save-dot').classList.remove('warning');
    storageHealthy = true;
    return true;
  } catch {
    storageHealthy = false;
    $('#save-state').textContent = 'Save failed · export a backup';
    $('#save-dot').classList.add('warning');
    notify('Browser storage is full or blocked. Export your world to keep it.', true);
    return false;
  }
}
function updateUI() {
  $('#credits').textContent = world.credits.toLocaleString();
  $('#building-count').textContent = String(world.buildings.length);
  $('#undo').toggleAttribute('disabled', history.length === 0);
  $('#selection-hint').textContent = mode === 'build' ? 'Click the terrain to place' : 'Click a building · 75% refund';
  $('#rotation-label').textContent = `${rotation * 90}°`;
  for (const type of types) {
    const button = $<HTMLButtonElement>(`[data-building="${type}"]`);
    button.classList.toggle('selected', type === selected && mode === 'build');
    button.setAttribute('aria-pressed', String(type === selected && mode === 'build'));
    button.classList.toggle('unaffordable', world.credits < BUILDINGS[type].cost);
  }
  for (const item of ['build', 'reclaim']) {
    $(`#${item}-mode`).classList.toggle('active', mode === item);
    $(`#${item}-mode`).setAttribute('aria-pressed', String(mode === item));
  }
  updateGhost();
}
function updateGhost() {
  if (!hover) { ghost.visible = false; cellOutline.visible = false; return; }
  const { x, z } = hover;
  const existing = world.buildings.find(b => b.x === x && b.z === z);
  const valid = mode === 'build' ? canPlace(world, x, z) && world.credits >= BUILDINGS[selected].cost : !!existing;
  ghost.visible = mode === 'build';
  ghost.position.set(x * GRID_SIZE, 0.03, z * GRID_SIZE);
  ghost.rotation.y = rotation * Math.PI / 2;
  setGhostValidity(ghost, valid);
  cellOutline.visible = true;
  cellOutline.position.set(x * GRID_SIZE, 0.04, z * GRID_SIZE);
  cellOutline.material.color.set(valid ? 0x87eadb : 0xff7878);
}
function aim(point: THREE.Vector3 | null) {
  hover = point ? { x: Math.round(point.x / GRID_SIZE), z: Math.round(point.z / GRID_SIZE) } : null;
  updateGhost();
}
function selectType(type: BuildingType) {
  selected = type;
  mode = 'build';
  planet.scene.remove(ghost);
  // Ghost instances own cloned materials; dispose them when changing selection.
  ghost.traverse(object => {
    if (object instanceof THREE.Mesh) {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(material => material.dispose());
    }
  });
  ghost = createBuildingMesh(selected, true);
  planet.scene.add(ghost);
  updateUI();
}
function cycle(direction: number) { selectType(types[(types.indexOf(selected) + direction + types.length) % types.length]); }
function rotate() { rotation = ((rotation + 1) % 4) as QuarterTurn; updateUI(); }
function setMode(next: typeof mode) { mode = next; updateUI(); }
function commit(command: WorldCommand) {
  const result = applyCommand(world, { ...command, expectedRevision: world.revision });
  if (!result.ok) { notify(result.error, true); return; }
  history.push(world);
  if (history.length > 50) history.shift();
  world = result.world;
  renderBuildings();
  updateUI();
  if (save()) notify(command.type === 'place' ? `${BUILDINGS[command.buildingType].label} built. A little more like home.` : 'Building reclaimed. 75% of its cost returned.');
  else notify('Changes are only in this session. Exit VR and export a backup to keep them.', true);
}
function selectSite() {
  if (!hover) { notify('Aim at the ground inside your settlement grid.'); return; }
  if (mode === 'reclaim') {
    const building = world.buildings.find(b => b.x === hover!.x && b.z === hover!.z);
    if (building) commit({ type: 'remove', id: building.id });
    else notify('Aim at a building to reclaim it.');
  } else {
    if (isReservedCell(hover.x, hover.z)) { notify('This is your arrival area. Leave a little room to land.'); return; }
    if (renderer.xr.isPresenting) {
      const head = camera.getWorldPosition(new THREE.Vector3());
      if (Math.hypot(head.x - hover.x * GRID_SIZE, head.z - hover.z * GRID_SIZE) < 3.4) {
        notify('Choose a plot a little further away from where you are standing.'); return;
      }
    }
    commit({ type: 'place', id: crypto.randomUUID(), buildingType: selected, x: hover.x, z: hover.z, rotation });
  }
}
function undo() {
  const previous = history.pop();
  if (!previous) return;
  // Undo is local editing only. A server adapter must implement inverse commands,
  // not rewind another participant's revision/history.
  world = { ...previous, revision: world.revision + 1 };
  renderBuildings(); updateUI();
  if (save()) notify('Last change undone.');
  else notify('Change undone in this session. Export a backup to keep it.', true);
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
function resolveAim(ray: THREE.Raycaster): THREE.Vector3 | null {
  if (mode === 'reclaim') {
    // Pick the actual visible building, rather than the terrain behind its roof.
    const hit = ray.intersectObjects(buildingLayer.children, true)[0];
    if (!hit) return null;
    let object: THREE.Object3D | null = hit.object;
    while (object && !object.userData.buildingId) object = object.parent;
    const building = world.buildings.find(item => item.id === object?.userData.buildingId);
    return building ? new THREE.Vector3(building.x * GRID_SIZE, 0, building.z * GRID_SIZE) : null;
  }
  return ray.intersectObject(planet.ground, false)[0]?.point ?? null;
}
function aimPointer(event: PointerEvent) {
  if (renderer.xr.isPresenting) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  aim(resolveAim(raycaster));
}
let pointerDown: { x: number; y: number; time: number } | null = null;
let dragged = false;
renderer.domElement.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  pointerDown = { x: event.clientX, y: event.clientY, time: performance.now() };
  dragged = false;
});
renderer.domElement.addEventListener('pointermove', event => {
  if (pointerDown && Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 6) dragged = true;
  if (!dragged) aimPointer(event);
  else aim(null);
});
renderer.domElement.addEventListener('pointerup', event => {
  if (event.button === 0 && pointerDown && !dragged && performance.now() - pointerDown.time < 700) { aimPointer(event); selectSite(); }
  pointerDown = null; dragged = false;
});
renderer.domElement.addEventListener('pointerleave', () => { aim(null); pointerDown = null; });
renderer.domElement.addEventListener('pointercancel', () => { aim(null); pointerDown = null; });
for (const type of types) $(`[data-building="${type}"]`).addEventListener('click', () => selectType(type));
$('#rotate').addEventListener('click', rotate);
$('#build-mode').addEventListener('click', () => setMode('build'));
$('#reclaim-mode').addEventListener('click', () => setMode('reclaim'));
$('#undo').addEventListener('click', undo);
$('#home-view').addEventListener('click', resetCamera);
document.addEventListener('keydown', event => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || $('#guide').hasAttribute('open')) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(); return; }
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
  const key = event.key.toLowerCase();
  if (types[Number(key) - 1]) selectType(types[Number(key) - 1]);
  if (key === 'r') rotate();
  if (key === 'd') setMode('reclaim');
  if (key === 'b') setMode('build');
});
$('#export').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([serializeWorld(world)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'aurelia-new-meridian.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify('World backup downloaded. Keep it for your next expedition.');
});
$('#import').addEventListener('click', () => $('#world-file').click());
$('#world-file').addEventListener('change', async () => {
  const input = $<HTMLInputElement>('#world-file');
  const file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > MAX_SAVE_BYTES) throw new Error('Choose a world backup smaller than 1 MB.');
    const imported = parseWorld(await file.text());
    if (!window.confirm('Replace this session with the imported world? You can undo this change.')) return;
    history.push(world);
    world = imported;
    // Explicit replacement allows a valid import to repair a corrupt local save.
    persistenceBlocked = false;
    renderBuildings(); updateUI();
    if (save()) notify('World restored. Welcome back.');
    else notify('World imported for this session. Export a backup; browser storage is unavailable.', true);
  } catch (error) { notify(error instanceof Error ? error.message : 'Could not load that world.', true); }
  finally { input.value = ''; }
});
const guide = $<HTMLDialogElement>('#guide');
$('#help').addEventListener('click', () => guide.showModal());
$('#close-guide').addEventListener('click', () => guide.close());
$('#guide-done').addEventListener('click', () => guide.close());
guide.addEventListener('click', event => { if (event.target === guide) { const bounds = guide.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) guide.close(); } });

const xr = setupXR({
  renderer, scene: planet.scene, rig, camera, ground: planet.ground,
  resolveAim,
  canTeleport: point => !world.buildings.some(building => building.x === Math.round(point.x / GRID_SIZE) && building.z === Math.round(point.z / GRID_SIZE)),
  onAim: aim, onSelect: selectSite, onCycle: cycle, onRotate: rotate,
  onMode: () => setMode(mode === 'build' ? 'reclaim' : 'build'),
  getHUD: () => ({ title: BUILDINGS[selected].label, detail: mode === 'build' ? `${BUILDINGS[selected].cost} credits · ${rotation * 90}°` : 'Reclaim · 75% refund', credits: world.credits, status: storageHealthy ? status : 'Not saved · exit VR and export a backup', mode }),
});
let xrSupported = false;
let requestingXR = false;
let activeSession: XRSession | null = null;
async function checkVR() {
  if (!window.isSecureContext) { $('#vr-diagnostic').textContent = 'VR requires HTTPS. Open the published HTTPS site on your headset; a computer LAN HTTP address will not work.'; return; }
  try { xrSupported = !!navigator.xr && await navigator.xr.isSessionSupported('immersive-vr'); } catch { xrSupported = false; }
  $('#vr-diagnostic').textContent = xrSupported ? 'Immersive VR is available in this browser. Close this guide and choose Enter VR.' : 'Immersive VR is unavailable in this browser. You can still build on screen. To enter VR, open the published HTTPS site in Meta Quest Browser.';
}
void checkVR();
$('#enter-vr').addEventListener('click', async () => {
  if (requestingXR) return;
  if (activeSession) { await activeSession.end(); return; }
  if (!xrSupported || !navigator.xr) { guide.showModal(); return; }
  requestingXR = true;
  $<HTMLButtonElement>('#enter-vr').disabled = true;
  try {
    // Support is checked on page load. Request immediately inside the click so
    // the browser's transient user activation remains valid on Quest.
    activeSession = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
    activeSession.addEventListener('end', () => { activeSession = null; }, { once: true });
    await renderer.xr.setSession(activeSession);
  } catch (error) {
    if (activeSession) { await activeSession.end().catch(() => {}); activeSession = null; }
    notify(error instanceof Error ? `Could not enter VR: ${error.message}` : 'Could not enter VR. Check headset permissions.', true);
  } finally { requestingXR = false; $<HTMLButtonElement>('#enter-vr').disabled = false; }
});
const desktopPosition = new THREE.Vector3();
const desktopTarget = new THREE.Vector3();
renderer.xr.addEventListener('sessionstart', () => {
  desktopPosition.copy(camera.position); desktopTarget.copy(controls.target);
  controls.enabled = false;
  camera.position.set(0, 0, 0); camera.rotation.set(0, 0, 0);
  rig.position.set(0, 0, 20); rig.rotation.set(0, 0, 0);
  $('#enter-vr span').textContent = 'Exit VR';
  aim(null);
});
renderer.xr.addEventListener('sessionend', () => {
  rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0);
  camera.position.copy(desktopPosition); controls.target.copy(desktopTarget);
  controls.enabled = true; controls.update();
  camera.fov = 55; resize();
  $('#enter-vr span').textContent = 'Enter VR'; aim(null);
});

function resize() {
  camera.aspect = viewport.clientWidth / viewport.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(viewport.clientWidth, viewport.clientHeight);
}
window.addEventListener('resize', resize);
resize(); renderBuildings(); updateUI(); save();
const clock = new THREE.Clock();
let elapsed = 0;
renderer.setAnimationLoop(() => {
  const delta = Math.min(clock.getDelta(), 0.05); elapsed += delta;
  if (!renderer.xr.isPresenting) controls.update();
  xr.update(delta);
  planet.update(elapsed);
  renderer.render(planet.scene, camera);
});
