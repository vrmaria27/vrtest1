import { test, expect, type Page } from '@playwright/test';
import { PerspectiveCamera, Vector3 } from 'three';
import { activateBeacon, applyGameCommand, choosePlant, createGame, finishArrival, renameSettlement, type GameResult, type GameSave } from '../src/domain/mission';
import type { GameLibrary } from '../src/game-persistence';

const key = 'aurelia.saves.v2';
const legacyKey = 'aurelia.world.v1';
async function library(page: Page): Promise<GameLibrary> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key);
}
async function story(page: Page): Promise<GameSave> {
  return (await library(page)).story!;
}
async function startStory(page: Page) {
  await page.goto('/');
  await page.locator('#story-choices [data-action="begin-story"]').click();
  await expect(page.locator('#welcome-panel')).toBeHidden();
  await expect(page.locator('#building-count')).toHaveText('0');
}
function projectCell(x: number, z: number, height = 0) {
  const camera = new PerspectiveCamera(55, 1440 / 1000, 0.1, 2200);
  camera.position.set(24, 12, 36);
  camera.lookAt(-3, 3, 0);
  camera.updateMatrixWorld();
  const point = new Vector3(x * 5, height, z * 5).project(camera);
  return { x: (point.x + 1) * 720, y: (1 - point.y) * 500 };
}
async function build(page: Page, type: string, x: number, z: number) {
  const count = (await story(page)).world.buildings.length;
  await page.locator(`[data-building="${type}"]`).click();
  const point = projectCell(x, z);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#building-count')).toHaveText(String(count + 1));
  expect((await story(page)).world.buildings.at(-1)).toMatchObject({ type, x, z });
}
async function plant(page: Page, variety = 'moonbloom') {
  await page.locator(`#mission-actions [data-action="plant-${variety}"]`).click();
  await expect(page.locator('#mission-detail')).toContainText('Someone has heard your signal');
}

// This uses the actual canvas, raycasting, UI actions and saved output. It is a
// desktop playthrough, not evidence of physical headset tracking or performance.
test('first chapter plays through building, planting, repairs, arrival and naming', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await startStory(page);
  await expect(page.locator('#mission-objective')).toHaveText('Choose a place for your first habitat.');
  await expect(page.locator('[data-building="power"]')).toBeHidden();
  await expect(page.locator('[data-building="landing"]')).toBeHidden();
  await build(page, 'habitat', 0, 0);
  await expect(page.locator('#mission-objective')).toContainText('solar power');
  await build(page, 'power', 2, 0);
  await expect(page.locator('#mission-detail')).toContainText('little life');
  await build(page, 'greenhouse', -2, 0);
  await expect(page.locator('#mission-objective')).toContainText('Choose what will grow');
  await plant(page);
  const cultivated = await story(page);
  expect(cultivated.mission?.plantChoice).toBe('moonbloom');
  expect(cultivated.mission?.plantedGreenhouseIds).toHaveLength(1);

  await page.reload();
  await page.locator('#story-choices [data-action="continue"]').click();
  expect((await story(page)).mission).toEqual(cultivated.mission);
  await build(page, 'landing', 0, -2);
  await expect(page.locator('#mission-actions [data-action="beacon"]')).toBeVisible();

  // Removing current power disables the beacon but preserves its earlier milestone.
  const beforeReclaim = (await story(page)).world.credits;
  await page.locator('#reclaim-mode').click();
  const powerPoint = projectCell(2, 0, 1.2);
  await page.mouse.click(powerPoint.x, powerPoint.y);
  await expect(page.locator('#building-count')).toHaveText('3');
  await expect(page.locator('#mission-objective')).toContainText('Restore solar power');
  await expect(page.locator('#mission-actions [data-action="beacon"]')).toBeHidden();
  expect((await story(page)).world.credits).toBe(beforeReclaim + 180);
  expect((await story(page)).mission?.milestones.firstLight).toBe(true);
  await page.locator('#undo').click();
  await expect(page.locator('#building-count')).toHaveText('4');
  expect((await story(page)).world.credits).toBe(beforeReclaim);
  await expect(page.locator('#mission-actions [data-action="beacon"]')).toBeVisible();

  await page.locator('#motion-toggle').click();
  await page.locator('#mission-actions [data-action="beacon"]').click();
  await expect.poll(async () => (await story(page)).mission?.arrival).toBe('arrived');
  await expect(page.locator('#mission-objective')).toHaveText('You made a home.');
  await page.locator('#settlement-name').fill('Starlight Haven');
  await page.locator('#settlement-name').press('Enter');
  await expect(page.locator('#mission-detail')).toContainText('Beyond the ridge, something answers.');
  const completed = await story(page);
  expect(completed.world.name).toBe('Starlight Haven');
  expect(completed.mission?.named).toBe(true);
  expect(completed.mission?.milestones.home).toBe(true);
  await expect(page.locator('[data-building="tower"]')).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('aurelia-story.json');
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual(completed);
  await page.reload();
  await page.locator('#story-choices [data-action="continue"]').click();
  expect(await story(page)).toEqual(completed);
  await expect(page.locator('#mission-actions [data-action="beacon"]')).toBeHidden();
  expect(errors).toEqual([]);
});

