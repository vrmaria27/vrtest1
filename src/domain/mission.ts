import {
  applyCommand, BUILDINGS, createWorld, DEMOLITION_REFUND_RATE,
  isValidCell, MAX_BUILDINGS, MAX_SAVE_BYTES, validateWorld,
  type BuildingType, type World, type WorldCommand,
} from './world';

export type GameMode = 'story' | 'free';
export type PlantVariety = 'sunleaf' | 'moonbloom';
export const PLANTS: Record<PlantVariety, { label: string; description: string; color: string }> = {
  sunleaf: { label: 'Sunleaf', description: 'Warm amber leaves, reaching for a distant sun.', color: '#eebd63' },
  moonbloom: { label: 'Moonbloom', description: 'Cool violet flowers with a gentle glow.', color: '#b9a2f5' },
};

export interface MissionState {
  milestones: { shelter: boolean; firstLight: boolean; growing: boolean; welcome: boolean; home: boolean };
  plantChoice: PlantVariety | null;
  plantedGreenhouseIds: string[];
  arrival: 'waiting' | 'arriving' | 'arrived';
  /** Cell of the original welcome pad; retained if it is reclaimed later. */
  arrivalSite: { x: number; z: number } | null;
  named: boolean;
}

export interface GameSave {
  version: 2;
  mode: GameMode;
  world: World;
  mission: MissionState | null;
}

export type GameResult = { ok: true; game: GameSave; milestone?: string } | { ok: false; error: string };
export interface MissionView {
  title: string;
  objective: string;
  detail: string;
  step: number;
  total: number;
  unlocked: BuildingType[];
  action: 'plant' | 'beacon' | 'name' | null;
  missing: string[];
  powered: boolean;
}

const allTypes = Object.keys(BUILDINGS) as BuildingType[];
const milestoneKeys = ['shelter', 'firstLight', 'growing', 'welcome', 'home'] as const;
const failure = (error: string): GameResult => ({ ok: false, error });
const has = (game: GameSave, type: BuildingType) => game.world.buildings.some(building => building.type === type);
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const isPlant = (value: unknown): value is PlantVariety => value === 'sunleaf' || value === 'moonbloom';

export function createGame(mode: GameMode): GameSave {
  let world = createWorld();
  if (mode === 'free') {
    for (const [type, x, z] of [['habitat', -1, -1], ['habitat', 0, -1], ['power', 1, -1], ['greenhouse', -1, 0], ['tower', 1, 0], ['landing', 0, 1]] as const) {
      const result = applyCommand(world, { type: 'place', id: `outpost-${type}-${x}-${z}`, buildingType: type, x, z, rotation: 0 });
      if (!result.ok) throw new Error(result.error);
      world = result.world;
    }
    return { version: 2, mode: 'free', world, mission: null };
  }
  return {
    version: 2, mode: 'story', world,
    mission: {
      milestones: { shelter: false, firstLight: false, growing: false, welcome: false, home: false },
      plantChoice: null, plantedGreenhouseIds: [], arrival: 'waiting', arrivalSite: null, named: false,
    },
  };
}

function planted(game: GameSave): boolean {
  const mission = game.mission;
  return !!mission?.plantChoice && game.world.buildings.some(building => building.type === 'greenhouse' && mission.plantedGreenhouseIds.includes(building.id));
}

function missingPrerequisites(game: GameSave): string[] {
  const missing: string[] = [];
  if (!has(game, 'habitat')) missing.push('habitat');
  if (!has(game, 'power')) missing.push('solar array');
  if (!planted(game)) missing.push('planted greenhouse');
  if (!has(game, 'landing')) missing.push('landing pad');
  return missing;
}

/** Historical acknowledgements never disappear when a live prerequisite is removed. */
function reconcile(game: GameSave): { game: GameSave; milestone?: string } {
  const original = game.mission;
  if (!original) return { game };
  const milestones = { ...original.milestones };
  milestones.shelter ||= has(game, 'habitat');
  milestones.firstLight ||= milestones.shelter && has(game, 'habitat') && has(game, 'power');
  milestones.growing ||= milestones.firstLight && planted(game);
  milestones.welcome ||= milestones.growing && has(game, 'landing');
  milestones.home ||= original.arrival === 'arrived';
  const liveIds = new Set(game.world.buildings.filter(building => building.type === 'greenhouse').map(building => building.id));
  const mission: MissionState = { ...original, milestones, plantedGreenhouseIds: original.plantedGreenhouseIds.filter(id => liveIds.has(id)) };
  let milestone: string | undefined;
  if (!original.milestones.shelter && milestones.shelter) milestone = 'A place to begin.';
  if (!original.milestones.firstLight && milestones.firstLight) milestone = 'Your first light in a new world.';
  if (!original.milestones.growing && milestones.growing) milestone = 'You’re not the only thing growing here.';
  if (!original.milestones.welcome && milestones.welcome) milestone = 'A place to welcome someone new.';
  if (!original.milestones.home && milestones.home) milestone = 'You made a home.';
  return { game: { ...game, mission }, ...(milestone ? { milestone } : {}) };
}

