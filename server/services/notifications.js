import { Notification, User } from '../models/index.js';
import { leaveTypeLabel, statusLabel } from '../../shared/language.mjs';

// Call inside the business transaction: a request and its notifications commit together.
export async function notifyUsers(recipients, notification, session) {
  const ids = [...new Set(recipients.map(String))];
  if (!ids.length) return;
  await Notification.insertMany(
    ids.map((recipient) => ({ ...notification, recipient })),
    { session },
  );
}

export async function notifyLeaveSubmitted(leave, employee, session) {
  const managers = await User.find({
    active: true,
    role: { $in: ['Admin', 'HR'] },
    _id: { $ne: employee.user },
  })
    .select('_id')
    .session(session);
  await notifyUsers(
    managers.map((user) => user._id),
    {
      kind: 'leave.submitted',
      title: 'New leave request',
      message: `${employee.name} requested ${leaveTypeLabel(leave.type).toLowerCase()} from ${leave.startDate} to ${leave.endDate}.`,
      eventKey: `leave:${leave._id}:submitted`,
    },
    session,
  );
}

export async function notifyLeaveReviewed(leave, employee, session) {
  await notifyUsers(
    [employee.user],
    {
      kind: 'leave.reviewed',
      title: `Leave request ${statusLabel(leave.status).toLowerCase()}`,
      message: `Your ${leaveTypeLabel(leave.type).toLowerCase()} from ${leave.startDate} to ${leave.endDate} was ${statusLabel(leave.status).toLowerCase()}.${leave.reviewNote ? ` Note: ${leave.reviewNote}` : ''}`,
      eventKey: `leave:${leave._id}:reviewed`,
    },
    session,
  );
}
