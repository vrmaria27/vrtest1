import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, BUILDINGS, createWorld, INITIAL_CREDITS, type BuildingType } from './world';
import {
  activateBeacon, applyGameCommand, choosePlant, createGame, finishArrival,
  getMissionView, parseGame, renameSettlement, serializeGame, undoGame, validateGame,
  type GameResult, type GameSave,
} from './mission';

function accepted(result: GameResult): GameSave {
  if (!result.ok) assert.fail(result.error);
  return result.game;
}
function place(game: GameSave, type: BuildingType, x: number, id = type): GameSave {
  return accepted(applyGameCommand(game, { type: 'place', id, buildingType: type, x, z: -2, rotation: 0, expectedRevision: game.world.revision }));
}
function plantedGame(): GameSave {
  let game = createGame('story');
  game = place(game, 'habitat', -2);
  game = place(game, 'power', -1);
  game = place(game, 'greenhouse', 0);
  return accepted(choosePlant(game, 'moonbloom'));
}
function readyGame(): GameSave { return place(plantedGame(), 'landing', 1); }

test('story starts clear with only habitat; existing starter cities remain free build', () => {
  const story = createGame('story');
  assert.equal(story.world.buildings.length, 0);
  assert.equal(story.world.credits, INITIAL_CREDITS);
  assert.deepEqual(getMissionView(story).unlocked, ['habitat']);
  assert.match(getMissionView(story).objective, /first habitat/);
  const free = createGame('free');
  assert.equal(free.world.buildings.length, 6);
  assert.equal(free.world.credits, INITIAL_CREDITS - 1040);
  assert.equal(free.mission, null);
  assert.equal(getMissionView(free).unlocked.length, 5);
});

test('story progressively unlocks first light, growing, welcome and a home', () => {
  let game = createGame('story');
  assert.equal(applyGameCommand(game, { type: 'place', id: 'early-pad', buildingType: 'landing', x: 0, z: 0, rotation: 0 }).ok, false);
  const shelter = applyGameCommand(game, { type: 'place', id: 'habitat', buildingType: 'habitat', x: -2, z: -2, rotation: 0 });
  assert.equal(shelter.ok && shelter.milestone, 'A place to begin.');
  game = accepted(shelter);
  assert.deepEqual(getMissionView(game).unlocked, ['habitat', 'power']);
  game = place(game, 'power', -1);
  assert.equal(getMissionView(game).powered, true);
  assert.equal(game.mission?.milestones.firstLight, true);
  game = place(game, 'greenhouse', 0);
  assert.equal(getMissionView(game).action, 'plant');
  game = accepted(choosePlant(game, 'sunleaf'));
  assert.equal(game.mission?.plantChoice, 'sunleaf');
  assert.equal(game.mission?.milestones.growing, true);
  assert.ok(getMissionView(game).unlocked.includes('landing'));
  game = place(game, 'landing', 1);
  assert.equal(getMissionView(game).action, 'beacon');
  game = accepted(activateBeacon(game));
  assert.equal(game.mission?.arrival, 'arriving');
  assert.deepEqual(game.mission?.arrivalSite, { x: 1, z: -2 });
  game = accepted(finishArrival(game));
  assert.equal(game.mission?.milestones.home, true);
  assert.equal(getMissionView(game).action, 'name');
  assert.ok(getMissionView(game).unlocked.includes('tower'));
  game = accepted(renameSettlement(game, '  Brightwater  '));
  assert.equal(game.world.name, 'Brightwater');
  assert.equal(getMissionView(game).action, null);
  assert.match(getMissionView(game).detail, /Beyond the ridge/);
});

test('story reclamation is lossless, free build keeps its original economy', () => {
  let story = place(createGame('story'), 'habitat', -2);
  for (let i = 0; i < 5; i++) {
    story = accepted(applyGameCommand(story, { type: 'remove', id: 'habitat' }));
    assert.equal(story.world.credits, INITIAL_CREDITS);
    story = place(story, 'habitat', -2);
  }
  assert.equal(story.world.credits + BUILDINGS.habitat.cost, INITIAL_CREDITS);
  let free = createGame('free');
  const balance = free.world.credits;
  free = accepted(applyGameCommand(free, { type: 'remove', id: 'outpost-habitat--1--1' }));
  assert.equal(free.world.credits, balance + BUILDINGS.habitat.cost * 0.75);
});

