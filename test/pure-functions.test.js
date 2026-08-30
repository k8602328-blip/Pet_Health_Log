'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { loadApp } = require('./load-app');

const app = loadApp();

test('waterLabel/urineLabel translate legacy long-form values to the current short label', () => {
  assert.equal(app.waterLabel('いつも通り'), 'いつも通り');
  assert.equal(app.urineLabel('いつも通り'), 'いつも通り');
  assert.equal(app.waterLabel('unknown-legacy-value'), 'unknown-legacy-value');
});

test('appetiteLabel appends % to the resolved value', () => {
  assert.equal(app.appetiteLabel(100), '100%');
  assert.equal(app.appetiteLabel(app.appetiteValue(100)), '100%');
});

test('walkLabel formats minutes or reports no record', () => {
  assert.equal(app.walkLabel(30), '30分');
  assert.equal(app.walkLabel(0), '0分');
  assert.equal(app.walkLabel(null), '記録なし');
  assert.equal(app.walkLabel(''), '記録なし');
});

test('stoolLabel resolves the fecal scale title and falls back for empty values', () => {
  assert.equal(app.stoolLabel(3), '3: 理想的');
  assert.equal(app.stoolLabel(''), '-');
  assert.equal(app.stoolLabel(null), '-');
});

test('escapeHtml neutralizes all five HTML-significant characters', () => {
  assert.equal(app.escapeHtml(`<script>alert("x")&'y'</script>`),
    '&lt;script&gt;alert(&quot;x&quot;)&amp;&#39;y&#39;&lt;/script&gt;');
});

test('cibdaiTotal sums scored items and cibdaiSeverity buckets the total', () => {
  assert.equal(app.cibdaiTotal({}), 0);
  assert.equal(app.cibdaiSeverity(0), '臨床的寛解の目安');
  assert.equal(app.cibdaiSeverity(4), '軽度');
  assert.equal(app.cibdaiSeverity(6), '中等度');
  assert.equal(app.cibdaiSeverity(9), '重度');
});

test('analyzeWeeklySummary reports insufficient data with fewer than 3 records in the last 7 days', () => {
  const result = app.analyzeWeeklySummary([{ date: app.daysAgoStr(1) }]);
  assert.equal(result.level, 'insufficient');
});

test('analyzeWeeklySummary reports stable when a full week has no concerning signal', () => {
  const records = [0, 1, 2, 3].map((n) => ({ date: app.daysAgoStr(n), weight: 4.2, appetite: 100 }));
  const result = app.analyzeWeeklySummary(records);
  assert.equal(result.level, 'stable');
});

test('analyzeWeeklySummary flags a severe combination (symptoms + weight drop) with a vet-consultation tone', () => {
  const thisWeek = [0, 1, 2, 3].map((n) => ({
    date: app.daysAgoStr(n), weight: 3.8, symptoms: ['嘔吐'],
  }));
  const prevWeek = [8, 9, 10].map((n) => ({ date: app.daysAgoStr(n), weight: 4.2 }));
  const result = app.analyzeWeeklySummary([...thisWeek, ...prevWeek]);
  assert.equal(result.level, 'concern');
  assert.match(result.text, /担当医に相談/);
});

test('sortEvents orders events chronologically by their local date and time sort key', () => {
  const sorted = app.sortEvents([
    { date: '2026-08-31', time: '18:20', sortKey: '2026-08-31T18:20' },
    { date: '2026-08-31', time: '07:30', sortKey: '2026-08-31T07:30' },
    { date: '2026-08-30', time: '23:59', sortKey: '2026-08-30T23:59' },
  ]);
  assert.deepEqual(sorted.map((event) => event.time), ['23:59', '07:30', '18:20']);
});

test('filterEventsByDate keeps only the selected day and retains chronological order', () => {
  const events = app.filterEventsByDate([
    { date: '2026-09-01', time: '08:00' },
    { date: '2026-08-31', time: '12:00' },
    { date: '2026-08-31', time: '07:00' },
  ], '2026-08-31');
  assert.deepEqual(events.map((event) => event.time), ['07:00', '12:00']);
});

test('eventSummary produces a compact type-specific timeline label', () => {
  assert.equal(app.eventSummary({ type: 'walk', details: { durationMinutes: 30, distanceMeters: 1200 } }), '30分・1200m');
  assert.equal(app.eventSummary({ type: 'meal', details: { intakePercent: 75, mealProfileLabels: ['朝のドライフード'] } }), '75% 朝のドライフード');
  assert.equal(app.eventSummary({ type: 'symptom', details: { symptoms: ['嘔吐', '下痢', '咳'] } }), '嘔吐・下痢');
  assert.equal(app.eventSummary({ type: 'water', details: { amount: 'more' } }), '量：多い');
});