test('legacy Free build remains intact when starting and switching to Story', async ({ page }) => {
  const oldWorld = { ...createGame('free').world, name: 'Aster Vale' };
  const originalBytes = JSON.stringify(oldWorld, null, 2) + '\n';
  await page.addInitScript(({ legacyKey, originalBytes }) => {
    if (localStorage.getItem(legacyKey) === null) localStorage.setItem(legacyKey, originalBytes);
  }, { legacyKey, originalBytes });
  await page.goto('/');
  await expect(page.locator('#story-choices [data-action="continue"]')).toBeVisible();
  await page.locator('#story-choices [data-action="begin-story"]').click();
  await expect(page.locator('#building-count')).toHaveText('0');
  expect((await library(page)).free?.world).toEqual(oldWorld);
  expect((await story(page)).mission?.milestones.shelter).toBe(false);
  await page.locator('#journey').click();
  await page.locator('#story-choices [data-action="free-build"]').click();
  await expect(page.locator('#building-count')).toHaveText('6');
  expect((await library(page)).activeMode).toBe('free');
  expect((await library(page)).free?.world).toEqual(oldWorld);
  expect(await page.evaluate(key => localStorage.getItem(key), legacyKey)).toBe(originalBytes);
  expect((await story(page)).world.buildings).toHaveLength(0);
});

test('a versioned story import keeps its mission, settings and separate free-build world', async ({ page }) => {
  await page.goto('/');
  await page.locator('#story-choices [data-action="free-build"]').click();
  const retainedFree = (await library(page)).free;
  const accepted = (result: GameResult): GameSave => {
    if (!result.ok) throw new Error(result.error);
    return result.game;
  };
  let imported = createGame('story');
  for (const [type, x, z] of [['habitat', 0, 0], ['power', 2, 0], ['greenhouse', -2, 0]] as const) {
    imported = accepted(applyGameCommand(imported, { type: 'place', id: `imported-${type}`, buildingType: type, x, z, rotation: 0 }));
  }
  imported = accepted(choosePlant(imported, 'sunleaf'));
  imported = accepted(applyGameCommand(imported, { type: 'place', id: 'imported-pad', buildingType: 'landing', x: 0, z: -2, rotation: 0 }));
  imported = accepted(activateBeacon(imported));
  imported = accepted(finishArrival(imported));
  imported = accepted(renameSettlement(imported, 'Imported Dawn'));
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#world-file').setInputFiles({ name: 'chapter.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
  await expect(page.locator('#building-count')).toHaveText('4');
  await expect(page.locator('#mission-objective')).toHaveText('You made a home.');
  await expect(page.locator('#mission-detail')).toContainText('Beyond the ridge');
  const stored = await library(page);
  expect(stored.activeMode).toBe('story');
  expect(stored.story).toEqual(imported);
  expect(stored.free).toEqual(retainedFree);
  expect(stored.settings.muted).toBe(true);
  // Import undo restores the prior playthrough in full, including one-time
  // arrival and naming state; ordinary edit undo keeps discovery history.
  const fresh = createGame('story');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#world-file').setInputFiles({ name: 'fresh-story.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fresh)) });
  await expect(page.locator('#building-count')).toHaveText('0');
  await expect(page.locator('#mission-objective')).toHaveText('Choose a place for your first habitat.');
  await page.locator('#undo').click();
  await expect(page.locator('#building-count')).toHaveText('4');
  await expect(page.locator('#mission-detail')).toContainText('Beyond the ridge');
  const restored = await story(page);
  expect(restored.mission).toEqual(imported.mission);
  expect(restored.world.name).toBe('Imported Dawn');
  expect(restored.world.buildings).toEqual(imported.world.buildings);
  expect(restored.world.credits).toBe(imported.world.credits);
  expect(restored.world.revision).toBeGreaterThanOrEqual(imported.world.revision);
  await page.locator('#sound-toggle').click();
  expect((await library(page)).settings.muted).toBe(false);
  await page.reload();
  await page.locator('#story-choices [data-action="continue"]').click();
  expect((await library(page)).settings.muted).toBe(false);
});
