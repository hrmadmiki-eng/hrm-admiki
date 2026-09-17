import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

export async function verifyDashboardCards(page) {
  const base = process.env.CLIENT_URL;
  const dashboard = (await (await page.request.get(`${base}/api/dashboard`)).json()).data;
  const cards = [
    ['Total employees', 'active', 'totalEmployees'],
    ['At work today', 'present', 'presentToday'],
    ['Not at work today', 'absent', 'absentToday'],
    ['Off today', 'on-leave', 'onLeave'],
  ];
  for (const [label, group, metric] of cards) {
    await page.goto(`${base}/dashboard`);
    const card = page.getByRole('link', { name: new RegExp(`^${label}:`) });
    await expect(card).toHaveAttribute(
      'href',
      `/employees?dashboard=${group}&date=${dashboard.date}`,
    );
    const response = page.waitForResponse((res) => {
      const url = new URL(res.url());
      return url.pathname === '/api/employees' && url.searchParams.get('dashboard') === group;
    });
    await card.focus();
    await page.keyboard.press('Enter');
    const list = (await (await response).json()).data;
    assert.equal(list.total, dashboard[metric]);
    await expect(page.getByRole('button', { name: 'Show all employees' })).toBeVisible();
    if (list.total) await expect(page.locator('tbody tr')).toHaveCount(list.items.length);
    else await expect(page.getByText('No employees found', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Show all employees' })).toBeVisible();
    await page.getByRole('button', { name: 'Show all employees' }).click();
    await expect(page).toHaveURL(`${base}/employees`);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`dashboard=${group}`));
    await expect(page.getByRole('button', { name: 'Show all employees' })).toBeVisible();
  }
  await page.goto(`${base}/dashboard`);
  await page.getByRole('link', { name: /^Leave requests to review:/ }).click();
  await expect(page.getByLabel('Request decision')).toHaveValue('Pending');
  const pending = (await (await page.request.get(`${base}/api/leave?status=Pending`)).json()).data;
  assert.equal(pending.total, dashboard.pendingLeave);
  await page.reload();
  await expect(page.getByLabel('Request decision')).toHaveValue('Pending');
  await page.getByLabel('Request decision').selectOption('');
  await page.goBack();
  await expect(page.getByLabel('Request decision')).toHaveValue('Pending');

  await page.goto(`${base}/dashboard`);
  const payrollMonth = dashboard.lastPayroll?._id || dashboard.month;
  const payrollLink = page.getByRole('link', { name: /^Monthly pay total:/ });
  await expect(payrollLink).toHaveAttribute(
    'href',
    `/payroll?month=${payrollMonth}&currency=${dashboard.payrollCurrency}`,
  );
  await payrollLink.click();
  await expect(page.getByLabel('Month (optional)')).toHaveValue(payrollMonth);
  await expect(page.getByLabel('Currency', { exact: true })).toHaveValue(dashboard.payrollCurrency);
  const payroll = (
    await (
      await page.request.get(
        `${base}/api/payroll?month=${payrollMonth}&currency=${dashboard.payrollCurrency}&limit=100`,
      )
    ).json()
  ).data;
  assert.equal(
    payroll.items.reduce((sum, row) => sum + row.netSalary, 0),
    dashboard.lastPayroll?.total || 0,
  );
  await page.reload();
  await expect(page.getByLabel('Month (optional)')).toHaveValue(payrollMonth);
  await expect(page.getByLabel('Currency', { exact: true })).toHaveValue(dashboard.payrollCurrency);
  await page.getByLabel('Currency', { exact: true }).selectOption('');
  await page.goBack();
  await expect(page.getByLabel('Currency', { exact: true })).toHaveValue(dashboard.payrollCurrency);
  await page.goto(`${base}/dashboard`);
  await expect(page.locator('a.card')).toHaveCount(6);
  console.log(
    'PASS Dashboard cards: all six destinations, matching totals, keyboard activation, refresh and Back',
  );
}