test('beacon checks current prerequisites after reclaim and explains restoration', () => {
  const ready = readyGame();
  for (const id of ['habitat', 'power', 'greenhouse', 'landing']) {
    const game = accepted(applyGameCommand(ready, { type: 'remove', id }));
    const result = activateBeacon(game);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /Restore/);
    assert.notEqual(getMissionView(game).action, 'beacon');
    assert.equal(game.mission?.milestones.welcome, true);
  }
});

test('undo preserves milestones, restores reclaimed plants and never rewinds arrival', () => {
  const growing = plantedGame();
  const removed = accepted(applyGameCommand(growing, { type: 'remove', id: 'greenhouse' }));
  const undone = undoGame(removed, growing);
  assert.deepEqual(undone.mission?.plantedGreenhouseIds, ['greenhouse']);
  assert.equal(undone.world.revision, removed.world.revision + 1);
  const unplanted = { ...growing, mission: { ...growing.mission!, plantChoice: null, plantedGreenhouseIds: [] } };
  const undoPlant = undoGame(growing, unplanted);
  assert.equal(undoPlant.mission?.milestones.growing, true);
  assert.equal(getMissionView(undoPlant).action, 'plant');
  const replanted = choosePlant(undoPlant, 'moonbloom');
  assert.ok(replanted.ok);
  if (replanted.ok) assert.equal(replanted.milestone, undefined);

  const ready = readyGame();
  const arriving = accepted(activateBeacon(ready));
  const arrivalUndo = undoGame(arriving, ready);
  assert.equal(arrivalUndo.mission?.arrival, 'arriving');
  assert.deepEqual(arrivalUndo.mission?.arrivalSite, arriving.mission?.arrivalSite);
  assert.doesNotThrow(() => validateGame(arrivalUndo));
});

test('replaying milestones, beacon activation and arrival cannot duplicate rewards', () => {
  const ready = readyGame();
  const duplicatePlant = choosePlant(ready, 'moonbloom');
  assert.ok(duplicatePlant.ok);
  if (duplicatePlant.ok) assert.equal(duplicatePlant.milestone, undefined);
  const arriving = accepted(activateBeacon(ready));
  assert.equal(activateBeacon(arriving).ok, false);
  const arrived = accepted(finishArrival(arriving));
  const duplicateArrival = finishArrival(arrived);
  assert.ok(duplicateArrival.ok);
  if (duplicateArrival.ok) {
    assert.equal(duplicateArrival.milestone, undefined);
    assert.equal(duplicateArrival.game, arrived);
  }
  assert.equal(arrived.world.credits, ready.world.credits);
  assert.equal(arrived.world.buildings.length, ready.world.buildings.length);
});

test('legacy version-one saves explicitly migrate to free build without story completion', () => {
  const legacy = createGame('free').world;
  const migrated = parseGame(JSON.stringify(legacy));
  assert.equal(migrated.version, 2);
  assert.equal(migrated.mode, 'free');
  assert.equal(migrated.mission, null);
  assert.deepEqual(migrated.world, legacy);
  assert.deepEqual(legacy, createGame('free').world);
});

test('exports retain plant choice, arrival, name and progress through reload/import', () => {
  const ready = readyGame();
  const arriving = accepted(activateBeacon(ready));
  const restored = parseGame(serializeGame(arriving));
  assert.deepEqual(restored, arriving);
  const home = accepted(renameSettlement(accepted(finishArrival(restored)), 'Lantern Bay'));
  assert.deepEqual(parseGame(serializeGame(home)), home);
  const padRemoved = accepted(applyGameCommand(home, { type: 'remove', id: 'landing' }));
  assert.equal(padRemoved.mission?.arrival, 'arrived');
  assert.deepEqual(padRemoved.mission?.arrivalSite, { x: 1, z: -2 });
  assert.deepEqual(parseGame(serializeGame(padRemoved)), padRemoved);
});

