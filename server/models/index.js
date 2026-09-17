import mongoose from 'mongoose';
import { validDate, validMonth } from '../utils/dates.js';
const { Schema } = mongoose;
// Dedicated collection names let this app coexist with pre-existing database schemas.
const collections = {
  User: 'admiki_users',
  Employee: 'admiki_employees',
  Department: 'admiki_departments',
  Designation: 'admiki_designations',
  Attendance: 'admiki_attendance',
  Leave: 'admiki_leaves',
  Payroll: 'admiki_payroll',
  Settings: 'admiki_settings',
  AuditLog: 'admiki_audit_logs',
  Counter: 'admiki_counters',
  Notification: 'admiki_notifications',
};
const model = (name, schema) => mongoose.model(name, schema, collections[name]);
const requiredText = {
  type: String,
  required: true,
  trim: true,
  maxlength: 150,
};
const dateString = {
  type: String,
  validate: {
    validator: (v) => !v || validDate(v),
    message: 'Invalid date; use YYYY-MM-DD',
  },
};
const ref = (name) => ({ type: Schema.Types.ObjectId, ref: name });
const amount = { type: Number, min: 0, max: 100000000, default: 0 };
const options = {
  timestamps: true,
  toJSON: {
    transform(_doc, ret) {
      delete ret.__v;
      delete ret.password;
      delete ret.tokenVersion;
      delete ret.passwordReset;
      return ret;
    },
  },
};

