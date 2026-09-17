// Display wording only. Stored field names, status values, and activity codes stay stable.
export const leaveTypes = {
  Casual: 'Personal leave',
  Sick: 'Sick days',
  Annual: 'Vacation',
  Unpaid: 'Leave without pay',
};
export const statusLabels = {
  Pending: 'Waiting for approval',
  Rejected: 'Declined',
  Terminated: 'Employment ended',
  Unpaid: 'Not paid yet',
};
export const activityLabels = {
  'auth.login': 'Signed in',
  'auth.logout': 'Signed out',
  'auth.password_changed': 'Changed password',
  'auth.password_reset': 'Reset password',
  'admin.seeded': 'Created the first Admin account',
  'employee.created': 'Added employee',
  'employee.updated': 'Updated employee details',
  'employee.archived': 'Removed employee from the current team',
  'employee.photo_updated': 'Changed profile photo',
  'employee.photo_deleted': 'Removed profile photo',
  'attendance.check_in': 'Checked in for work',
  'attendance.check_out': 'Checked out from work',
  'attendance.manual_entry': 'Added or corrected attendance',
  'leave.applied': 'Requested leave',
  'leave.approved': 'Approved leave',
  'leave.rejected': 'Declined leave',
  'leave.cancelled': 'Cancelled leave',
  'payroll.generated': 'Prepared monthly pay',
  'payroll.marked_paid': 'Marked pay as paid',
  'payslip.downloaded': 'Downloaded pay details',
  'report.downloaded': 'Downloaded report',
  'settings.updated': 'Changed company settings',
  'user.updated': 'Changed account access or password',
  'announcement.published': 'Sent company announcement',
  'department.created': 'Added department',
  'department.updated': 'Changed department',
  'department.deleted': 'Deleted department',
  'designation.created': 'Added job title',
  'designation.updated': 'Changed job title',
  'designation.deleted': 'Deleted job title',
};
const fieldLabels = {
  Payroll: 'Pay',
  Leave: 'Leave',
  User: 'Account',
  Designation: 'Job title',
  payroll: 'Pay',
  leave: 'Leave',
  payslip: 'Pay details',
  designation: 'Job title',
  salary: 'Full-month salary',
  basic: 'Base pay for this month',
  netSalary: 'Final pay',
  allowance: 'Extra pay',
  deduction: 'Other pay reductions',
  attendanceDeduction: 'Pay taken off for missed days',
  eligibleDays: 'Workdays at the company',
  workingDays: 'Company workdays',
  paidDays: 'Days off with pay',
  unpaidDays: 'Days off without pay',
  absentDays: 'Days missed',
  presentDays: 'Days at work',
  graceMinutes: 'Minutes allowed before someone is marked late',
  leavePolicy: 'Paid days off each year',
  paidDates: 'Days off with pay',
  workDates: 'Workdays off',
  tokenVersion: 'Sign-in update',
  mustChangePassword: 'Must choose a new password',
  passwordReset: 'Password reset requested',
  role: 'Account type',
  active: 'Sign-in allowed',
  created: 'Added',
  skipped: 'Already saved',
  format: 'File type',
  rows: 'Number of entries',
  entityId: 'Record reference',
  recipients: 'People notified',
  joiningDate: 'Start date',
  photoDeleted: 'Photo removed',
  deletePhoto: 'Remove photo',
  deleted: 'Removed from current team',
  ip: 'Device address',
  _id: 'Reference',
};
export function plainLabel(value) {
  const key = String(value ?? '');
  if (Object.hasOwn(fieldLabels, key)) return fieldLabels[key];
  const words = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_.]/g, ' ');
  return words ? words[0].toUpperCase() + words.slice(1) : '';
}
export const leaveTypeLabel = (type) => (Object.hasOwn(leaveTypes, type) ? leaveTypes[type] : type);
export const statusLabel = (status) =>
  Object.hasOwn(statusLabels, status) ? statusLabels[status] : status;
export const activityLabel = (action) =>
  Object.hasOwn(activityLabels, action) ? activityLabels[action] : plainLabel(action);
