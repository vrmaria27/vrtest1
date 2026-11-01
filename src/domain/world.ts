/**
 * The portable, renderer-independent city model.
 *
 * Commands are deterministic: no clocks, random IDs, browser state, or networking
 * live here. A future authoritative server can validate these same commands and
 * broadcast the accepted World revision. Local storage is only today's adapter.
 */
export const WORLD_VERSION = 1 as const;
export const GRID_SIZE = 5;
export const GRID_MIN = -10;
export const GRID_MAX = 10;
export const INITIAL_CREDITS = 24000;
export const DEMOLITION_REFUND_RATE = 0.75;
export const MAX_BUILDINGS = 432;
export const MAX_SAVE_BYTES = 1_000_000;

export const BUILDINGS = {
  habitat: { label: 'Habitat', cost: 120, color: '#7ae5db', height: 3.4, description: 'A home beneath an alien sky.' },
  power: { label: 'Solar array', cost: 180, color: '#f5c77c', height: 2.2, description: 'Harvest the light of a distant sun.' },
  greenhouse: { label: 'Greenhouse', cost: 160, color: '#a7da91', height: 3.2, description: 'Bring a little life to the frontier.' },
  tower: { label: 'Observatory', cost: 240, color: '#baa6fa', height: 7.2, description: 'Watch the skies from your new city.' },
  landing: { label: 'Landing pad', cost: 220, color: '#f8a89c', height: 0.35, description: 'A welcome for future arrivals.' },
} as const;

export type BuildingType = keyof typeof BUILDINGS;
export type QuarterTurn = 0 | 1 | 2 | 3;

export interface Building {
  id: string;
  type: BuildingType;
  /** Integer cell coordinates; multiply by GRID_SIZE for world meters. */
  x: number;
  z: number;
  rotation: QuarterTurn;
}

export interface World {
  version: typeof WORLD_VERSION;
  id: string;
  name: string;
  seed: number;
  revision: number;
  credits: number;
  buildings: Building[];
}

export interface PlaceCommand {
  type: 'place';
  /** Caller-generated stable building ID, retained in saves and future messages. */
  id: string;
  buildingType: BuildingType;
  x: number;
  z: number;
  rotation: QuarterTurn;
  expectedRevision?: number;
}

export interface RemoveCommand {
  type: 'remove';
  id: string;
  expectedRevision?: number;
}

export type WorldCommand = PlaceCommand | RemoveCommand;
export type CommandResult = { ok: true; world: World } | { ok: false; error: string };

const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value);

export function isBuildingType(value: unknown): value is BuildingType {
  return typeof value === 'string' && Object.hasOwn(BUILDINGS, value);
}

export function isReservedCell(x: number, z: number): boolean {
  // Keep a clear 15 m arrival area, including the seated/standing VR origin.
  return x >= -1 && x <= 1 && z >= 3 && z <= 5;
}

export function isValidCell(x: number, z: number): boolean {
  return isInteger(x) && isInteger(z)
    && x >= GRID_MIN && x <= GRID_MAX && z >= GRID_MIN && z <= GRID_MAX
    && !isReservedCell(x, z);
}

export function canPlace(world: World, x: number, z: number): boolean {
  return isValidCell(x, z) && !world.buildings.some((building) => building.x === x && building.z === z);
}

export function createWorld(): World {
  return {
    version: WORLD_VERSION,
    id: 'meridian-01',
    name: 'New Meridian',
    seed: 7301,
    revision: 0,
    credits: INITIAL_CREDITS,
    buildings: [],
  };
}

function failure(error: string): CommandResult {
  return { ok: false, error };
}

