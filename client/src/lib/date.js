import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
dayjs.extend(utc);
dayjs.extend(timezone);
export { dayjs };
export const formatDate = (value, zone) =>
  value ? (zone ? dayjs(value).tz(zone) : dayjs(value)).format('DD MMM YYYY') : '—';
export const formatTime = (value, zone = 'Asia/Dhaka') =>
  value ? dayjs(value).tz(zone).format('hh:mm A') : '—';
export const officeTime = (value) => (value ? dayjs(`2000-01-01T${value}`).format('hh:mm A') : '—');
const taka = new Intl.NumberFormat('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (value = 0) => `৳ ${taka.format(value)}`;
