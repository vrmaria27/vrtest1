import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCommand, BUILDINGS, canPlace, createWorld, GRID_MAX, GRID_MIN,
  INITIAL_CREDITS, isBuildingType, MAX_SAVE_BYTES, parseWorld, serializeWorld,
  validateWorld, type CommandResult, type PlaceCommand, type World,
} from './world';

function placed(world: World, overrides: Partial<PlaceCommand> = {}): World {
  const result = applyCommand(world, { type: 'place', id: 'building-01', buildingType: 'habitat', x: 0, z: 0, rotation: 0, ...overrides });
  if (!result.ok) assert.fail(result.error);
  return result.world;
}

function rejected(result: CommandResult): void { assert.equal(result.ok, false); }

test('commands are immutable and deduct construction credits once', () => {
  const original = createWorld();
  const next = placed(original, { expectedRevision: 0 });
  assert.equal(original.buildings.length, 0);
  assert.equal(original.credits, INITIAL_CREDITS);
  assert.equal(next.buildings.length, 1);
  assert.equal(next.credits, INITIAL_CREDITS - BUILDINGS.habitat.cost);
  assert.equal(next.revision, 1);
  rejected(applyCommand(next, { type: 'place', id: 'building-01', buildingType: 'power', x: 1, z: 0, rotation: 0 }));
});

test('occupancy, arrival area, integer coordinates and world bounds are enforced', () => {
  const world = placed(createWorld());
  assert.equal(canPlace(world, 0, 0), false);
  const invalidCells = [[0, 0], [0, 4], [-1, 3], [1, 5], [GRID_MIN - 1, 0], [0, GRID_MAX + 1], [0.5, 1], [NaN, 0], [0, Infinity]];
  for (const [x, z] of invalidCells) {
    rejected(applyCommand(world, { type: 'place', id: 'new-building', buildingType: 'habitat', x, z, rotation: 0 }));
  }
  assert.equal(canPlace(world, GRID_MIN, GRID_MAX), true);
  assert.equal(canPlace(world, 2, 4), true);
});

test('construction stops at available resources and demolition refunds 75%', () => {
  let world = createWorld();
  for (let i = 0; i < 100; i++) world = placed(world, { id: `tower-${i}`, buildingType: 'tower', x: (i % 20) - 10, z: Math.floor(i / 20) - 10 });
  assert.equal(world.credits, 0);
  rejected(applyCommand(world, { type: 'place', id: 'last', buildingType: 'habitat', x: 0, z: 2, rotation: 0 }));
  const result = applyCommand(world, { type: 'remove', id: 'tower-0', expectedRevision: 100 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.world.credits, BUILDINGS.tower.cost * 0.75);
  assert.equal(result.world.buildings.length, 99);
  assert.equal(result.world.revision, 101);
  assert.equal(world.buildings.length, 100);
  assert.doesNotThrow(() => validateWorld(result.world));
});

test('stale revisions and missing removals cannot mutate a world', () => {
  const world = placed(createWorld());
  rejected(applyCommand(world, { type: 'remove', id: 'building-01', expectedRevision: 0 }));
  rejected(applyCommand(world, { type: 'remove', id: 'missing' }));
  rejected(applyCommand(world, { type: 'remove', id: 'building-01', expectedRevision: NaN }));
  assert.equal(world.buildings.length, 1);
});

test('versioned saves round-trip all building types and produce isolated data', () => {
  let world = createWorld();
  for (const [index, type] of (Object.keys(BUILDINGS) as (keyof typeof BUILDINGS)[]).entries()) {
    world = placed(world, { id: `type-${index}`, buildingType: type, x: index - 2, z: -1, rotation: (index % 4) as 0 | 1 | 2 | 3 });
  }
  const restored = parseWorld(serializeWorld(world));
  assert.deepEqual(restored, world);
  restored.buildings[0].x = 8;
  assert.equal(world.buildings[0].x, -2);
});

test('corrupt saves fail atomically without replacing the existing world', () => {
  const world = placed(createWorld());
  const before = serializeWorld(world);
  const malformed: unknown[] = [
    null, [], {}, { ...world, version: 2 }, { ...world, credits: -1 },
    { ...world, credits: INITIAL_CREDITS }, { ...world, seed: Infinity },
    { ...world, revision: 0 }, { ...world, surprise: true },
    { ...world, buildings: [...world.buildings, { ...world.buildings[0], id: 'other' }] },
    { ...world, buildings: [{ ...world.buildings[0], type: '__proto__' }] },
    { ...world, buildings: [{ ...world.buildings[0], z: 4 }] },
    { ...world, buildings: [{ ...world.buildings[0], rotation: 4 }] },
    { ...world, buildings: [{ ...world.buildings[0], id: '<script>' }] },
  ];
  for (const item of malformed) assert.throws(() => validateWorld(item));
  assert.throws(() => parseWorld('{broken json'));
  assert.throws(() => parseWorld(' '.repeat(MAX_SAVE_BYTES + 1)));
  assert.equal(serializeWorld(world), before);
});

test('hostile prototype keys never pass as catalog types', () => {
  assert.equal(isBuildingType('__proto__'), false);
  assert.equal(isBuildingType('constructor'), false);
  rejected(applyCommand(createWorld(), { type: 'place', id: 'bad', buildingType: '__proto__', x: 0, z: 0, rotation: 0 } as unknown as PlaceCommand));
});
