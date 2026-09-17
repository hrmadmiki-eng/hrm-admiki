import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculatePayroll,
  workDates,
  validDate,
  validMonth,
  isLate,
  today,
} from '../utils/dates.js';
test('payroll prorates joining dates and deducts absence and unpaid leave', () => {
  const result = calculatePayroll({
    salary: 22000,
    allowance: 1000,
    bonus: 500,
    deduction: 200,
    workingDays: 22,
    eligibleDays: 11,
    absentDays: 2,
    unpaidDays: 1,
  });
  assert.equal(result.basic, 11000);
  assert.equal(result.attendanceDeduction, 3000);
  assert.equal(result.netSalary, 9300);
});
test('payroll rounds currency and floors net salary at zero', () => {
  assert.equal(
    calculatePayroll({
      salary: 1000,
      workingDays: 22,
      eligibleDays: 21,
      absentDays: 1,
      unpaidDays: 0,
    }).netSalary,
    909.1,
  );
  assert.equal(
    calculatePayroll({
      salary: 1000,
      deduction: 9999,
      workingDays: 22,
      eligibleDays: 22,
      absentDays: 0,
      unpaidDays: 0,
    }).netSalary,
    0,
  );
});
test('weekends and holidays are excluded once, including leap years', () => {
  const dates = workDates('2024-02-01', '2024-02-29', {
    weekends: [5, 6],
    holidays: [{ date: '2024-02-21' }, { date: '2024-02-23' }],
  });
  assert.equal(dates.length, 20);
  assert.ok(dates.includes('2024-02-29'));
  assert.ok(!dates.includes('2024-02-21'));
});
test('calendar validation rejects invalid dates and months', () => {
  assert.equal(validDate('2025-02-29'), false);
  assert.equal(validDate('2024-02-29'), true);
  assert.equal(validMonth('2026-13'), false);
  assert.equal(validDate({ $gt: '' }), false);
});
test('office timezone and inclusive grace boundary are respected', () => {
  const config = { timezone: 'Asia/Dhaka', officeStart: '09:00', graceMinutes: 15 };
  assert.equal(today(config, new Date('2026-09-08T20:00:00Z')), '2026-09-09');
  assert.equal(isLate(new Date('2026-09-09T03:15:00Z'), '2026-09-09', config), false);
  assert.equal(isLate(new Date('2026-09-09T03:15:01Z'), '2026-09-09', config), true);
});
