import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from '../server/node_modules/exceljs/excel.js';

export async function verifyHrmWorkflows(page, shots) {
  const nav = async (name) => {
    await page.getByRole('link', { name, exact: true }).click();
    await page.locator('main h1').waitFor();
  };
  const closeDialog = async () =>
    page.getByRole('dialog').getByRole('button', { name: 'Close dialog' }).click();
  const chooseEmployee = async (scope, name) => {
    await scope.getByLabel('Employee', { exact: true }).fill(name);
    await scope.getByRole('option', { name: new RegExp(`${name}.*[0-9]`) }).click();
  };
  const download = async (button) => {
    const pending = page.waitForEvent('download');
    await button.click();
    const result = await pending;
    assert.equal(await result.failure(), null);
    const buffer = await fs.readFile(await result.path());
    assert.ok(buffer.length > 100);
    return { result, buffer };
  };
  await nav('Employees');
  await page.getByRole('button', { name: 'Departments', exact: true }).click();
  await page.getByRole('button', { name: 'Add department', exact: true }).click();
  await page.getByLabel('Name', { exact: false }).fill('Workflow Team');
  await page.getByLabel('Description', { exact: true }).fill('Browser workflow coverage');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'All employees', exact: true }).click();
  await expect(
    page.getByLabel('Filter by department').getByRole('option', { name: 'Workflow Team' }),
  ).toHaveCount(1);
  await page.getByRole('button', { name: 'Job titles', exact: true }).click();
  await page.getByRole('button', { name: 'Add job title', exact: true }).click();
  await page.getByLabel('Name', { exact: false }).fill('Workflow Analyst');
  await page
    .getByRole('dialog')
    .getByLabel('Department', { exact: false })
    .selectOption({ label: 'Workflow Team' });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'All employees', exact: true }).click();
  await page.getByRole('button', { name: 'Add employee', exact: true }).click();
  await page.getByLabel('Full name', { exact: false }).fill('Morgan Workflow');
  await page.getByLabel('Email address', { exact: false }).fill('morgan@browser.test');
  await page.getByLabel('Start date', { exact: false }).fill('2024-02-01');
  await page.getByLabel('Full-month salary', { exact: false }).fill('29000');
  await page
    .getByRole('dialog')
    .getByLabel('Department', { exact: false })
    .selectOption({ label: 'Workflow Team' });
  await page.getByLabel('Job title', { exact: false }).selectOption({ label: 'Workflow Analyst' });
  await page.getByLabel('Temporary login password', { exact: false }).fill('1234');
  await page.getByRole('button', { name: 'Create employee', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Departments', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Workflow Team', exact: true }).click();
  await page.getByLabel('Name', { exact: false }).fill('Workflow Operations');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'All employees', exact: true }).click();
  await page.getByLabel('Search employees').fill('Morgan');
  const row = page.getByRole('row').filter({ hasText: 'Morgan Workflow' });
  await expect(row).toContainText('Workflow Operations');
  await expect(row).toContainText('Workflow Analyst');
  await page.getByRole('link', { name: 'View Morgan Workflow', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Employee profile', exact: true })).toBeVisible();
  await expect(page.getByText('৳ 29,000.00', { exact: true })).toBeVisible();
  await nav('Attendance');
  await page.getByRole('button', { name: 'Add or correct attendance', exact: true }).click();
  await chooseEmployee(page.getByRole('dialog'), 'Morgan Workflow');
  await page.getByRole('dialog').getByLabel('Date', { exact: false }).fill('2024-02-01');
  await page.getByRole('dialog').getByLabel('Check-in', { exact: false }).fill('09:00');
  await page.getByRole('dialog').getByLabel('Check-out', { exact: true }).fill('18:00');
  await page.getByRole('button', { name: 'Save attendance', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('Month', { exact: false }).fill('2024-02');
  await chooseEmployee(page, 'Morgan Workflow');
  await expect(page.getByRole('table')).toContainText('9.0 h');
  await expect(page.getByRole('table')).toContainText('Present');
  await nav('Payroll');
  // A previous list filter must not hide payroll generated for a different employee.
  await chooseEmployee(page, 'Taylor New');
  await page.getByRole('button', { name: 'Prepare pay', exact: true }).click();
  await page.getByLabel('Completed month').fill('2024-02');
  await chooseEmployee(page.getByRole('dialog'), 'Morgan Workflow');
  await page.getByLabel('Extra pay', { exact: false }).fill('100');
  await page.getByLabel('Bonus', { exact: false }).fill('50');
  await page.getByLabel('Other pay reductions', { exact: false }).fill('20');
  await page.getByRole('button', { name: 'Save monthly pay' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('table')).toContainText('Morgan Workflow');
  await expect(page.getByRole('table')).toContainText('৳ 1,130.00');
  await page.getByRole('button', { name: 'View pay details for 2024-02', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Days at work: 1');
  await expect(page.getByRole('dialog')).toContainText('Days missed: 28');
  const slip = await download(
    page.getByRole('dialog').getByRole('button', { name: 'Download Excel' }),
  );
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(slip.buffer);
  assert.equal(book.worksheets[0].getCell('B12').value, 1130);
  const pdf = await download(
    page.getByRole('dialog').getByRole('button', { name: 'Download PDF' }),
  );
  assert.equal(pdf.buffer.subarray(0, 4).toString(), '%PDF');
  while (await page.getByRole('button', { name: 'Dismiss notification' }).count())
    await page.getByRole('button', { name: 'Dismiss notification' }).first().click();
  await page.screenshot({ path: path.join(shots, 'payroll-workflow.png'), fullPage: true });
  await closeDialog();
  await page
    .getByRole('button', { name: "Mark Morgan Workflow's pay as paid", exact: true })
    .click();
  await page.getByRole('button', { name: 'Confirm already paid', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('table').getByText('Paid', { exact: true })).toBeVisible();
  await nav('Reports');
  for (const type of ['Employee report', 'Attendance report', 'Leave report', 'Pay report']) {
    await page.getByRole('button', { name: new RegExp(`^${type}`) }).click();
    await page.getByLabel('Month', { exact: false }).fill('2024-02');
    for (const format of ['PDF', 'Excel']) {
      const file = await download(
        page.getByRole('button', { name: `Download ${format}`, exact: true }),
      );
      if (format === 'PDF') assert.equal(file.buffer.subarray(0, 4).toString(), '%PDF');
      else {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(file.buffer);
        assert.ok(workbook.worksheets[0].columnCount > 0);
      }
    }
  }
  await nav('Activity History');
  await page.getByLabel('Action', { exact: true }).fill('Marked pay as paid');
  await expect(page.getByRole('table')).toContainText('Marked pay as paid');
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(2);
  await page.getByRole('button', { name: 'View details', exact: true }).first().click();
  await expect(page.getByRole('dialog')).toContainText('Marked pay as paid');
  await closeDialog();
  await nav('Employees');
  await page.getByRole('button', { name: 'Remove Morgan Workflow', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Remove from current team', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('table')).not.toContainText('Morgan Workflow');
  await nav('Payroll');
  await chooseEmployee(page, 'Morgan Workflow');
  await expect(page.getByRole('table')).toContainText('৳ 1,130.00');
  await nav('Dashboard');
  await page.getByLabel('Pay currency').selectOption('BDT');
  await expect(page.getByLabel('Pay currency')).toHaveValue('BDT');
  await page.getByLabel('Pay currency').selectOption('BDT');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of [
    'employees',
    'attendance',
    'leave',
    'payroll',
    'reports',
    'users',
    'settings',
    'audit',
  ]) {
    await page.goto(`${process.env.CLIENT_URL}/${route}`);
    await page.locator('main h1').waitFor();
    await expect(page.locator('main [role="alert"]')).toHaveCount(0);
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `${route} overflows mobile viewport`,
    );
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  console.log(
    'PASS Expanded HRM: catalog refresh, assigned employee profile, manual attendance, payroll filter/calculation/detail/payment, all 8 report exports, audit details, archive/history, currency selection and every Admin module at mobile width',
  );
}
