import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);
export { dayjs };
export const validDate = (value) =>
  typeof value === 'string' && dayjs(value, 'YYYY-MM-DD', true).isValid();
export const validMonth = (value) =>
  typeof value === 'string' && dayjs(value, 'YYYY-MM', true).isValid();
export const today = (settings, instant = new Date()) =>
  dayjs(instant).tz(settings.timezone).format('YYYY-MM-DD');
export function datesBetween(start, end) {
  const dates = [];
  for (let d = dayjs.utc(start); d.format('YYYY-MM-DD') <= end; d = d.add(1, 'day')) {
    dates.push(d.format('YYYY-MM-DD'));
    if (dates.length > 366) throw new Error('Date range exceeds one year');
  }
  return dates;
}
export const isWorkday = (date, settings) =>
  !settings.weekends.includes(dayjs.utc(date).day()) &&
  !settings.holidays.some((h) => h.date === date);
export const workDates = (start, end, settings) =>
  datesBetween(start, end).filter((date) => isWorkday(date, settings));
export function isLate(instant, date, settings) {
  const start = dayjs
    .tz(`${date} ${settings.officeStart}`, 'YYYY-MM-DD HH:mm', settings.timezone)
    .add(settings.graceMinutes, 'minute');
  return dayjs(instant).isAfter(start);
}
export const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
export function calculatePayroll({
  salary,
  allowance = 0,
  bonus = 0,
  deduction = 0,
  workingDays,
  eligibleDays,
  absentDays,
  unpaidDays,
}) {
  allowance = money(allowance);
  bonus = money(bonus);
  deduction = money(deduction);
  const basic = money(workingDays ? (salary * eligibleDays) / workingDays : salary);
  const attendanceDeduction = money(
    workingDays ? (salary * (absentDays + unpaidDays)) / workingDays : 0,
  );
  return {
    basic,
    allowance: money(allowance),
    bonus: money(bonus),
    deduction: money(deduction),
    attendanceDeduction,
    netSalary: Math.max(0, money(basic + allowance + bonus - deduction - attendanceDeduction)),
  };
}