export function applyGameCommand(game: GameSave, command: WorldCommand): GameResult {
  if (command.type === 'place' && !getMissionView(game).unlocked.includes(command.buildingType)) {
    return failure('This building is not available yet. Follow your current objective to unlock it.');
  }
  const result = applyCommand(game.world, command);
  if (!result.ok) return result;
  let world = result.world;
  if (game.mode === 'story' && command.type === 'remove') {
    const removed = game.world.buildings.find(building => building.id === command.id)!;
    const cost = BUILDINGS[removed.type].cost;
    // Story experimentation is lossless; the existing free-build economy remains unchanged.
    world = { ...world, credits: world.credits + cost - Math.floor(cost * DEMOLITION_REFUND_RATE) };
  }
  return { ok: true, ...reconcile({ ...game, world }) };
}

export function choosePlant(game: GameSave, variety: PlantVariety): GameResult {
  if (game.mode !== 'story' || !game.mission) return failure('Planting is part of A Light in the Dark.');
  if (!isPlant(variety)) return failure('Choose Sunleaf or Moonbloom.');
  if (!has(game, 'habitat') || !has(game, 'power')) return failure('Restore a habitat and solar array before planting. One solar array powers the whole settlement.');
  const greenhouses = game.world.buildings.filter(building => building.type === 'greenhouse');
  if (greenhouses.length === 0) return failure('Build a greenhouse before choosing its plants.');
  const ids = greenhouses.map(building => building.id);
  if (game.mission.plantChoice === variety && ids.every(id => game.mission!.plantedGreenhouseIds.includes(id))) return { ok: true, game };
  const mission: MissionState = { ...game.mission, plantChoice: variety, plantedGreenhouseIds: ids };
  return { ok: true, ...reconcile({ ...game, mission }) };
}

export function activateBeacon(game: GameSave): GameResult {
  if (game.mode !== 'story' || !game.mission) return failure('The beacon belongs to A Light in the Dark.');
  if (game.mission.arrival !== 'waiting') return failure('Your signal has already been answered.');
  const missing = missingPrerequisites(game);
  if (missing.length) return failure(`Restore your ${missing.join(', ')} before activating the beacon.`);
  // A compatible imported save may contain current prerequisites with an older
  // historical flag. Reconcile before recording arrival so the new save remains
  // internally coherent without granting currency or repeating acknowledgements.
  const prepared = reconcile(game).game;
  const pad = game.world.buildings.find(building => building.type === 'landing')!;
  return {
    ok: true,
    game: { ...prepared, mission: { ...prepared.mission!, arrival: 'arriving', arrivalSite: { x: pad.x, z: pad.z } } },
    milestone: 'Someone has heard your signal. Look for the arriving ship above your landing pad.',
  };
}

export function finishArrival(game: GameSave): GameResult {
  if (game.mode !== 'story' || !game.mission || game.mission.arrival === 'waiting') return failure('Activate the beacon to welcome your first visitor.');
  if (game.mission.arrival === 'arrived') return { ok: true, game };
  return { ok: true, ...reconcile({ ...game, mission: { ...game.mission, arrival: 'arrived' } }) };
}

export function renameSettlement(game: GameSave, name: string): GameResult {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 64 || /[\u0000-\u001f]/.test(name)) return failure('Choose a settlement name between 1 and 64 characters.');
  if (game.mode === 'story' && game.mission?.arrival !== 'arrived') return failure('Welcome your first visitor before naming your new home.');
  return {
    ok: true,
    game: { ...game, world: { ...game.world, name: name.trim() }, mission: game.mission ? { ...game.mission, named: true } : null },
  };
}

