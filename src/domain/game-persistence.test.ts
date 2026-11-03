import test from 'node:test';
import assert from 'node:assert/strict';
import { createLibrary, LocalGameRepository, parseLibrary, serializeLibrary, validateLibrary } from '../game-persistence';
import { activateBeacon, applyGameCommand, choosePlant, createGame, finishArrival, renameSettlement, type GameSave } from './mission';
import { createWorld, serializeWorld, MAX_SAVE_BYTES, type BuildingType } from './world';

class MemoryStorage {
  readonly data = new Map<string, string>();
  readonly writes: Array<{ key: string; value: string }> = [];
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void {
    this.writes.push({ key, value });
    this.data.set(key, value);
  }
}

function storyWithCompanion(): GameSave {
  let game = createGame('story');
  const place = (type: BuildingType, x: number) => {
    const result = applyGameCommand(game, { type: 'place', id: `mission-${type}`, buildingType: type, x, z: -2, rotation: 0 });
    if (!result.ok) assert.fail(result.error);
    game = result.game;
  };
  place('habitat', -2);
  place('power', -1);
  place('greenhouse', 0);
  const planted = choosePlant(game, 'moonbloom');
  if (!planted.ok) assert.fail(planted.error);
  game = planted.game;
  place('landing', 1);
  const beacon = activateBeacon(game);
  if (!beacon.ok) assert.fail(beacon.error);
  const arrival = finishArrival(beacon.game);
  if (!arrival.ok) assert.fail(arrival.error);
  const named = renameSettlement(arrival.game, 'Quiet Harbor');
  if (!named.ok) assert.fail(named.error);
  return named.game;
}

test('a missing library is empty and loading never writes', () => {
  const storage = new MemoryStorage();
  const repository = new LocalGameRepository(storage);
  assert.deepEqual(repository.load(), createLibrary());
  assert.equal(storage.writes.length, 0);
});

test('legacy version-1 saves migrate into Free build without changing their original bytes', () => {
  const storage = new MemoryStorage();
  const legacy = serializeWorld(createWorld());
  storage.data.set('aurelia.world.v1', legacy);
  const repository = new LocalGameRepository(storage);
  const migrated = repository.load();
  assert.equal(migrated.activeMode, 'free');
  assert.equal(migrated.free?.mode, 'free');
  assert.deepEqual(migrated.free?.world, createWorld());
  assert.equal(migrated.story, null);
  assert.equal(storage.writes.length, 0);
  assert.equal(storage.getItem('aurelia.world.v1'), legacy);

  migrated.story = createGame('story');
  migrated.activeMode = 'story';
  repository.save(migrated);
  assert.equal(storage.writes.length, 1);
  assert.equal(storage.writes[0].key, 'aurelia.saves.v2');
  assert.equal(storage.getItem('aurelia.world.v1'), legacy);
  assert.deepEqual(repository.load().free, migrated.free);
});

test('story, milestones, plants, name, visitor and settings round-trip beside an unchanged free world', () => {
  const storage = new MemoryStorage();
  const repository = new LocalGameRepository(storage);
  const library = createLibrary();
  library.story = storyWithCompanion();
  library.free = createGame('free');
  library.activeMode = 'story';
  library.settings = { muted: false, reducedMotion: true };
  repository.save(library);
  const restored = repository.load();
  assert.deepEqual(restored, library);
  assert.equal(restored.story?.mission?.arrival, 'arrived');
  assert.equal(restored.story?.mission?.plantChoice, 'moonbloom');
  assert.equal(restored.story?.world.name, 'Quiet Harbor');
  assert.deepEqual(parseLibrary(serializeLibrary(restored)), restored);

  restored.activeMode = 'free';
  repository.save(restored);
  assert.deepEqual(repository.load().story, library.story);
  assert.deepEqual(repository.load().free, library.free);
});

test('a malformed new library is reported instead of falling back to or changing the legacy save', () => {
  const storage = new MemoryStorage();
  storage.data.set('aurelia.world.v1', serializeWorld(createWorld()));
  const malformed = '{unfinished newer data';
  storage.data.set('aurelia.saves.v2', malformed);
  assert.throws(() => new LocalGameRepository(storage).load(), /not a valid save library/);
  assert.equal(storage.getItem('aurelia.saves.v2'), malformed);
  assert.equal(storage.writes.length, 0);
});

test('a bad slot, mode, setting, active pointer or unknown field cannot replace a valid library', () => {
  const storage = new MemoryStorage();
  const repository = new LocalGameRepository(storage);
  const valid = { ...createLibrary(), story: createGame('story'), activeMode: 'story' as const };
  repository.save(valid);
  const before = storage.getItem('aurelia.saves.v2');
  const invalid = [
    { ...valid, version: 3 },
    { ...valid, story: createGame('free') },
    { ...valid, free: createGame('story') },
    { ...valid, activeMode: 'unknown' },
    { ...valid, activeMode: 'free' },
    { ...valid, story: null },
    { ...valid, settings: { muted: 'yes', reducedMotion: false } },
    { ...valid, settings: { muted: true, reducedMotion: false, extra: true } },
    { ...valid, extra: true },
    { ...valid, story: { ...valid.story, world: { ...valid.story.world, credits: -1 } } },
  ];
  for (const value of invalid) assert.throws(() => repository.save(value as typeof valid));
  assert.equal(storage.getItem('aurelia.saves.v2'), before);
  assert.equal(storage.writes.length, 1);
  assert.throws(() => parseLibrary(' '.repeat(MAX_SAVE_BYTES + 1)), /smaller than 1 MB/);
  assert.throws(() => parseLibrary(`"${'🌱'.repeat(MAX_SAVE_BYTES / 3)}"`), /smaller than 1 MB/);
});

test('validated libraries are isolated copies and custom keys are respected', () => {
  const library = { ...createLibrary(), free: createGame('free'), activeMode: 'free' as const };
  const validated = validateLibrary(library);
  validated.free!.world.name = 'Changed Copy';
  validated.settings.muted = false;
  assert.notEqual(library.free.world.name, validated.free!.world.name);
  assert.equal(library.settings.muted, true);
  const storage = new MemoryStorage();
  const custom = new LocalGameRepository(storage, 'custom.saves', 'custom.legacy');
  custom.save(library);
  assert.deepEqual(custom.load(), library);
  assert.equal(storage.getItem('aurelia.saves.v2'), null);
});

test('read and quota failures propagate without touching either slot or the legacy key', () => {
  const denied = new Error('Storage is blocked');
  const readBlocked = new LocalGameRepository({
    getItem() { throw denied; },
    setItem() { assert.fail('a load must never write'); },
  });
  assert.throws(() => readBlocked.load(), error => error === denied);
  const quota = new Error('Storage quota exceeded');
  let writeAttempts = 0;
  const writeBlocked = new LocalGameRepository({
    getItem() { return null; },
    setItem() { writeAttempts++; throw quota; },
  });
  assert.throws(() => writeBlocked.save(createLibrary()), error => error === quota);
  assert.equal(writeAttempts, 1);
});
