import { randomUUID } from 'node:crypto';
import { Notification, User } from '../models/index.js';
import { AppError, ok, pagination } from '../utils/http.js';
import { audit, transaction } from '../services/core.js';
import { notifyUsers } from '../services/notifications.js';

const inboxOwner = (user) => ({
  recipient: user._id,
  // A former manager must lose access to staff request alerts after demotion.
  ...(user.role === 'Employee' ? { kind: { $ne: 'leave.submitted' } } : {}),
});

// Never take recipient, role or ownership filters from client input, even for managers.
export async function list(req, res) {
  const { page, limit, skip } = pagination(req.query);
  const owner = inboxOwner(req.user);
  const filter = { ...owner, ...(req.query.unread === 'true' ? { readAt: null } : {}) };
  const [items, total, unreadCount] = await Promise.all([
    Notification.find(filter)
      .select('-recipient')
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit),
    Notification.countDocuments(filter),
    Notification.countDocuments({ ...owner, readAt: null }),
  ]);
  const inbox = items.map((item) => {
    const { eventKey, ...notification } = item.toJSON();
    // Existing notifications already contain the exact leave ID in their event key.
    const leave =
      notification.kind.startsWith('leave.') &&
      /^leave:([a-f\d]{24}):(submitted|reviewed)$/i.exec(eventKey);
    return { ...notification, href: leave ? `/leave/${leave[1]}` : null };
  });
  ok(res, { items: inbox, total, unreadCount, page, pages: Math.ceil(total / limit) });
}

export async function markRead(req, res) {
  const owner = { _id: req.params.id, ...inboxOwner(req.user) };
  const result = await Notification.updateOne(
    { ...owner, readAt: null },
    { $set: { readAt: new Date() } },
  );
  if (!result.matchedCount && !(await Notification.exists(owner)))
    throw new AppError(404, 'Notification not found');
  ok(res, null, 'Notification marked as read');
}

export async function markAllRead(req, res) {
  await Notification.updateMany(
    { ...inboxOwner(req.user), readAt: null },
    { $set: { readAt: new Date() } },
  );
  ok(res, null, 'All notifications marked as read');
}

export async function announce(req, res) {
  const eventKey = `announcement:${randomUUID()}`;
  const recipients = await transaction(async (session) => {
    const employees = await User.find({ role: 'Employee', active: true })
      .select('_id')
      .session(session);
    await notifyUsers(
      employees.map((user) => user._id),
      {
        kind: 'announcement',
        title: req.body.title,
        message: req.body.message,
        eventKey,
      },
      session,
    );
    await audit(
      req,
      'announcement.published',
      'Notification',
      eventKey,
      { recipients: employees.length, title: req.body.title },
      session,
    );
    return employees.length;
  });
  ok(res, { recipients }, 'Announcement sent', 201);
}