const userSchema = new Schema(
  {
    name: requiredText,
    email: {
      ...requiredText,
      lowercase: true,
      unique: true,
      maxlength: 254,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },
    password: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: ['Admin', 'HR', 'Employee'],
      default: 'Employee',
    },
    employee: ref('Employee'),
    active: { type: Boolean, default: true },
    tokenVersion: { type: Number, default: 0, select: false },
    mustChangePassword: { type: Boolean, default: true },
    passwordReset: {
      type: new Schema(
        { hash: String, expiresAt: Date, version: Number, email: String },
        { _id: false },
      ),
      select: false,
      default: undefined,
    },
  },
  options,
);
userSchema.index({ 'passwordReset.hash': 1 }, { sparse: true, unique: true });
export const User = model('User', userSchema);
const notificationSchema = new Schema(
  {
    recipient: { ...ref('User'), required: true, immutable: true },
    kind: {
      type: String,
      enum: ['leave.submitted', 'leave.reviewed', 'announcement'],
      required: true,
    },
    title: requiredText,
    message: { type: String, required: true, maxlength: 2000 },
    eventKey: { type: String, required: true },
    readAt: { type: Date, default: null },
  },
  options,
);
notificationSchema.index({ recipient: 1, createdAt: -1, _id: -1 });
notificationSchema.index({ recipient: 1, readAt: 1 });
notificationSchema.index({ recipient: 1, eventKey: 1 }, { unique: true });
export const Notification = model('Notification', notificationSchema);
const departmentSchema = new Schema(
  {
    name: { ...requiredText, unique: true },
    description: { type: String, maxlength: 1000, default: '' },
  },
  options,
);
departmentSchema.index(
  { name: 1 },
  {
    unique: true,
    collation: { locale: 'en', strength: 2 },
    name: 'department_name_ci',
  },
);
export const Department = model('Department', departmentSchema);
const designationSchema = new Schema(
  { name: requiredText, department: { ...ref('Department'), required: true } },
  options,
);
designationSchema.index(
  { department: 1, name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } },
);
export const Designation = model('Designation', designationSchema);
const employeeSchema = new Schema(
  {
    employeeId: { ...requiredText, unique: true },
    user: { ...ref('User'), unique: true, required: true },
    name: requiredText,
    email: {
      ...requiredText,
      lowercase: true,
      unique: true,
      maxlength: 254,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },
    phone: { type: String, maxlength: 30, default: '' },
    address: { type: String, maxlength: 1000, default: '' },
    // Mixed temporarily accepts legacy local filenames already stored in existing databases.
    // Every new upload is persisted as { url, public_id }.
    photo: {
      type: Schema.Types.Mixed,
      default: null,
      validate: {
        validator: (value) =>
          value == null ||
          value === '' ||
          typeof value === 'string' ||
          (typeof value === 'object' &&
            typeof value.url === 'string' &&
            value.url.startsWith('https://res.cloudinary.com/') &&
            typeof value.public_id === 'string' &&
            value.public_id.length > 0),
        message: 'Invalid profile photo reference',
      },
    },
    department: ref('Department'),
    designation: ref('Designation'),
    joiningDate: { ...dateString, required: true },
    endDate: dateString,
    salary: { ...amount, required: true },
    status: {
      type: String,
      enum: ['Active', 'Inactive', 'Terminated'],
      default: 'Active',
    },
    deleted: { type: Boolean, default: false },
    revision: { type: Number, default: 0 },
  },
  options,
);
employeeSchema.index({ department: 1, status: 1, deleted: 1 });
export const Employee = model('Employee', employeeSchema);
const attendanceSchema = new Schema(
  {
    employee: { ...ref('Employee'), required: true },
    date: { ...dateString, required: true },
    checkIn: Date,
    checkOut: Date,
    status: {
      type: String,
      enum: ['Present', 'Late', 'Absent', 'Holiday'],
      required: true,
    },
    source: { type: String, enum: ['Self', 'Manual'], default: 'Self' },
    notes: { type: String, maxlength: 1000, default: '' },
    updatedBy: ref('User'),
  },
  options,
);
attendanceSchema.index({ employee: 1, date: 1 }, { unique: true });
attendanceSchema.index({ date: 1, status: 1 });
export const Attendance = model('Attendance', attendanceSchema);
const leaveSchema = new Schema(
  {
    employee: { ...ref('Employee'), required: true },
    type: {
      type: String,
      enum: ['Casual', 'Sick', 'Annual', 'Unpaid'],
      required: true,
    },
    startDate: { ...dateString, required: true },
    endDate: { ...dateString, required: true },
    reason: { type: String, required: true, trim: true, maxlength: 2000 },
    workDates: [String],
    paidDates: [String],
    status: {
      type: String,
      enum: ['Pending', 'Approved', 'Rejected', 'Cancelled'],
      default: 'Pending',
    },
    reviewedBy: ref('User'),
    reviewedAt: Date,
    reviewNote: { type: String, maxlength: 1000, default: '' },
  },
  options,
);
leaveSchema.index({ employee: 1, startDate: 1, endDate: 1, status: 1 });
leaveSchema.index({ status: 1, createdAt: -1 });
export const Leave = model('Leave', leaveSchema);
const payrollSchema = new Schema(
  {
    employee: { ...ref('Employee'), required: true },
    month: { type: String, required: true, validate: validMonth },
    employeeName: requiredText,
    employeeCode: requiredText,
    departmentName: String,
    designationName: String,
    companyName: String,
    currency: String,
    salary: amount,
    basic: amount,
    allowance: amount,
    bonus: amount,
    deduction: amount,
    attendanceDeduction: amount,
    netSalary: { ...amount, max: 300000000 },
    workingDays: Number,
    eligibleDays: Number,
    presentDays: Number,
    absentDays: Number,
    paidDays: Number,
    unpaidDays: Number,
    generatedBy: ref('User'),
    paidAt: Date,
  },
  options,
);
payrollSchema.index({ employee: 1, month: 1 }, { unique: true });
payrollSchema.index({ month: 1 });
export const Payroll = model('Payroll', payrollSchema);
const settingsSchema = new Schema(
  {
    _id: { type: String, default: 'company' },
    companyName: { ...requiredText, default: 'admiki' },
    email: { type: String, maxlength: 254, default: '' },
    phone: { type: String, maxlength: 30, default: '' },
    address: { type: String, maxlength: 1000, default: '' },
    currency: {
      type: String,
      default: 'BDT',
      enum: ['BDT'],
    },
    timezone: {
      type: String,
      default: 'Asia/Dhaka',
      validate: (v) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: v });
          return true;
        } catch {
          return false;
        }
      },
    },
    officeStart: {
      type: String,
      default: '09:00',
      match: /^([01]\d|2[0-3]):[0-5]\d$/,
    },
    officeEnd: {
      type: String,
      default: '18:00',
      match: /^([01]\d|2[0-3]):[0-5]\d$/,
    },
    graceMinutes: { type: Number, min: 0, max: 120, default: 15 },
    weekends: {
      type: [Number],
      default: [5, 6],
      validate: (v) =>
        v.length < 7 &&
        v.every((n) => Number.isInteger(n) && n >= 0 && n <= 6) &&
        new Set(v).size === v.length,
    },
    holidays: [
      {
        _id: false,
        date: { ...dateString, required: true },
        name: requiredText,
      },
    ],
    leavePolicy: {
      Casual: { type: Number, min: 0, max: 366, default: 10 },
      Sick: { type: Number, min: 0, max: 366, default: 14 },
      Annual: { type: Number, min: 0, max: 366, default: 20 },
    },
    revision: { type: Number, default: 0 },
  },
  options,
);
export const Settings = model('Settings', settingsSchema);
const auditSchema = new Schema(
  {
    actor: ref('User'),
    actorName: String,
    action: requiredText,
    entity: String,
    entityId: String,
    metadata: Schema.Types.Mixed,
    ip: String,
  },
  { timestamps: true },
);
auditSchema.index({ createdAt: -1 });
auditSchema.index({ actor: 1, createdAt: -1 });
export const AuditLog = model('AuditLog', auditSchema);
export const Counter = model(
  'Counter',
  new Schema({ _id: String, value: { type: Number, default: 0 } }),
);
