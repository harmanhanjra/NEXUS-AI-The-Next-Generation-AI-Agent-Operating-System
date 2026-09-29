import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate } from '../lib/agent-tools.ts';

test('calculator respects precedence, grouping and unary operators', () => {
  assert.equal(calculate('(125 * 8) + 45 / 3'), 1015);
  assert.equal(calculate('-2 * (3 + 4)'), -14);
  assert.equal(calculate('10 % 3 + .5'), 1.5);
});
test('calculator rejects executable code and malformed arithmetic', () => {
  for (const expression of ['process.exit()', '1/0', '1..2', '2 3', '(2+3', '', '2**3']) {
    assert.throws(() => calculate(expression));
  }
});
