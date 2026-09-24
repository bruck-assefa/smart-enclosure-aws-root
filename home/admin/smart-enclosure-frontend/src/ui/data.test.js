import test from 'node:test';
import assert from 'node:assert/strict';
import { customHistoryBounds, assignments, liveZones, zoneHistory, shiftDay, serverNow } from './data.js';
const sensor = (id, channel, status, time, value) => ({ sensor_id: id, hardware: { multiplexer_address: '0x70', channel }, enabled: true, status, last_success_at: time, last_good_reading: { temperature_c: value } });
const sensors = [sensor('sensor_0', 0, 'healthy', 95, 30), sensor('sensor_5', 5, 'error', 90, 99)];
const rows = [{ sensor_id: '0x70-ch0', zone: 'Warm' }, { sensor_id: '0x70-ch5', zone: 'Warm' }];
test('browser clock skew does not invalidate fresh hardware measurements', () => {
 const state = { connection: { status: 'connected' }, snapshot: { generated_at: 100, collector: { status: 'running' }, sensors } };
 assert.equal(serverNow(state, 88, 90), 102);
 assert.equal(liveZones(state, rows, serverNow(state, 88, 90))[0].value, 30);
 assert.equal(liveZones(state, rows, serverNow(state, 88, 150))[0].value, null);
});
test('maps legacy physical IDs without inventing assignments', () => { assert.deepEqual(assignments(rows, sensors), { sensor_0: 'Warm', sensor_5: 'Warm' }); });
test('zone average excludes failed/stale readings and exposes partial coverage', () => {
 const state = { connection: { status: 'connected' }, snapshot: { collector: { status: 'running' }, sensors } };
 assert.deepEqual(liveZones(state, rows, 100)[0], { zone: 'Warm', total: 2, count: 1, value: 30, age: 5 });
 assert.equal(liveZones(state, rows, 140)[0].value, null);
 state.connection.status = 'unavailable'; assert.equal(liveZones(state, rows, 100)[0].value, null);
});
test('history averages sensors equally and preserves missing buckets', () => {
 const series = [{ sensor_id: 'sensor_0', points: [{ time: 60, temperature_c: 20 }, { time: 240, temperature_c: 24 }] }, { sensor_id: 'sensor_5', points: [{ time: 60, temperature_c: 30 }] }];
 assert.deepEqual(zoneHistory(series, assignments(rows, sensors))[0].points, [{ time: 60, value: 25, count: 2 }, { time: 240, value: 24, count: 1 }]);
});
test('date navigation crosses month and DST boundaries', () => { assert.equal(shiftDay('2026-03-08', -1), '2026-03-07'); assert.equal(shiftDay('2026-01-01', -1), '2025-12-31'); });

test('humidity and pressure histories average independently, retaining zero and gaps', () => {
 const series = [{ sensor_id: 'sensor_0', points: [
  { time: 60, temperature_c: 25, humidity_pct: 0, pressure_hpa: 1000 },
  { time: 120, temperature_c: 25, humidity_pct: null },
  { time: 240, humidity_pct: 40, pressure_hpa: 1004 }
 ] }, { sensor_id: 'sensor_5', points: [{ time: 60, humidity_pct: 20, pressure_hpa: 1002 }] }];
 const map = assignments(rows, sensors);
 assert.deepEqual(zoneHistory(series, map, 'humidity_pct')[0].points, [{ time: 60, value: 10, count: 2 }, { time: 240, value: 40, count: 1 }]);
 assert.deepEqual(zoneHistory(series, map, 'pressure_hpa')[0].points, [{ time: 60, value: 1001, count: 2 }, { time: 240, value: 1004, count: 1 }]);
});

test('custom history uses enclosure wall time, exclusive ends and full-day defaults', () => {
 assert.deepEqual(customHistoryBounds({start:'2026-09-01',end:'2026-09-01',startTime:'10:00',endTime:'11:00'}), {start:Date.parse('2026-09-01T14:00Z')/1000,end:Date.parse('2026-09-01T15:00Z')/1000});
 for (const [day,hours] of [['2026-03-08',23],['2026-11-01',25]]) {
  const bounds = customHistoryBounds({start:day,end:day});
  assert.equal(bounds.end-bounds.start,hours*3600);
 }
 const repeated = customHistoryBounds({start:'2026-11-01',end:'2026-11-01',startTime:'01:15',endTime:'01:45'});
 assert.equal(repeated.end-repeated.start,90*60);
 assert.throws(()=>customHistoryBounds({start:'2026-03-08',end:'2026-03-08',startTime:'02:30'}), /may not exist/);
 assert.throws(()=>customHistoryBounds({start:'2026-09-01',end:'2026-09-01',startTime:'12:00',endTime:'11:00'}), /must be after/);
 assert.throws(()=>customHistoryBounds({start:'2026-09-01',end:'2026-10-02'}), /31 calendar days/);
});
