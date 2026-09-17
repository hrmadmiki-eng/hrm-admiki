import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

export async function verifySearchStability(page) {
  const base = process.env.CLIENT_URL;
  await page.goto(`${base}/attendance`);
  const input = page.getByRole('combobox', { name: 'Employee', exact: true });
  await input.waitFor();
  const requests = [];
  const route = async (route) => {
    requests.push(new URL(route.request().url()).searchParams.get('search'));
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.continue().catch(() => {});
  };
  await page.route('**/api/employees?**', route);
  await input.click();
  await page.waitForTimeout(450);
  await expect(page.getByRole('listbox')).toHaveCount(0);
  assert.equal(requests.length, 0, 'Focus must not request suggestions');
  const before = await input.boundingBox();
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  await input.pressSequentially('J', { delay: 30 });
  await expect(page.getByRole('listbox')).toBeVisible();
  const loadingBox = await page.getByRole('listbox').boundingBox();
  await expect(page.getByRole('option', { name: /Jamie Wilson/ })).toBeVisible();
  assert.deepEqual(requests, ['J'], 'One character triggers one request');
  const loadedBox = await page.getByRole('listbox').boundingBox();
  assert.deepEqual(loadedBox, loadingBox, 'Dropdown dimensions remain stable');
  assert.deepEqual(await input.boundingBox(), before, 'Input does not move');
  assert.equal(await page.evaluate(() => document.documentElement.clientWidth), width);
  await input.click();
  await input.pressSequentially('amie', { delay: 30 });
  await expect(input).toHaveValue('Jamie');
  await expect(page.getByRole('option', { name: /Jamie Wilson/ })).toBeVisible();
  assert.deepEqual(requests, ['J', 'Jamie'], 'Rapid typing is debounced');
  await input.fill('Sarah');
  await page.waitForTimeout(350);
  await input.fill('');
  await page.waitForTimeout(550);
  await expect(page.getByRole('listbox')).toHaveCount(0);
  assert.ok(!requests.includes(''), 'Clearing must never fetch all employees as suggestions');
  await input.fill('Jamie');
  await expect(page.getByRole('option', { name: /Jamie Wilson/ })).toBeVisible();
  await input.press('Escape');
  await input.blur();
  await input.click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  const count = requests.length;
  await page.waitForTimeout(400);
  assert.equal(requests.length, count, 'Refocus does not request suggestions');
  await input.fill('Jamie');
  await page.getByRole('option', { name: /Jamie Wilson/ }).click();
  await expect(input).toHaveValue(/Jamie Wilson.*1003/);
  await page.waitForTimeout(400);
  assert.equal(
    requests.filter((query) => query === null).length,
    0,
    'Selecting an existing result needs no extra name lookup',
  );
  await page.unroute('**/api/employees?**', route);

  await page.goto(`${base}/employees`);
  await expect(page.locator('tbody tr')).toHaveCount(3);
  const table = page.getByRole('table');
  const tableBox = await table.locator('..').boundingBox();
  const search = page.getByLabel('Search employees');
  await page.route('**/api/employees?**', route);
  await search.fill('Jamie');
  await page.waitForTimeout(350);
  await expect(table).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(3);
  await expect(page.locator('tbody tr')).toHaveCount(1);
  assert.deepEqual(
    await table.locator('..').boundingBox(),
    tableBox,
    'Table area stays stable when results shrink',
  );
  await search.fill('no-such-person');
  await expect(page.getByText('No employees found', { exact: true })).toBeVisible();
  await search.fill('');
  await expect(page.locator('tbody tr')).toHaveCount(3);
  await page.unroute('**/api/employees?**', route);
  console.log(
    'PASS Search: focus gating, one-character suggestions, debounce, cancellation, input/dropdown/table geometry, selection without extra requests',
  );
}