/** Restore editable state without replaying or rolling back one-time story events. */
export function undoGame(game: GameSave, previous: GameSave): GameSave {
  const world = { ...previous.world, revision: game.world.revision + 1 };
  if (game.mode !== 'story' || !game.mission || previous.mode !== 'story' || !previous.mission) return { ...previous, world };
  const liveGreenhouses = new Set(world.buildings.filter(building => building.type === 'greenhouse').map(building => building.id));
  const milestones = { ...game.mission.milestones };
  for (const key of milestoneKeys) milestones[key] ||= previous.mission.milestones[key];
  const mission: MissionState = {
    ...game.mission,
    milestones,
    plantChoice: previous.mission.plantChoice,
    plantedGreenhouseIds: previous.mission.plantedGreenhouseIds.filter(id => liveGreenhouses.has(id)),
    named: previous.mission.named,
  };
  return { ...game, world, mission };
}

export function getMissionView(game: GameSave): MissionView {
  const powered = has(game, 'power');
  if (game.mode === 'free' || !game.mission) return { title: 'Free build', objective: 'Make yourself at home.', detail: 'All buildings available. Reclaim for a 75% refund.', step: 0, total: 6, unlocked: [...allTypes], action: null, missing: [], powered };
  const mission = game.mission;
  const unlocked: BuildingType[] = ['habitat'];
  if (mission.milestones.shelter) unlocked.push('power');
  if (mission.milestones.firstLight) unlocked.push('greenhouse');
  if (mission.milestones.growing) unlocked.push('landing');
  if (mission.arrival === 'arrived') unlocked.push('tower');
  const base = { title: 'A Light in the Dark', total: 6, unlocked, powered, missing: missingPrerequisites(game) };
  const view = (step: number, objective: string, detail: string, action: MissionView['action'] = null): MissionView => ({ ...base, step, objective, detail, action });
  if (mission.arrival === 'arriving') return view(5, 'Your first visitor is arriving.', 'Look above your landing pad. You can keep looking around; the camera stays yours.');
  if (mission.arrival === 'arrived') {
    if (!mission.named) return view(6, 'You made a home.', 'Meet PIP, a friendly explorer. Name your settlement, then keep building together.', 'name');
    return view(6, 'You made a home.', 'Beyond the ridge, something answers. For now, enjoy your home and keep building.');
  }
  if (!has(game, 'habitat')) return view(1, mission.milestones.shelter ? 'Restore a habitat for your settlement.' : 'Choose a place for your first habitat.', 'Choose any clear plot inside the grid. Story buildings reclaim for a full refund.');
  if (!has(game, 'power')) return view(2, mission.milestones.firstLight ? 'Restore solar power to your home.' : 'Bring your home to life with solar power.', 'One solar array powers every habitat and greenhouse in this settlement. No wiring needed.');
  if (!has(game, 'greenhouse')) return view(3, mission.milestones.growing ? 'Restore a greenhouse for your plants.' : 'Build a greenhouse for something growing.', 'Make room for a little life beneath this alien sky.');
  if (!planted(game)) return view(3, 'Choose what will grow in your greenhouse.', 'Sunleaf glows amber. Moonbloom flowers violet. Choose either variety to plant.', 'plant');
  if (!has(game, 'landing')) return view(4, 'Prepare a landing pad for your first visitor.', 'Someone has heard your signal. Prepare a place to welcome them.');
  return view(5, 'Activate your beacon.', 'Your habitat, power, planted greenhouse and landing pad are ready. Send a signal into the stars.', 'beacon');
}

function requireKeys(record: Record<string, unknown>, keys: readonly string[], label: string) {
  if (Object.keys(record).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(record, key))) throw new Error(`Invalid ${label} fields.`);
}

