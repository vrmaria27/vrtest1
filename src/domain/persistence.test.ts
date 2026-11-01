import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalWorldRepository } from '../persistence';
import { applyCommand, createWorld } from './world';

class MemoryStorage {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
}

test('an absent local save loads as null and a placed world survives round-trip', () => {
  const storage = new MemoryStorage();
  const repository = new LocalWorldRepository(storage);
  assert.equal(repository.load(), null);
  const result = applyCommand(createWorld(), { type: 'place', id: 'saved-habitat', buildingType: 'habitat', x: 2, z: -3, rotation: 1 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  repository.save(result.world);
  assert.deepEqual(repository.load(), result.world);
  assert.equal(storage.data.has('aurelia.world.v1'), true);
});

test('a custom key isolates saves', () => {
  const storage = new MemoryStorage();
  const custom = new LocalWorldRepository(storage, 'separate.world');
  custom.save(createWorld());
  assert.deepEqual(custom.load(), createWorld());
  assert.equal(new LocalWorldRepository(storage).load(), null);
});

test('corrupt saves are reported without overwriting their original bytes', () => {
  const storage = new MemoryStorage();
  const original = '{this is corrupt';
  storage.setItem('aurelia.world.v1', original);
  assert.throws(() => new LocalWorldRepository(storage).load(), /not valid world JSON/);
  assert.equal(storage.getItem('aurelia.world.v1'), original);
});

test('save validation happens before changing a previous valid save', () => {
  const storage = new MemoryStorage();
  const repository = new LocalWorldRepository(storage);
  repository.save(createWorld());
  const original = storage.getItem('aurelia.world.v1');
  assert.throws(() => repository.save({ ...createWorld(), credits: -1 }), /Invalid credit balance/);
  assert.equal(storage.getItem('aurelia.world.v1'), original);
});

test('storage access and quota failures propagate to the application', () => {
  const accessDenied = new Error('storage access denied');
  const readBlocked = new LocalWorldRepository({
    getItem() { throw accessDenied; },
    setItem() { assert.fail('loading must not write'); },
  });
  assert.throws(() => readBlocked.load(), (error) => error === accessDenied);

  const quotaExceeded = new Error('storage quota exceeded');
  const writeBlocked = new LocalWorldRepository({
    getItem() { return null; },
    setItem() { throw quotaExceeded; },
  });
  assert.throws(() => writeBlocked.save(createWorld()), (error) => error === quotaExceeded);
});
