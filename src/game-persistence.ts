import { parseGame, validateGame, type GameSave } from './domain/mission';
import { MAX_SAVE_BYTES } from './domain/world';

export interface GameLibrary {
  version: 2;
  activeMode: 'story' | 'free' | null;
  story: GameSave | null;
  free: GameSave | null;
  settings: {
    muted: boolean;
    reducedMotion: boolean;
  };
}

type GameStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function createLibrary(): GameLibrary {
  return {
    version: 2,
    activeMode: null,
    story: null,
    free: null,
    settings: { muted: true, reducedMotion: false },
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(value, key))) {
    throw new Error(`Invalid ${label} fields.`);
  }
}

/** Copy and validate both slots before allowing any stored settlement to change. */
export function validateLibrary(value: unknown): GameLibrary {
  if (!record(value)) throw new Error('The save library must be an object.');
  requireKeys(value, ['version', 'activeMode', 'story', 'free', 'settings'], 'save library');
  if (value.version !== 2) throw new Error('This save library version is not supported.');
  if (value.activeMode !== null && value.activeMode !== 'story' && value.activeMode !== 'free') {
    throw new Error('Invalid active save mode.');
  }
  const story = value.story === null ? null : validateGame(value.story);
  const free = value.free === null ? null : validateGame(value.free);
  if (story && story.mode !== 'story') throw new Error('The story slot must contain a story world.');
  if (free && free.mode !== 'free') throw new Error('The free-build slot must contain a free-build world.');
  if (value.activeMode === 'story' && !story || value.activeMode === 'free' && !free) {
    throw new Error('The active settlement is missing.');
  }
  if (!record(value.settings)) throw new Error('Invalid save settings.');
  requireKeys(value.settings, ['muted', 'reducedMotion'], 'save settings');
  if (typeof value.settings.muted !== 'boolean' || typeof value.settings.reducedMotion !== 'boolean') {
    throw new Error('Save settings must be booleans.');
  }
  return {
    version: 2,
    activeMode: value.activeMode,
    story,
    free,
    settings: { muted: value.settings.muted, reducedMotion: value.settings.reducedMotion },
  };
}

function checkSize(json: string): void {
  if (json.length > MAX_SAVE_BYTES || new TextEncoder().encode(json).byteLength > MAX_SAVE_BYTES) {
    throw new Error('Save libraries must be smaller than 1 MB.');
  }
}

export function serializeLibrary(library: GameLibrary): string {
  const json = JSON.stringify(validateLibrary(library));
  checkSize(json);
  return json;
}

export function parseLibrary(json: string): GameLibrary {
  checkSize(json);
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error('This is not a valid save library.');
  }
  return validateLibrary(value);
}

/**
 * Story and Free build have independent slots. A single setItem keeps slot and
 * active-mode changes together. Failed reads or writes reach the caller; a bad
 * newer save never silently falls back to an older world and overwrites it.
 */
export class LocalGameRepository {
  constructor(
    private readonly storage: GameStorage,
    private readonly key = 'aurelia.saves.v2',
    private readonly legacyKey = 'aurelia.world.v1',
  ) {}

  load(): GameLibrary {
    const saved = this.storage.getItem(this.key);
    if (saved !== null) return parseLibrary(saved);

    const library = createLibrary();
    const legacy = this.storage.getItem(this.legacyKey);
    if (legacy !== null) {
      const migrated = parseGame(legacy);
      if (migrated.mode !== 'free') throw new Error('The legacy slot must contain a free-build world.');
      library.free = migrated;
      library.activeMode = 'free';
    }
    // Loading is deliberately read-only, including successful legacy migration.
    return library;
  }

  save(library: GameLibrary): void {
    const serialized = serializeLibrary(library);
    this.storage.setItem(this.key, serialized);
  }
}
