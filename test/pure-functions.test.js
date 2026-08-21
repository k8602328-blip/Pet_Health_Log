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