test('recordedMealIntakes excludes days and meals without a recorded intake instead of treating them as 0%', () => {
  assert.deepEqual(app.recordedMealIntakes([
    { type: 'meal', details: { intakePercent: 75 } },
    { type: 'meal', details: {} },
    { type: 'memo', details: {} },
  ]), [75]);
});

test('mergeTimelineItems puts scheduled medication and saved events in chronological order', () => {
  const merged = app.mergeTimelineItems(
    [{ id: 'walk', time: '18:20' }, { id: 'meal', time: '07:30' }],
    [{ medication: { id: 'med-1' }, time: '08:00' }],
  );
  assert.deepEqual(merged.map((item) => `${item.kind}:${item.time}`), [
    'event:07:30', 'scheduled:08:00', 'event:18:20',
  ]);
});

test('localDateString and local-date movement inputs do not use UTC serialization', () => {
  const localMidnight = new Date(2026, 7, 31, 0, 5);
  assert.equal(app.localDateString(localMidnight), '2026-08-31');
  const nextDay = new Date('2026-08-31T00:00:00');
  nextDay.setDate(nextDay.getDate() + 1);
  assert.equal(app.localDateString(nextDay), '2026-09-01');
});

test('actionAttrs keeps an untrusted document ID in a data attribute instead of executable JavaScript', () => {
  const attrs = app.actionAttrs('openEventDetail', `x');alert(1);//`);
  assert.match(attrs, /^data-app-action="openEventDetail" data-id="/);
  assert.doesNotMatch(attrs, /onclick=/);
  assert.match(attrs, /&#39;/);
});

test('coerceEventFieldValue stores select-backed numeric fields as numbers, not strings', () => {
  assert.strictEqual(app.coerceEventFieldValue('durationMinutes', '30'), 30);
  assert.strictEqual(app.coerceEventFieldValue('distanceMeters', '1200'), 1200);
  assert.strictEqual(app.coerceEventFieldValue('intakePercent', '75'), 75);
  assert.strictEqual(app.coerceEventFieldValue('kilograms', '3.5'), 3.5);
  assert.strictEqual(app.coerceEventFieldValue('kilograms', ''), null);
});

test('coerceEventFieldValue leaves non-numeric fields untouched', () => {
  assert.strictEqual(app.coerceEventFieldValue('score', '4'), '4');
  assert.strictEqual(app.coerceEventFieldValue('amount', 'more'), 'more');
  assert.strictEqual(app.coerceEventFieldValue('clinic', 'みなと動物病院'), 'みなと動物病院');
});

test('scheduledDoseTaken hides a schedule row once its dose is logged, including multi-medication events', () => {
  const events = [
    { type: 'medication', details: { medicationId: 'med-a', medicationIds: ['med-a', 'med-b'], scheduledTime: '08:00' } },
  ];
  // 先頭薬・2件目の薬いずれも、同じ予定時刻なら完了扱いにする。
  assert.equal(app.scheduledDoseTaken(events, 'med-a', '08:00'), true);
  assert.equal(app.scheduledDoseTaken(events, 'med-b', '08:00'), true);
  // 時刻違い・薬違い・手入力(scheduledTimeなし)は予定行を残す。
  assert.equal(app.scheduledDoseTaken(events, 'med-a', '20:00'), false);
  assert.equal(app.scheduledDoseTaken(events, 'med-c', '08:00'), false);
  assert.equal(app.scheduledDoseTaken([{ type: 'medication', details: { medicationId: 'med-a', scheduledTime: null } }], 'med-a', '08:00'), false);
});

test('medScheduledTimes prefers the free scheduledTimes and falls back to reminderTimes for legacy meds', () => {
  // scheduledTimes があればそれを使う
  assert.deepEqual(app.medScheduledTimes({ scheduledTimes: ['07:00', '19:00'], reminderTimes: ['08:00'] }), ['07:00', '19:00']);
  // scheduledTimes 未設定の既存薬は reminderTimes を予定時刻として読む（互換フォールバック）
  assert.deepEqual(app.medScheduledTimes({ reminderTimes: ['08:00', '20:00'] }), ['08:00', '20:00']);
  // 空配列も未設定として扱う
  assert.deepEqual(app.medScheduledTimes({ scheduledTimes: [], reminderTimes: ['21:00'] }), ['21:00']);
  // どちらも無ければ空
  assert.deepEqual(app.medScheduledTimes({}), []);
  assert.deepEqual(app.medScheduledTimes(null), []);
});
