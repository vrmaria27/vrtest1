import { test, expect, type Page } from '@playwright/test';
import { PerspectiveCamera, Vector3 } from 'three';
import type { GameSave } from '../src/domain/mission';
import type { GameLibrary } from '../src/game-persistence';

const key = 'aurelia.saves.v2';
async function readGame(page: Page): Promise<GameSave> {
  return page.evaluate(key => {
    const library = JSON.parse(localStorage.getItem(key)!) as GameLibrary;
    return library[library.activeMode!]!;
  }, key);
}
async function freeBuild(page: Page) {
  await page.goto('/');
  await page.locator('#story-choices [data-action="free-build"]').click();
  await expect(page.locator('#welcome-panel')).toBeHidden();
}
function project(x: number, y: number, z: number) {
  const camera = new PerspectiveCamera(55, 1440 / 1000, 0.1, 2200);
  camera.position.set(24, 12, 36);
  camera.lookAt(-3, 3, 0);
  camera.updateMatrixWorld();
  const point = new Vector3(x, y, z).project(camera);
  return { x: (point.x + 1) * 720, y: (1 - point.y) * 500 };
}
async function clickPlot(page: Page, x: number, z: number, height = 0) {
  const point = project(x * 5, height, z * 5);
  await page.mouse.click(point.x, point.y);
}
async function downloadGame(page: Page): Promise<GameSave> {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export world' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('aurelia-free.json');
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString()) as GameSave;
}

test('free build keeps construction, roof selection, economy, undo, persistence and export', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await freeBuild(page);
  await expect(page.locator('#building-count')).toHaveText('6');
  await expect(page.locator('#credits')).toHaveText('22,960');
  await expect(page.locator('#mission-panel')).toBeHidden();
  const initial = await readGame(page);

  // Pick the observatory's visible body, rather than its original ground point.
  await page.locator('#reclaim-mode').click();
  await clickPlot(page, 1, 0, 4.5);
  await expect(page.locator('#building-count')).toHaveText('5');
  expect((await readGame(page)).world.buildings.some(building => building.type === 'tower')).toBe(false);
  await page.locator('#undo').click();
  await page.locator('#build-mode').click();
  await clickPlot(page, 3, 0);
  await expect(page.locator('#building-count')).toHaveText('7');
  await expect(page.locator('#credits')).toHaveText('22,840');
  expect((await readGame(page)).world.buildings.at(-1)?.type).toBe('habitat');

  await page.locator('#reclaim-mode').click();
  await clickPlot(page, 3, 0, 1.2);
  await expect(page.locator('#building-count')).toHaveText('6');
  await expect(page.locator('#credits')).toHaveText('22,930');
  await page.locator('#undo').click();
  await expect(page.locator('#building-count')).toHaveText('7');
  await page.locator('#undo').click();
  expect((await readGame(page)).world.buildings).toEqual(initial.world.buildings);
  await expect(page.locator('#credits')).toHaveText('22,960');

  await page.locator('[data-building="power"]').click();
  await page.keyboard.press('r');
  await clickPlot(page, 3, 0);
  const saved = await readGame(page);
  expect(saved.world.buildings.at(-1)).toMatchObject({ type: 'power', rotation: 1 });
  await page.reload();
  await expect(page.locator('#story-choices [data-action="continue"]')).toBeVisible();
  await page.locator('#story-choices [data-action="continue"]').click();
  await expect(page.locator('#building-count')).toHaveText('7');
  expect(await readGame(page)).toEqual(saved);
  expect(await downloadGame(page)).toEqual(saved);
  expect(errors).toEqual([]);
});

test('backups import atomically and corrupt saved bytes are preserved', async ({ page }) => {
  await freeBuild(page);
  const before = await readGame(page);
  await page.locator('#world-file').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await expect(page.locator('#toast')).toContainText('not valid world JSON');
  expect(await readGame(page)).toEqual(before);

  const imported: GameSave = { ...before, world: { ...before.world, buildings: [], credits: 24000, revision: 20 } };
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#world-file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
  await expect(page.locator('#building-count')).toHaveText('0');
  expect(await readGame(page)).toEqual(imported);
  await page.locator('#undo').click();
  await expect(page.locator('#building-count')).toHaveText('6');

  const corrupt = '{my original corrupted save';
  await page.evaluate(({ key, corrupt }) => localStorage.setItem(key, corrupt), { key, corrupt });
  await page.reload();
  await expect(page.locator('#save-state')).toContainText('Export');
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(corrupt);
  // A valid import can be played, but must not erase an unreadable save library.
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#world-file').setInputFiles({ name: 'session-only.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(before)) });
  await expect(page.locator('#building-count')).toHaveText('6');
  await expect(page.locator('#save-state')).toContainText('Export');
  await expect(page.locator('#toast')).toContainText('for this session');
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(corrupt);
});

test('VR fallback explains Quest access and compact controls stay usable', async ({ page }) => {
  await freeBuild(page);
  await page.locator('#enter-vr').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('#guide')).toContainText('Meta Quest 3 / 3S');
  await expect(page.locator('#vr-diagnostic')).toContainText('unavailable');
  await page.locator('#guide-done').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('[data-building="greenhouse"]')).toBeVisible();
  await page.locator('[data-building="greenhouse"]').click();
  await expect(page.locator('[data-building="greenhouse"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('failed saves remain visible after a successful building action', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Storage quota exceeded', 'QuotaExceededError'); };
  });
  await freeBuild(page);
  await expect(page.locator('#building-count')).toHaveText('6');
  await clickPlot(page, 3, 0);
  await expect(page.locator('#building-count')).toHaveText('7');
  await expect(page.locator('#save-state')).toContainText('Save failed');
  await expect(page.locator('#toast')).toContainText('only in this session');
});