/** Explicitly migrate the previous exported world into a free-build game. */
export function validateGame(value: unknown): GameSave {
  if (!isRecord(value)) throw new Error('The save must contain a game object.');
  if (value.version === 1) return { version: 2, mode: 'free', world: validateWorld(value), mission: null };
  requireKeys(value, ['version', 'mode', 'world', 'mission'], 'game');
  if (value.version !== 2) throw new Error('This save version is not supported.');
  if (value.mode !== 'free' && value.mode !== 'story') throw new Error('Invalid game mode.');
  const world = validateWorld(value.world);
  if (value.mode === 'free') {
    if (value.mission !== null) throw new Error('A free-build save must not contain story progress.');
    return { version: 2, mode: 'free', world, mission: null };
  }
  const input = value.mission;
  if (!isRecord(input)) throw new Error('A story save must contain mission progress.');
  requireKeys(input, ['milestones', 'plantChoice', 'plantedGreenhouseIds', 'arrival', 'arrivalSite', 'named'], 'mission');
  if (!isRecord(input.milestones)) throw new Error('Invalid mission milestones.');
  requireKeys(input.milestones, milestoneKeys, 'milestone');
  for (const key of milestoneKeys) if (typeof input.milestones[key] !== 'boolean') throw new Error('Invalid mission milestone.');
  const milestones = { ...input.milestones } as MissionState['milestones'];
  for (let i = 1; i < milestoneKeys.length; i++) if (milestones[milestoneKeys[i]] && !milestones[milestoneKeys[i - 1]]) throw new Error('Mission milestones are out of order.');
  // An import must be reachable through the same unlock rules as live play.
  // Otherwise its objective could ask for a building that remains locked. Keep
  // historical milestones when buildings are absent; never invent milestones
  // from an imported city's contents to repair a contradictory save silently.
  const liveTypes = new Set(world.buildings.map(building => building.type));
  if ((liveTypes.has('habitat') || liveTypes.has('power')) && !milestones.shelter) throw new Error('Existing homes or solar arrays need the shelter milestone.');
  if (liveTypes.has('habitat') && liveTypes.has('power') && !milestones.firstLight) throw new Error('A powered home needs the first light milestone.');
  if (liveTypes.has('greenhouse') && !milestones.firstLight) throw new Error('A greenhouse needs the first light unlock.');
  if (liveTypes.has('landing') && !milestones.growing) throw new Error('A landing pad needs the growing unlock.');
  if (liveTypes.has('landing') && !milestones.welcome) throw new Error('An existing landing pad needs the welcome milestone.');
  if (liveTypes.has('tower') && input.arrival !== 'arrived') throw new Error('An observatory unlocks after your first visitor arrives.');
  if (input.plantChoice !== null && !isPlant(input.plantChoice)) throw new Error('Invalid plant variety.');
  if (!Array.isArray(input.plantedGreenhouseIds) || input.plantedGreenhouseIds.length > MAX_BUILDINGS || !input.plantedGreenhouseIds.every(id => typeof id === 'string')) throw new Error('Invalid planted greenhouse collection.');
  const plantedIds = input.plantedGreenhouseIds as string[];
  const greenhouseIds = new Set(world.buildings.filter(building => building.type === 'greenhouse').map(building => building.id));
  if (new Set(plantedIds).size !== plantedIds.length || plantedIds.some(id => !greenhouseIds.has(id))) throw new Error('Plants must belong to existing greenhouses.');
  if (plantedIds.length && (!input.plantChoice || !milestones.growing)) throw new Error('Planted greenhouses need a plant variety and growing milestone.');
  if (input.arrival !== 'waiting' && input.arrival !== 'arriving' && input.arrival !== 'arrived') throw new Error('Invalid arrival status.');
  let arrivalSite: MissionState['arrivalSite'] = null;
  if (input.arrivalSite !== null) {
    if (!isRecord(input.arrivalSite)) throw new Error('Invalid arrival site.');
    requireKeys(input.arrivalSite, ['x', 'z'], 'arrival site');
    if (typeof input.arrivalSite.x !== 'number' || typeof input.arrivalSite.z !== 'number' || !isValidCell(input.arrivalSite.x, input.arrivalSite.z)) throw new Error('Invalid arrival site.');
    arrivalSite = { x: input.arrivalSite.x, z: input.arrivalSite.z };
  }
  if ((input.arrival === 'waiting') !== (arrivalSite === null)) throw new Error('Arrival status and landing site disagree.');
  if (input.arrival !== 'waiting' && !milestones.welcome) throw new Error('A visitor needs a prepared welcome milestone.');
  if (milestones.home !== (input.arrival === 'arrived')) throw new Error('Arrival and home milestone disagree.');
  if (typeof input.named !== 'boolean' || (input.named && input.arrival !== 'arrived')) throw new Error('Invalid settlement naming progress.');
  return {
    version: 2, mode: 'story', world,
    mission: { milestones, plantChoice: input.plantChoice as MissionState['plantChoice'], plantedGreenhouseIds: [...plantedIds], arrival: input.arrival, arrivalSite, named: input.named },
  };
}

export function parseGame(json: string): GameSave {
  if (typeof json !== 'string' || json.length > MAX_SAVE_BYTES || new TextEncoder().encode(json).byteLength > MAX_SAVE_BYTES) throw new Error('Save files must be smaller than 1 MB.');
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new Error('This file is not valid world JSON.'); }
  return validateGame(value);
}

export function serializeGame(game: GameSave): string {
  return JSON.stringify(validateGame(game), null, 2);
}