export function applyCommand(world: World, command: WorldCommand): CommandResult {
  // Keep runtime checks here too: future transport messages are untrusted input.
  if (!isRecord(command) || !validId(command.id)) return failure('Invalid building identifier.');
  if (command.expectedRevision !== undefined && (!isInteger(command.expectedRevision) || command.expectedRevision !== world.revision)) {
    return failure('The world has changed. Please try again.');
  }
  if (world.revision >= Number.MAX_SAFE_INTEGER - 1) return failure('World revision limit reached.');

  if (command.type === 'place') {
    if (!isBuildingType(command.buildingType)) return failure('Choose a valid building.');
    if (!isValidCell(command.x, command.z)) return failure('Choose a site inside the grid, away from the arrival area.');
    if (!isInteger(command.rotation) || command.rotation < 0 || command.rotation > 3) return failure('Invalid building rotation.');
    if (world.buildings.length >= MAX_BUILDINGS) return failure('Your settlement has reached the building limit.');
    if (world.buildings.some((building) => building.id === command.id)) return failure('This building already exists.');
    if (!canPlace(world, command.x, command.z)) return failure('There is already a building on this site.');
    const cost = BUILDINGS[command.buildingType].cost;
    if (world.credits < cost) return failure('Not enough credits. Reclaim a building to recover some credits.');

    const building: Building = {
      id: command.id,
      type: command.buildingType,
      x: command.x,
      z: command.z,
      rotation: command.rotation as QuarterTurn,
    };
    return {
      ok: true,
      world: { ...world, revision: world.revision + 1, credits: world.credits - cost, buildings: [...world.buildings, building] },
    };
  }

  if (command.type === 'remove') {
    const building = world.buildings.find((item) => item.id === command.id);
    if (!building) return failure('No building to reclaim here.');
    const refund = Math.floor(BUILDINGS[building.type].cost * DEMOLITION_REFUND_RATE);
    return {
      ok: true,
      world: {
        ...world,
        revision: world.revision + 1,
        credits: world.credits + refund,
        buildings: world.buildings.filter((item) => item.id !== command.id),
      },
    };
  }

  return failure('Unknown world command.');
}

function requireKeys(record: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(record).some((key) => !keys.includes(key)) || keys.some((key) => !Object.hasOwn(record, key))) {
    throw new Error(`Invalid ${label} fields.`);
  }
}

/** Validate and copy an untrusted save. Never partially applies a broken save. */
export function validateWorld(value: unknown): World {
  if (!isRecord(value)) throw new Error('The save must contain a world object.');
  requireKeys(value, ['version', 'id', 'name', 'seed', 'revision', 'credits', 'buildings'], 'world');
  if (value.version !== WORLD_VERSION) throw new Error('This save version is not supported.');
  if (!validId(value.id)) throw new Error('Invalid world identifier.');
  if (typeof value.name !== 'string' || value.name.trim().length === 0 || value.name.length > 64 || /[\u0000-\u001f]/.test(value.name)) {
    throw new Error('Invalid world name.');
  }
  if (!isInteger(value.seed) || value.seed < 0 || value.seed > 0xffffffff) throw new Error('Invalid planet seed.');
  if (!isInteger(value.revision) || value.revision < 0 || value.revision >= Number.MAX_SAFE_INTEGER) throw new Error('Invalid world revision.');
  if (!isInteger(value.credits) || value.credits < 0 || value.credits > INITIAL_CREDITS) throw new Error('Invalid credit balance.');
  if (!Array.isArray(value.buildings) || value.buildings.length > MAX_BUILDINGS) throw new Error('Invalid building collection.');

  const ids = new Set<string>();
  const cells = new Set<string>();
  const buildings: Building[] = [];
  let constructionCost = 0;

  for (const item of value.buildings) {
    if (!isRecord(item)) throw new Error('Invalid building record.');
    requireKeys(item, ['id', 'type', 'x', 'z', 'rotation'], 'building');
    if (!validId(item.id) || ids.has(item.id)) throw new Error('Invalid or duplicate building identifier.');
    if (!isBuildingType(item.type)) throw new Error('Invalid building type.');
    if (!isInteger(item.x) || !isInteger(item.z) || !isValidCell(item.x, item.z)) throw new Error('A building is outside the buildable area.');
    if (!isInteger(item.rotation) || item.rotation < 0 || item.rotation > 3) throw new Error('Invalid building rotation.');
    const cell = `${item.x},${item.z}`;
    if (cells.has(cell)) throw new Error('Two buildings occupy the same site.');
    ids.add(item.id);
    cells.add(cell);
    constructionCost += BUILDINGS[item.type].cost;
    buildings.push({ id: item.id, type: item.type, x: item.x, z: item.z, rotation: item.rotation as QuarterTurn });
  }

  // Demolition can consume credits, but imports may never mint new resources.
  if (value.credits + constructionCost > INITIAL_CREDITS) throw new Error('The save exceeds its starting resources.');
  if (value.revision < buildings.length) throw new Error('Invalid world revision for this settlement.');

  return {
    version: WORLD_VERSION,
    id: value.id,
    name: value.name,
    seed: value.seed,
    revision: value.revision,
    credits: value.credits,
    buildings,
  };
}

export function serializeWorld(world: World): string {
  return JSON.stringify(validateWorld(world), null, 2);
}

export function parseWorld(json: string): World {
  if (typeof json !== 'string' || json.length > MAX_SAVE_BYTES || new TextEncoder().encode(json).byteLength > MAX_SAVE_BYTES) {
    throw new Error('Save files must be smaller than 1 MB.');
  }
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error('This file is not valid world JSON.');
  }
  return validateWorld(value);
}
