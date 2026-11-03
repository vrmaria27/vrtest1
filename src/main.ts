import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BUILDINGS, GRID_SIZE, MAX_SAVE_BYTES, canPlace, isReservedCell, type BuildingType, type QuarterTurn, type WorldCommand } from './domain/world';
import { activateBeacon, applyGameCommand, choosePlant, createGame, finishArrival, getMissionView, parseGame, PLANTS, renameSettlement, serializeGame, undoGame, type GameMode, type GameResult, type GameSave } from './domain/mission';
import { createLibrary, LocalGameRepository, type GameLibrary } from './game-persistence';
import { createBuildingMesh, createPlanetScene, setGhostValidity } from './scene/planet';
import { createMissionEffects, setBuildingPower, setGreenhouseStoryMode } from './scene/mission';
import { setupXR, type XRHUDAction } from './xr';
import { createSound } from './sound';
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
      <div class="world-label"><span class="live-dot"></span><span id="world-name">NEW MERIDIAN</span><span class="label-divider">/</span><span class="muted" id="mode-label">YOUR FIRST FRONTIER</span></div>
      <div class="top-actions"><button class="quiet-button" id="journey">Journey</button><button class="vr-button" id="enter-vr">${icon('<rect x="2" y="6" width="20" height="12" rx="4"/><path d="m9 18 3-4 3 4M7 11h1m8 0h1"/>')}<span>Enter VR</span>${icon('<path d="M7 17 17 7M7 7h10v10"/>', 'button-arrow')}</button></div>
    </header>

    <section class="intro" id="welcome-panel" aria-labelledby="welcome-title"><div class="eyebrow">CHAPTER ONE <span>·</span> A LIGHT IN THE DARK</div><h1 id="welcome-title">A quiet world.<br><em>A new beginning.</em></h1><p>A quiet world. A new beginning. Build a home, bring it to life, and send a signal into the stars.</p><div id="story-choices"></div><p class="welcome-note">A gentle, self-paced first chapter. Your story and Free build worlds save separately.</p></section>
    <section id="mission-panel" class="mission-panel" aria-label="Current mission" hidden><div class="mission-kicker"><span class="eyebrow">A LIGHT IN THE DARK</span><span id="mission-progress"></span></div><h2 id="mission-objective"></h2><p id="mission-detail"></p><div id="mission-actions"></div><form id="name-form" hidden><label for="settlement-name">What will you call this place?</label><div class="name-row"><input id="settlement-name" maxlength="64" placeholder="Your settlement name" autocomplete="off"/><button type="submit" class="small-primary">Name your home</button></div></form></section>
    <div id="arrival-marker" hidden aria-live="polite">Incoming · look for the beacon</div>

    <aside class="build-panel" aria-label="Construction tools">
      <div class="panel-heading"><div><span class="eyebrow">YOUR SETTLEMENT</span><h2 id="construction-title">Make yourself at home.</h2></div><span class="panel-index">01</span></div>
      <div class="mode-tabs" role="group" aria-label="Tool mode"><button id="build-mode" class="active" aria-pressed="true">${icon('<path d="M12 5v14M5 12h14"/>')}Build</button><button id="reclaim-mode" aria-pressed="false">${icon('<path d="m4 9 8-5 8 5-8 5ZM4 9v8l8 5 8-5V9M12 14v8"/>')}Reclaim</button></div>
      <div class="building-list">${types.map((type, i) => `<button class="building-card ${i === 0 ? 'selected' : ''}" data-building="${type}" aria-pressed="${i === 0}" title="${BUILDINGS[type].description}"><span class="building-icon" style="--building-color:${BUILDINGS[type].color}">${icon(icons[type])}</span><span class="building-copy"><strong>${BUILDINGS[type].label}</strong><span>${['A place to begin', 'Power your possibilities', 'Grow a greener tomorrow', 'Look a little further', 'Room for new arrivals'][i]}</span></span><span class="building-cost"><span class="credit-icon">◈</span> ${BUILDINGS[type].cost}<small>${i + 1}</small></span></button>`).join('')}</div>
      <div class="selection-footer"><span id="selection-hint">Click the terrain to place</span><button id="rotate" title="Rotate building (R)">${icon('<path d="M20 7v5h-5M20 12a8 8 0 1 0-2 6"/>')}<span id="rotation-label">0°</span></button></div>
    </aside>

    <div class="planet-coordinate"><span class="crosshair">+</span><div><span id="coordinate-name">NEW MERIDIAN</span><small>24.8° N &nbsp; 108.2° E</small></div><span class="coordinate-line"></span></div>
    <div class="scene-caption"><span class="live-dot"></span> A LITTLE FURTHER FROM ORDINARY</div>

    <footer class="bottom-bar">
      <div class="resource"><span class="resource-icon">◈</span><div><span class="eyebrow">COLONY CREDITS</span><strong id="credits">0</strong></div></div>
      <div class="resource structures"><span class="resource-icon">⌂</span><div><span class="eyebrow">STRUCTURES</span><strong><span id="building-count">0</span><small> / 432</small></strong></div></div>
      <div class="save-indicator"><span class="live-dot" id="save-dot"></span><span id="save-state">Saved on this device</span></div>
      <div class="utility-buttons"><button id="undo" title="Undo last change (Ctrl/⌘ Z)" aria-label="Undo last change">${icon('<path d="M9 5 3 11l6 6M3 11h11a6 6 0 0 1 0 12"/>')}</button><button id="home-view" title="Reset camera" aria-label="Reset camera">${icon('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 1v4m0 14v4M1 12h4m14 0h4"/>')}</button><span class="utility-divider"></span><button id="export" title="Download world backup" aria-label="Export world">${icon('<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>')}</button><button id="import" title="Load world backup" aria-label="Import world">${icon('<path d="M12 15V3m-4 4 4-4 4 4M4 16v5h16v-5"/>')}</button><button id="help" aria-label="Controls and headset setup">${icon('<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1.5.5-1.5 1.5-1.5 2m0 3h.01"/>')}</button></div>
    </footer>
    <div class="desktop-controls"><span><kbd>DRAG</kbd> Orbit</span><span><kbd>SCROLL</kbd> Zoom</span><span><kbd>R</kbd> Rotate</span><button id="sound-toggle" aria-pressed="false">Sound off</button><button id="motion-toggle" aria-pressed="false">Reduced motion off</button><span class="local-badge">SINGLE PLAYER · LOCAL SAVE</span></div>
    <div id="toast" class="toast" role="status" aria-live="polite"></div>
    <input id="world-file" type="file" accept=".json,application/json" hidden />
    <dialog id="guide" aria-labelledby="guide-title">
      <button class="close-dialog" id="close-guide" aria-label="Close guide">×</button><span class="eyebrow">WELCOME TO AURELIA</span><h2 id="guide-title">Your next frontier.</h2><p>Build a small settlement on an alien planet. Your city saves in this browser. Export a backup to keep it safe or move it to another device.</p>
      <div class="guide-section"><h3>On Meta Quest 3 / 3S</h3><p>Open this site's <strong>HTTPS address</strong> in Meta Quest Browser, then choose <strong>Enter VR</strong> and allow immersive mode. Use two controllers. Point the right ray at the console buttons and pull the trigger to start, plant, activate the beacon, name your home or undo.</p><dl><dt>Right trigger</dt><dd>Console action, or place / reclaim on terrain</dd><dt>A / X</dt><dd>Next / previous unlocked building</dd><dt>B / Y</dt><dd>Switch build/reclaim / rotate</dd><dt>Left thumbstick</dt><dd>Push, aim the left ray, release to teleport</dd><dt>Right thumbstick</dt><dd>Snap turn</dd></dl><p class="guide-note">The console has your objective, sound and Journey menu. Teleport to empty terrain. The headset menu exits VR. Hand tracking is not supported yet.</p></div>
      <div class="guide-section"><h3>On your computer</h3><p>Click to build. Drag to look around. Scroll to zoom. Use <kbd>1</kbd>–<kbd>5</kbd> to choose an unlocked building, <kbd>R</kbd> to rotate, <kbd>D</kbd> to reclaim, <kbd>B</kbd> to build, and <kbd>Ctrl/⌘ Z</kbd> to undo. Story mode gives full reclamation refunds. Free build gives 75%.</p></div>
      <div id="vr-diagnostic" class="guide-note"></div><p class="guide-note">First expedition · Single player today. Shared worlds are planned; multiplayer is not active.</p><button id="guide-done" class="primary-button">Let's build something</button>
    </dialog>
  </main>`;

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
let status = 'A quiet world. A new beginning.';
let toastTimer: ReturnType<typeof setTimeout>;
function notify(message: string, error = false) {
  status = message;
  $('#toast').textContent = message;
  $('#toast').classList.toggle('error', error);
  $('#toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 5500);
}

let repository: LocalGameRepository | null = null;
let library: GameLibrary = createLibrary();
let persistenceBlocked = false;
let storageHealthy = false;
try {
  repository = new LocalGameRepository(window.localStorage);
  library = repository.load();
} catch {
  persistenceBlocked = true;
  notify('Local save unavailable or unreadable. It is preserved. Export any new session you play.', true);
}
if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) library.settings.reducedMotion = true;
let game = (library.activeMode ? library[library.activeMode] : null) ?? createGame('story');
let world = game.world;
let welcome = true;
const history: Array<{ kind: 'edit' | 'import'; game: GameSave }> = [];
const sound = createSound();
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
  app.classList.add('webgl-unavailable');
  viewport.innerHTML = '<div class="fatal-message" role="alert"><h2>Your planet needs WebGL</h2><p>Enable hardware acceleration in your browser, then reload. You can also open this site in Meta Quest Browser.</p><p>Your saved worlds have not been changed.</p></div>';
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
const plotHints = new THREE.Group();
for (const x of [-2, 0, 2]) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.9, 2, 32), new THREE.MeshBasicMaterial({ color: '#b8e7d5', transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x * GRID_SIZE, 0.06, 0);
  plotHints.add(ring);
}
planet.scene.add(plotHints);
const effects = createMissionEffects(planet.scene, () => {
  if (game.mode === 'story' && game.mission?.arrival === 'arriving') accept(finishArrival(game), false);
});

function renderBuildings() {
  buildingLayer.clear();
  const view = getMissionView(game);
  for (const building of world.buildings) {
    const mesh = createBuildingMesh(building.type);
    mesh.position.set(building.x * GRID_SIZE, 0, building.z * GRID_SIZE);
    mesh.rotation.y = building.rotation * Math.PI / 2;
    mesh.userData.buildingId = building.id;
    if (building.type === 'habitat') setBuildingPower(mesh, game.mode === 'free' || view.powered);
    if (building.type === 'greenhouse') setGreenhouseStoryMode(mesh, game.mode === 'story');
    buildingLayer.add(mesh);
  }
  const mission = game.mission;
  effects.sync({
    story: game.mode === 'story', powered: view.powered,
    plantChoice: mission?.plantChoice ?? null,
    plantedGreenhouses: world.buildings.filter(building => building.type === 'greenhouse' && mission?.plantedGreenhouseIds.includes(building.id)),
    arrival: mission?.arrival ?? 'waiting', arrivalSite: mission?.arrivalSite ?? null,
    reducedMotion: library.settings.reducedMotion, occupiedCells: world.buildings,
  });
}
function save(): boolean {
  if (!repository || persistenceBlocked) {
    storageHealthy = false;
    $('#save-state').textContent = 'Export to keep this session';
    $('#save-dot').classList.add('warning');
    return false;
  }
  try {
    repository.save(library);
    storageHealthy = true;
    $('#save-state').textContent = 'Saved on this device';
    $('#save-dot').classList.remove('warning');
    return true;
  } catch {
    storageHealthy = false;
    $('#save-state').textContent = 'Save failed · export a backup';
    $('#save-dot').classList.add('warning');
    return false;
  }
}
function persistGame() {
  library[game.mode] = game;
  library.activeMode = game.mode;
  return save();
}
function button(action: XRHUDAction, primary = false) {
  const element = document.createElement('button');
  element.type = 'button';
  element.dataset.action = action.id;
  element.textContent = action.label;
  element.className = primary ? 'small-primary' : 'secondary-button';
  element.disabled = action.disabled ?? false;
  return element;
}
function welcomeActions(): XRHUDAction[] {
  const actions: XRHUDAction[] = [];
  if (library.activeMode && library[library.activeMode]) actions.push({ id: 'continue', label: 'Continue' });
  if (library.activeMode !== 'story' || !library.story) actions.push({ id: 'begin-story', label: library.story ? 'Continue story' : 'Begin your story' });
  actions.push({ id: 'free-build', label: 'Free build' });
  return actions;
}
function objectiveActions(): XRHUDAction[] {
  const view = getMissionView(game);
  if (view.action === 'plant') return [
    { id: 'plant-sunleaf', label: 'Plant Sunleaf' },
    { id: 'plant-moonbloom', label: 'Plant Moonbloom' },
  ];
  if (view.action === 'beacon') return [{ id: 'beacon', label: 'Activate beacon' }];
  return [];
}
function updateUI() {
  const view = getMissionView(game);
  $('.world-app').classList.toggle('choosing', welcome);
  $('.world-app').classList.toggle('story-mode', game.mode === 'story');
  $('#welcome-panel').hidden = !welcome;
  $('#mission-panel').hidden = welcome || game.mode !== 'story';
  $('#mission-objective').textContent = view.objective;
  $('#mission-detail').textContent = view.detail;
  $('#mission-progress').textContent = `${view.step} / ${view.total}`;
  $('#mission-actions').replaceChildren(...objectiveActions().map(action => button(action, action.id === 'beacon')));
  $('#name-form').hidden = view.action !== 'name';
  $('#story-choices').replaceChildren(...welcomeActions().map((action, index) => button(action, index === 0)));
  $('#credits').textContent = world.credits.toLocaleString();
  $('#building-count').textContent = String(world.buildings.length);
  $('#world-name').textContent = world.name.toUpperCase();
  $('#coordinate-name').textContent = world.name.toUpperCase();
  $('#mode-label').textContent = game.mode === 'story' ? 'A LIGHT IN THE DARK' : 'FREE BUILD';
  $('#construction-title').textContent = game.mode === 'story' ? 'Room for a new beginning.' : 'Make yourself at home.';
  $('#undo').toggleAttribute('disabled', history.length === 0 || welcome);
  $('#selection-hint').textContent = mode === 'build' ? 'Click any clear plot to place' : `Click a building · ${game.mode === 'story' ? 'full' : '75%'} refund`;
  $('#rotation-label').textContent = `${rotation * 90}°`;
  $('#sound-toggle').textContent = library.settings.muted ? 'Sound off' : 'Sound on';
  $('#sound-toggle').setAttribute('aria-pressed', String(!library.settings.muted));
  $('#motion-toggle').textContent = library.settings.reducedMotion ? 'Reduced motion on' : 'Reduced motion off';
  $('#motion-toggle').setAttribute('aria-pressed', String(library.settings.reducedMotion));
  for (const type of types) {
    const card = $<HTMLButtonElement>(`[data-building="${type}"]`);
    card.hidden = !view.unlocked.includes(type);
    card.classList.toggle('selected', type === selected && mode === 'build');
    card.setAttribute('aria-pressed', String(type === selected && mode === 'build'));
    card.classList.toggle('unaffordable', world.credits < BUILDINGS[type].cost);
  }
  for (const item of ['build', 'reclaim']) {
    $(`#${item}-mode`).classList.toggle('active', mode === item);
    $(`#${item}-mode`).setAttribute('aria-pressed', String(mode === item));
  }
  plotHints.visible = !welcome && game.mode === 'story' && view.step === 1;
  updateGhost();
}
function updateGhost() {
  if (welcome || !hover) { ghost.visible = false; cellOutline.visible = false; return; }
  const { x, z } = hover;
  const existing = world.buildings.find(building => building.x === x && building.z === z);
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
  hover = point && !welcome ? { x: Math.round(point.x / GRID_SIZE), z: Math.round(point.z / GRID_SIZE) } : null;
  updateGhost();
}
function replaceGhost(type: BuildingType) {
  selected = type;
  planet.scene.remove(ghost);
  ghost.traverse(object => {
    if (object instanceof THREE.Mesh) {
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
    }
  });
  ghost = createBuildingMesh(type, true);
  planet.scene.add(ghost);
}
function selectType(type: BuildingType) {
  if (welcome) return;
  if (!getMissionView(game).unlocked.includes(type)) { notify('This building unlocks later in your story. Follow the current objective.'); return; }
  replaceGhost(type); mode = 'build'; updateUI();
}
function recommendedType(): BuildingType {
  const view = getMissionView(game);
  return view.step === 2 ? 'power' : view.step === 3 ? 'greenhouse' : view.step === 4 ? 'landing' : 'habitat';
}
function cycle(direction: number) {
  const available = getMissionView(game).unlocked;
  selectType(available[(available.indexOf(selected) + direction + available.length) % available.length]);
}
function rotate() { if (!welcome) { rotation = ((rotation + 1) % 4) as QuarterTurn; updateUI(); } }
function setMode(next: typeof mode) { if (!welcome) { mode = next; updateUI(); } }
function remember() { history.push({ kind: 'edit', game }); if (history.length > 50) history.shift(); }
function accept(result: GameResult, recordHistory = true, fallback = 'Your settlement has changed.') {
  if (!result.ok) { notify(result.error, true); return; }
  if (result.game === game) return;
  const oldObjective = getMissionView(game).objective;
  if (recordHistory) remember();
  game = result.game; world = game.world;
  if (mode === 'build' && oldObjective !== getMissionView(game).objective) replaceGhost(recommendedType());
  renderBuildings(); updateUI();
  const saved = persistGame();
  if (saved) notify(result.milestone ?? fallback);
  else notify('Changes are only in this session. Exit VR and export a backup to keep them.', true);
  if (result.milestone) sound.cue();
}
function commit(command: WorldCommand) {
  accept(applyGameCommand(game, { ...command, expectedRevision: world.revision }), true,
    command.type === 'place' ? `${BUILDINGS[command.buildingType].label} built. Make this place your own.` : `Building reclaimed. ${game.mode === 'story' ? 'Its full cost' : '75% of its cost'} returned.`);
}
function selectSite() {
  if (welcome) return;
  if (!hover) { notify(mode === 'build' ? 'Aim at an empty plot inside the settlement grid.' : 'Aim directly at a building to reclaim it.'); return; }
  if (mode === 'reclaim') {
    const building = world.buildings.find(item => item.x === hover!.x && item.z === hover!.z);
    if (building) commit({ type: 'remove', id: building.id });
    else notify('Aim directly at a building to reclaim it.');
  } else {
    if (isReservedCell(hover.x, hover.z)) { notify('This is your arrival area. Choose another empty grid plot.'); return; }
    if (renderer.xr.isPresenting) {
      const head = camera.getWorldPosition(new THREE.Vector3());
      if (Math.hypot(head.x - hover.x * GRID_SIZE, head.z - hover.z * GRID_SIZE) < 3.4) { notify('Choose a plot a little further from where you are standing.'); return; }
    }
    commit({ type: 'place', id: crypto.randomUUID(), buildingType: selected, x: hover.x, z: hover.z, rotation });
  }
}
function undo() {
  if (welcome) return;
  const previous = history.pop();
  if (!previous) return;
  if (Math.max(game.world.revision, previous.game.world.revision) >= Number.MAX_SAFE_INTEGER - 1) {
    history.push(previous); notify('The world revision limit has been reached. Export your world to keep it.', true); return;
  }
  // Import replaces a playthrough. Undo restores that complete save, while an
  // ordinary edit keeps this playthrough's discoveries and visitor history.
  game = previous.kind === 'import'
    ? { ...previous.game, world: { ...previous.game.world, revision: Math.max(world.revision, previous.game.world.revision) + 1 } }
    : undoGame(game, previous.game);
  world = game.world;
  if (!getMissionView(game).unlocked.includes(selected)) replaceGhost('habitat');
  renderBuildings(); updateUI();
  if (persistGame()) notify('Last edit undone. Your discoveries are remembered.');
  else notify('Change undone in this session. Export a backup to keep it.', true);
}
function start(modeToStart: GameMode) {
  const target = library[modeToStart];
  game = target ?? createGame(modeToStart); world = game.world;
  history.length = 0;
  welcome = false; mode = 'build'; rotation = 0; hover = null;
  replaceGhost(modeToStart === 'story' ? recommendedType() : 'habitat');
  sound.setMuted(library.settings.muted);
  renderBuildings(); updateUI();
  if (!persistGame()) notify('This session cannot save automatically. Export a backup before leaving.', true);
  else status = game.mode === 'story' ? getMissionView(game).objective : 'Make yourself at home.';
}
function handleAction(id: string) {
  if (id === 'continue') { if (library.activeMode) start(library.activeMode); return; }
  if (id === 'begin-story') { start('story'); return; }
  if (id === 'free-build') { start('free'); return; }
  if (id === 'journey') { welcome = true; aim(null); updateUI(); return; }
  if (id === 'mute') {
    library.settings.muted = !library.settings.muted;
    sound.setMuted(library.settings.muted);
    save(); updateUI();
    if (!library.settings.muted) sound.cue();
    return;
  }
  if (id === 'motion') {
    library.settings.reducedMotion = !library.settings.reducedMotion;
    renderBuildings(); save(); updateUI(); return;
  }
  if (welcome) return;
  if (id === 'undo') { undo(); return; }
  if (id === 'plant-sunleaf' || id === 'plant-moonbloom') {
    accept(choosePlant(game, id === 'plant-sunleaf' ? 'sunleaf' : 'moonbloom')); return;
  }
  if (id === 'beacon') { accept(activateBeacon(game)); return; }
  if (id.startsWith('name-')) {
    const names: Record<string, string> = { 'name-meridian': 'New Meridian', 'name-haven': 'First Haven', 'name-starlight': 'Starlight Bay' };
    if (names[id]) accept(renameSettlement(game, names[id]), true, `${names[id]}. Your new home.`);
  }
}
function xrActions(): XRHUDAction[] {
  if (welcome) return [...welcomeActions(), { id: 'mute', label: library.settings.muted ? 'Sound off' : 'Sound on' }, { id: 'motion', label: library.settings.reducedMotion ? 'Reduced motion on' : 'Reduced motion off' }];
  const actions = getMissionView(game).action === 'name' ? [
    { id: 'name-meridian', label: 'Name: New Meridian' },
    { id: 'name-haven', label: 'Name: First Haven' },
    { id: 'name-starlight', label: 'Name: Starlight Bay' },
  ] : objectiveActions();
  return [...actions, { id: 'undo', label: 'Undo edit', disabled: history.length === 0 }, { id: 'mute', label: library.settings.muted ? 'Sound off' : 'Sound on' }, { id: 'journey', label: 'Journey / settings' }];
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
function resolveAim(ray: THREE.Raycaster): THREE.Vector3 | null {
  if (welcome) return null;
  if (mode === 'reclaim') {
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
  if (!dragged) aimPointer(event); else aim(null);
});
renderer.domElement.addEventListener('pointerup', event => {
  if (event.button === 0 && pointerDown && !dragged && performance.now() - pointerDown.time < 700) { aimPointer(event); selectSite(); }
  pointerDown = null; dragged = false;
});
renderer.domElement.addEventListener('pointerleave', () => { aim(null); pointerDown = null; });
renderer.domElement.addEventListener('pointercancel', () => { aim(null); pointerDown = null; });
for (const type of types) $(`[data-building="${type}"]`).addEventListener('click', () => selectType(type));
for (const id of ['story-choices', 'mission-actions']) $(`#${id}`).addEventListener('click', event => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
  if (target && !target.disabled) handleAction(target.dataset.action!);
});
$('#journey').addEventListener('click', () => handleAction('journey'));
$('#sound-toggle').addEventListener('click', () => handleAction('mute'));
$('#motion-toggle').addEventListener('click', () => handleAction('motion'));
$('#rotate').addEventListener('click', rotate);
$('#build-mode').addEventListener('click', () => setMode('build'));
$('#reclaim-mode').addEventListener('click', () => setMode('reclaim'));
$('#undo').addEventListener('click', undo);
$('#home-view').addEventListener('click', resetCamera);
$('#name-form').addEventListener('submit', event => {
  event.preventDefault();
  accept(renameSettlement(game, $<HTMLInputElement>('#settlement-name').value), true, 'Your home has a name. Beyond the ridge, something answers.');
});
document.addEventListener('keydown', event => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || $('#guide').hasAttribute('open') || welcome) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(); return; }
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
  const key = event.key.toLowerCase();
  if (types[Number(key) - 1]) selectType(types[Number(key) - 1]);
  if (key === 'r') rotate();
  if (key === 'd') setMode('reclaim');
  if (key === 'b') setMode('build');
});
$('#export').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([serializeGame(game)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `aurelia-${game.mode}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify('World and story backup downloaded. Keep it for your next expedition.');
});
$('#import').addEventListener('click', () => $('#world-file').click());
$('#world-file').addEventListener('change', async () => {
  const input = $<HTMLInputElement>('#world-file');
  const file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > MAX_SAVE_BYTES) throw new Error('Choose a world backup smaller than 1 MB.');
    const imported = parseGame(await file.text());
    const target = library[imported.mode];
    const explanation = persistenceBlocked
      ? 'Stored data could not be read. This import opens for this session only; the stored bytes will be kept untouched.'
      : target ? 'It replaces that mode’s saved world. Export a backup first if you want to keep both.' : 'Your other mode is kept.';
    if (!window.confirm(`Import this ${imported.mode === 'story' ? 'Story' : 'Free build'} world? ${explanation}`)) return;
    history.length = 0;
    if (target) history.push({ kind: 'import', game: target });
    game = imported; world = game.world; welcome = false;
    replaceGhost(game.mode === 'story' ? recommendedType() : 'habitat');
    mode = 'build'; hover = null;
    renderBuildings(); updateUI();
    if (persistGame()) notify('World and story restored. Welcome back.');
    else notify('World imported for this session. Export a backup; browser storage is unavailable.', true);
  } catch (error) { notify(error instanceof Error ? error.message : 'Could not load that world.', true); }
  finally { input.value = ''; }
});
const guide = $<HTMLDialogElement>('#guide');
$('#help').addEventListener('click', () => guide.showModal());
$('#close-guide').addEventListener('click', () => guide.close());
$('#guide-done').addEventListener('click', () => guide.close());
guide.addEventListener('click', event => {
  if (event.target !== guide) return;
  const bounds = guide.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) guide.close();
});

const xr = setupXR({
  renderer, scene: planet.scene, rig, camera, ground: planet.ground,
  resolveAim, onAction: handleAction,
  canTeleport: point => !world.buildings.some(building => building.x === Math.round(point.x / GRID_SIZE) && building.z === Math.round(point.z / GRID_SIZE)),
  onAim: aim, onSelect: selectSite, onCycle: cycle, onRotate: rotate,
  onMode: () => setMode(mode === 'build' ? 'reclaim' : 'build'),
  getHUD: () => {
    const view = getMissionView(game);
    return {
      title: welcome ? 'A Light in the Dark' : BUILDINGS[selected].label,
      detail: welcome ? 'Build a home, bring it to life, and send a signal into the stars.' : game.mode === 'story' ? view.detail : `${BUILDINGS[selected].cost} credits · ${rotation * 90}°`,
      objective: welcome ? (library.activeMode ? 'Continue your journey, or choose a different world.' : 'A quiet world. A new beginning.') : game.mode === 'story' ? view.objective : 'Build a world that feels like home.',
      progress: welcome ? 'CHAPTER ONE' : game.mode === 'story' ? `${view.step} / ${view.total} · A Light in the Dark` : 'FREE BUILD',
      credits: world.credits,
      status: storageHealthy || welcome ? status : 'Not saved · exit VR and export a backup', mode,
      actions: xrActions(),
    };
  },
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
    // Request directly in the click, retaining Quest's transient user activation.
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
  $('#enter-vr span').textContent = 'Exit VR'; aim(null);
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
resize(); renderBuildings(); updateUI();
$('#save-state').textContent = persistenceBlocked ? 'Export to keep this session' : library.activeMode ? 'Your saved world is ready' : 'Choose a world to begin';
const clock = new THREE.Clock();
let elapsed = 0;
const markerPosition = new THREE.Vector3();
renderer.setAnimationLoop(() => {
  const delta = Math.min(clock.getDelta(), 0.05); elapsed += delta;
  if (!renderer.xr.isPresenting) controls.update();
  xr.update(delta);
  if (!library.settings.reducedMotion) planet.update(elapsed);
  effects.update(delta, elapsed);
  const markerVisible = !welcome && !renderer.xr.isPresenting && game.mission?.arrival === 'arriving' && !!game.mission.arrivalSite;
  $('#arrival-marker').hidden = !markerVisible;
  if (markerVisible) {
    const site = game.mission!.arrivalSite!;
    markerPosition.set(site.x * GRID_SIZE, 10, site.z * GRID_SIZE).project(camera);
    $('#arrival-marker').style.left = `${THREE.MathUtils.clamp((markerPosition.x + 1) * 50, 30, 85)}%`;
    $('#arrival-marker').style.top = `${THREE.MathUtils.clamp((-markerPosition.y + 1) * 50, 18, 70)}%`;
  }
  renderer.render(planet.scene, camera);
});
