import { parseWorld, serializeWorld, type World } from './domain/world';

/**
 * Persistence is separate from commands and rendering. Future hosted-world
 * repositories can implement this boundary without changing the city model.
 * Network collaboration will additionally need an async command transport and
 * authoritative server; swapping storage alone does not provide multiplayer.
 */
export interface WorldRepository {
  load(): World | null;
  save(world: World): void;
}

type WorldStorage = Pick<Storage, 'getItem' | 'setItem'>;

export class LocalWorldRepository implements WorldRepository {
  constructor(
    private readonly storage: WorldStorage,
    private readonly key = 'aurelia.world.v1',
  ) {}

  load(): World | null {
    const saved = this.storage.getItem(this.key);
    return saved === null ? null : parseWorld(saved);
  }

  save(world: World): void {
    // Validate and serialize fully before touching storage. A malformed world
    // cannot overwrite a previous valid save; storage errors reach the caller.
    const serialized = serializeWorld(world);
    this.storage.setItem(this.key, serialized);
  }
}