test('invalid game imports fail atomically and reject incoherent mission state', () => {
  const game = readyGame();
  const before = serializeGame(game);
  const invalid: unknown[] = [
    null, [], {}, { ...game, version: 3 }, { ...game, mode: 'multiplayer' },
    { ...game, mission: null }, { ...game, extra: true },
    { ...game, mode: 'free' }, { ...game, mission: { ...game.mission!, plantChoice: 'bad' } },
    { ...game, mission: { ...game.mission!, plantedGreenhouseIds: ['habitat'] } },
    { ...game, mission: { ...game.mission!, plantedGreenhouseIds: ['greenhouse', 'greenhouse'] } },
    { ...game, mission: { ...game.mission!, arrival: 'arrived' } },
    { ...game, mission: { ...game.mission!, named: true } },
    { ...game, mission: { ...game.mission!, milestones: { ...game.mission!.milestones, firstLight: false } } },
  ];
  for (const value of invalid) assert.throws(() => validateGame(value));
  assert.throws(() => parseGame('{broken'));
  assert.throws(() => parseGame(' '.repeat(1_000_001)));
  assert.equal(serializeGame(game), before);
});

test('naming is deliberate, validated, and unavailable before the first visitor', () => {
  assert.equal(renameSettlement(createGame('story'), 'Too soon').ok, false);
  const home = accepted(finishArrival(accepted(activateBeacon(readyGame()))));
  for (const name of ['', '  ', 'a'.repeat(65), 'bad\nname']) assert.equal(renameSettlement(home, name).ok, false);
  assert.equal(renameSettlement(home, '<My home>').ok, true);
  assert.equal(choosePlant(createGame('free'), 'sunleaf').ok, false);
  assert.equal(finishArrival(createGame('story')).ok, false);
  assert.deepEqual(validateGame(createWorld()), { version: 2, mode: 'free', world: createWorld(), mission: null });
});

test('contradictory imported buildings cannot create locked-objective softlocks', () => {
  function unchecked(types: BuildingType[], milestones = createGame('story').mission!.milestones): GameSave {
    const game = createGame('story');
    for (const [x, type] of types.entries()) {
      const result = applyCommand(game.world, { type: 'place', id: `unchecked-${type}`, buildingType: type, x, z: -2, rotation: 0 });
      if (!result.ok) assert.fail(result.error);
      game.world = result.world;
    }
    game.mission = { ...game.mission!, milestones: { ...milestones } };
    return game;
  }
  const fresh = createGame('story').mission!.milestones;
  const shelter = { ...fresh, shelter: true };
  const firstLight = { ...shelter, firstLight: true };
  const growing = { ...firstLight, growing: true };
  const welcome = { ...growing, welcome: true };
  const invalid = [
    unchecked(['habitat']), // Previously asked for power while power was locked.
    unchecked(['power']),
    unchecked(['habitat', 'power'], shelter),
    unchecked(['greenhouse'], shelter),
    unchecked(['landing'], firstLight),
    unchecked(['landing'], growing),
    unchecked(['tower'], welcome),
  ];
  for (const game of invalid) {
    const original = JSON.stringify(game);
    assert.throws(() => parseGame(original));
    assert.equal(JSON.stringify(game), original, 'validation must not auto-complete or mutate the imported journey');
  }
});

test('live unlock validation still accepts reclaimed worlds and historical undo progress', () => {
  const initial = createGame('story');
  const firstHome = place(initial, 'habitat', -2);
  let undone = undoGame(firstHome, initial);
  assert.equal(undone.mission!.milestones.shelter, true);
  assert.equal(undone.world.buildings.length, 0);
  assert.doesNotThrow(() => validateGame(undone));
  undone = place(undone, 'power', -1);
  assert.equal(undone.mission!.milestones.firstLight, false);
  assert.doesNotThrow(() => validateGame(undone), 'a previously unlocked solar array may exist while a habitat needs restoring');
  undone = place(undone, 'habitat', -2);
  assert.equal(undone.mission!.milestones.firstLight, true);
  assert.doesNotThrow(() => validateGame(undone));

  let home = accepted(finishArrival(accepted(activateBeacon(readyGame()))));
  home = place(home, 'tower', 2);
  assert.doesNotThrow(() => validateGame(home));
  for (const building of [...home.world.buildings]) {
    const previous = home;
    home = accepted(applyGameCommand(home, { type: 'remove', id: building.id }));
    assert.doesNotThrow(() => validateGame(home));
    assert.doesNotThrow(() => validateGame(undoGame(home, previous)));
  }
  assert.equal(home.world.buildings.length, 0);
  assert.equal(home.mission!.arrival, 'arrived');
  assert.equal(home.mission!.milestones.home, true);
});
