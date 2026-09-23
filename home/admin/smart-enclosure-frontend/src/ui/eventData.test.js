import test from 'node:test';
import assert from 'node:assert/strict';
import { eventLocalTime, eventFold } from './eventData.js';
const stamp = date => Date.parse(date) / 1000;
test('entry uses enclosure time regardless of browser timezone', () => {
  assert.equal(eventLocalTime(stamp('2025-09-02T01:30:00Z')), '2025-09-01T21:30');
  assert.equal(eventLocalTime(stamp('2025-01-02T05:00:00Z')), '2025-01-02T00:00');
});
test('selected timestamps retain the correct repeated hour', () => {
  const first = stamp('2025-11-02T05:30:00Z'), second = stamp('2025-11-02T06:30:00Z');
  assert.equal(eventLocalTime(first), eventLocalTime(second));
  assert.equal(eventFold(first), 0);
  assert.equal(eventFold(second), 1);
  assert.equal(eventFold(stamp('2025-09-01T12:00:00Z')), 0);
});
