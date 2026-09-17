export const passwordMinimum = (role) => (role === 'Employee' ? 4 : 6);

export const passwordHint = (role) =>
  `Use at least ${passwordMinimum(role)} characters. Letters, numbers or symbols are allowed; no combination is required.`;
