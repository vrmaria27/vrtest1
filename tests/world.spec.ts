import { test, expect, type Page } from '@playwright/test';

const key = 'aurelia.world.v1';
async function readWorld(page: Page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key);
}
async function clickEmptyGround(page: Page) {
  // Click an unoccupied plot in the real rendered/raycasted scene; no app test hooks.
  for (const point of [{x:920,y:650},{x:1060,y:750},{x:800,y:650},{x:1100,y:620},{x:850,y:760},{x:720,y:680}]) {
    const before = (await readWorld(page)).buildings.length;
    await page.locator('#viewport canvas').click({ position: point });
    if ((await readWorld(page)).buildings.length > before) return point;
  }
  throw new Error('Could not build on an empty visible plot.');
}

test('city can build, undo, reclaim, persist and export without browser errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#building-count')).toHaveText('6');
  await expect(page.locator('#credits')).toHaveText('22,960');
  const initial = await readWorld(page);
  // A roof/body hit must reclaim that building, not the terrain behind it.
  await page.locator('#reclaim-mode').click();
  await page.locator('#viewport canvas').click({ position: { x: 867, y: 488 } });
  await expect(page.locator('#building-count')).toHaveText('5');
  expect((await readWorld(page)).buildings.some((building: {type:string}) => building.type === 'tower')).toBe(false);
  await page.locator('#undo').click();
  await page.locator('#build-mode').click();
  const point = await clickEmptyGround(page);
  await expect(page.locator('#building-count')).toHaveText('7');
  await expect(page.locator('#credits')).toHaveText('22,840');
  const placed = await readWorld(page);
  expect(placed.buildings.at(-1).type).toBe('habitat');

  await page.locator('#reclaim-mode').click();
  await page.locator('#viewport canvas').click({ position: point });
  await expect(page.locator('#building-count')).toHaveText('6');
  await expect(page.locator('#credits')).toHaveText('22,930');
  await page.locator('#undo').click();
  await expect(page.locator('#building-count')).toHaveText('7');
  await expect(page.locator('#credits')).toHaveText('22,840');
  await page.locator('#undo').click();
  expect((await readWorld(page)).buildings).toEqual(initial.buildings);
  await expect(page.locator('#credits')).toHaveText('22,960');

  await page.getByRole('button', { name: /Solar array/ }).click();
  await page.keyboard.press('r');
  await clickEmptyGround(page);
  const saved = await readWorld(page);
  expect(saved.buildings.at(-1)).toMatchObject({ type: 'power', rotation: 1 });
  await page.reload();
  await expect(page.locator('#building-count')).toHaveText('7');
  expect(await readWorld(page)).toEqual(saved);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export world' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('aurelia-new-meridian.json');
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual(saved);
  expect(errors).toEqual([]);
});

test('valid backups import atomically, broken backups and corrupt local saves are preserved', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#building-count')).toHaveText('6');
  const before = await readWorld(page);
  await page.locator('#world-file').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await expect(page.locator('#toast')).toContainText('not valid world JSON');
  expect(await readWorld(page)).toEqual(before);

  const imported = {...before, buildings: [], credits: 24000, revision: 20};
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#world-file').setInputFiles({ name:'backup.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(imported)) });
  await expect(page.locator('#building-count')).toHaveText('0');
  expect(await readWorld(page)).toEqual(imported);
  await page.locator('#undo').click();
  await expect(page.locator('#building-count')).toHaveText('6');

  await page.evaluate(key => localStorage.setItem(key, '{my original corrupted save'), key);
  await page.reload();
  await expect(page.locator('#save-state')).toContainText('Export');
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe('{my original corrupted save');
});

test('VR fallback explains Quest access; compact view keeps construction controls usable', async ({ page }) => {
  await page.goto('/');
  await page.locator('#enter-vr').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('#guide')).toContainText('Meta Quest 3 / 3S');
  await expect(page.locator('#vr-diagnostic')).toContainText('unavailable');
  await page.locator('#guide-done').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: /Greenhouse/ })).toBeVisible();
  await page.getByRole('button', { name: /Greenhouse/ }).click();
  await expect(page.getByRole('button', { name: /Greenhouse/ })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('a failed browser save stays visible after a successful building action', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Storage quota exceeded', 'QuotaExceededError'); };
  });
  await page.goto('/');
  await expect(page.locator('#building-count')).toHaveText('6');
  await page.locator('#viewport canvas').click({ position: { x: 920, y: 650 } });
  await expect(page.locator('#building-count')).toHaveText('7');
  await expect(page.locator('#save-state')).toContainText('Save failed');
  await expect(page.locator('#toast')).toContainText('only in this session');
});
