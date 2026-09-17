import test from 'node:test';
import assert from 'node:assert/strict';
import { passwordError } from '../utils/password.js';

test('password policy accepts any character combination and preserves the bcrypt byte limit', () => {
  for (const role of ['Employee', 'HR', 'Admin']) {
    const minimum = role === 'Employee' ? 4 : 6;
    for (const value of [undefined, null, 123456, {}, [], '', 'a'.repeat(minimum - 1)])
      assert.match(passwordError(value, role), new RegExp(`at least ${minimum}`));
    for (const char of ['a', '1', '!', 'é', '😀'])
      assert.equal(passwordError(char.repeat(minimum), role), null);
    assert.equal(passwordError('a'.repeat(72), role), null);
    assert.equal(passwordError('é'.repeat(36), role), null);
    assert.match(passwordError('a'.repeat(73), role), /too long/);
    assert.match(passwordError('é'.repeat(37), role), /too long/);
    assert.match(passwordError('😀'.repeat(minimum - 1), role), /at least/);
  }
});
