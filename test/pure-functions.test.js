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

test('analyzeWeeklySummary includes the expanded quick-record fields in its weekly overview', () => {
  const events = [
    { date:app.daysAgoStr(0), type:'meal', details:{ intakePercent:75 } },
    { date:app.daysAgoStr(0), type:'temperature', details:{ celsius:38.4 } },
    { date:app.daysAgoStr(1), type:'walk', details:{ durationMinutes:20 } },
    { date:app.daysAgoStr(1), type:'play', details:{ durationMinutes:10 } },
    { date:app.daysAgoStr(2), type:'medication', details:{} },
    { date:app.daysAgoStr(2), type:'treat', details:{} },
  ];
  const result = app.analyzeWeeklySummary([], events);
  assert.equal(result.level, 'stable');
  for (const text of ['食事1回（平均75%）','体温38.4℃','お散歩20分','遊び10分','投薬1回','おやつ1回']) {
    assert.match(result.text, new RegExp(text.replace(/[()]/g, '\\$&')));
  }
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
  assert.equal(app.eventSummary({ type: 'temperature', details: { celsius: 38.6 } }), '38.6℃');
  assert.equal(app.eventSummary({ type: 'medication', details: { medicationLabel: 'テスト薬' } }), 'テスト薬・投薬済み');
});

test('recordedMealIntakes excludes days and meals without a recorded intake instead of treating them as 0%', () => {
  assert.deepEqual(app.recordedMealIntakes([
    { type: 'meal', details: { intakePercent: 75 } },
    { type: 'meal', details: {} },
    { type: 'memo', details: {} },
  ]), [75]);
});

test('recordedMealIntakes delegates to the shared validator: unentered/invalid excluded, explicit 0 kept', () => {
  // 未入力(null/undefined/空文字/空白のみ)と不正値(非数値文字列/真偽値/配列/オブジェクト/
  // NaN/Infinity/0〜100の範囲外)は除外し、明示的な数値0・文字列"0"だけは有効値として残す。
  assert.deepEqual(app.recordedMealIntakes([
    { type: 'meal', details: { intakePercent: null } },
    { type: 'meal', details: { intakePercent: undefined } },
    { type: 'meal', details: { intakePercent: '' } },
    { type: 'meal', details: { intakePercent: '   ' } },
    { type: 'meal', details: { intakePercent: 'abc' } },
    { type: 'meal', details: { intakePercent: true } },
    { type: 'meal', details: { intakePercent: [50] } },
    { type: 'meal', details: { intakePercent: {} } },
    { type: 'meal', details: { intakePercent: NaN } },
    { type: 'meal', details: { intakePercent: Infinity } },
    { type: 'meal', details: { intakePercent: 150 } },
    { type: 'meal', details: { intakePercent: -1 } },
    { type: 'meal', details: { intakePercent: 0 } },
    { type: 'meal', details: { intakePercent: '0' } },
    { type: 'meal', details: { intakePercent: 40 } },
    { type: 'meal', details: { intakePercent: '90' } },
  ]), [0, 0, 40, 90]);
});

// --- 「今週のようす」(analyzeWeeklySummary) に未入力の食事量が0%として混入する問題の回帰テスト ---
// いずれも記録3日分以上を用意し、「記録不足」の早期returnを踏まないようにする。

test('analyzeWeeklySummary: 食事量が全件未入力の日は「食欲の低下」も食事回数の集計も出さない', () => {
  const events = [
    { date: app.daysAgoStr(0), type: 'meal', details: { intakePercent: null } },
    { date: app.daysAgoStr(1), type: 'meal', details: { intakePercent: '' } },
    { date: app.daysAgoStr(2), type: 'meal', details: { intakePercent: '   ' } },
  ];
  const result = app.analyzeWeeklySummary([], events);
  assert.equal(result.level, 'stable');
  assert.doesNotMatch(result.text, /食欲の低下/);
  assert.doesNotMatch(result.text, /食事\d+回/);
});

test('analyzeWeeklySummary: 有効値と未入力値が混在する日は有効値だけで平均を出す', () => {
  const events = [
    { date: app.daysAgoStr(0), type: 'meal', details: { intakePercent: 100 } },
    { date: app.daysAgoStr(1), type: 'meal', details: { intakePercent: null } },
    { date: app.daysAgoStr(2), type: 'meal', details: { intakePercent: 80 } },
  ];
  const result = app.analyzeWeeklySummary([], events);
  assert.equal(result.level, 'stable');
  assert.doesNotMatch(result.text, /食欲の低下/);
  assert.match(result.text, /食事2回（平均90%）/); // (100 + 80) / 2、未入力は件数にも入れない
});

test('analyzeWeeklySummary: 明示的な0%は有効値として週平均に反映し「食欲の低下」を出す', () => {
  const events = [
    { date: app.daysAgoStr(0), type: 'meal', details: { intakePercent: 0 } },
    { date: app.daysAgoStr(1), type: 'meal', details: { intakePercent: '0' } },
    { date: app.daysAgoStr(2), type: 'meal', details: { intakePercent: 0 } },
  ];
  const result = app.analyzeWeeklySummary([], events);
  assert.equal(result.level, 'concern');
  assert.match(result.text, /食欲の低下/);
  assert.match(result.text, /食事3回（平均0%）/);
});

test('analyzeWeeklySummary: 週次は「平均50%以下」で食欲の低下、50%超では出さない(日次の1回以下判定とは別仕様)', () => {
  const low = app.analyzeWeeklySummary([], [
    { date: app.daysAgoStr(0), type: 'meal', details: { intakePercent: 50 } },
    { date: app.daysAgoStr(1), type: 'meal', details: { intakePercent: 50 } },
    { date: app.daysAgoStr(2), type: 'meal', details: { intakePercent: 50 } },
  ]);
  assert.match(low.text, /食欲の低下/);

  // 平均51%(>50) は週次では食欲の低下にしない。日次(derivedSymptomsFromEvents)は
  // 「1回でも50%以下」で食欲不振なので、こちらの51%だけの日は別途対象外になる。
  const ok = app.analyzeWeeklySummary([], [
    { date: app.daysAgoStr(0), type: 'meal', details: { intakePercent: 40 } },
    { date: app.daysAgoStr(1), type: 'meal', details: { intakePercent: 60 } },
    { date: app.daysAgoStr(2), type: 'meal', details: { intakePercent: 53 } },
  ]);
  assert.equal(ok.level, 'stable');
  assert.doesNotMatch(ok.text, /食欲の低下/); // 平均51% なので週次判定は非該当
});

test('analyzeWeeklySummary: 旧recordsの有効な食欲値は維持し、events側の未入力食事量だけ除外する', () => {
  const records = [0, 1, 2].map((n) => ({ date: app.daysAgoStr(n), appetite: 100 }));
  const events = [{ date: app.daysAgoStr(0), type: 'meal', details: { intakePercent: null } }];
  const result = app.analyzeWeeklySummary(records, events);
  assert.equal(result.level, 'stable');
  assert.doesNotMatch(result.text, /食欲の低下/);
  assert.match(result.text, /食事3回（平均100%）/); // 旧record 3件は残り、未入力mealは件数から除外
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
  assert.strictEqual(app.coerceEventFieldValue('celsius', '38.6'), 38.6);
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

test('buildVisitHistory keeps only 本日の記録の病院イベント, newest first', () => {
  const events = [
    { type: 'visit', date: '2026-08-10', note: '再診', details: { clinic: 'みなと動物病院', reason: '嘔吐', diagnosis: '胃腸炎', treatment: '点滴', followUpDate: '2026-08-17' } },
    { type: 'weight', date: '2026-08-12', details: { kilograms: 4.2 } },
    { type: 'visit', date: '2026-09-01', details: { clinic: 'そら動物クリニック' } },
  ];
  const list = app.buildVisitHistory(events);
  assert.deepEqual(list.map(v => v.date), ['2026-09-01', '2026-08-10']);
  // details / note から各項目を取り出す。旧visitsコレクションは参照しない。
  assert.deepEqual(list[1], {
    date: '2026-08-10', clinic: 'みなと動物病院', reason: '嘔吐', diagnosis: '胃腸炎',
    treatment: '点滴', followUpDate: '2026-08-17', memo: '再診',
  });
  assert.deepEqual(list[0], {
    date: '2026-09-01', clinic: 'そら動物クリニック', reason: '', diagnosis: '',
    treatment: '', followUpDate: '', memo: '',
  });
});

test('buildVisitHistory tolerates empty / missing input', () => {
  assert.deepEqual(app.buildVisitHistory(null), []);
  assert.deepEqual(app.buildVisitHistory([{ type: 'memo', date: '2026-01-01', details: {} }]), []);
});

test('aggregateWalkSeries sums 本日の記録 walk events per day into separate time and distance series', () => {
  const events = [
    { type:'walk', date:'2026-09-01', details:{ durationMinutes:20, distanceMeters:800 } },
    { type:'walk', date:'2026-09-01', details:{ durationMinutes:15, distanceMeters:600 } },
    { type:'walk', date:'2026-09-03', details:{ durationMinutes:30 } },              // 距離なし
    { type:'walk', date:'2026-09-04', details:{ distanceMeters:1200 } },             // 時間なし
    { type:'play', date:'2026-09-02', details:{ durationMinutes:10 } },              // お散歩以外は無視
    { type:'walk', date:'2026-09-05', details:{} },                                 // 数値なしは両系列とも対象外
  ];
  const out = app.aggregateWalkSeries(events);
  assert.deepEqual(out.minutes, [
    { date:'2026-09-01', value:35 },
    { date:'2026-09-03', value:30 },
  ]);
  assert.deepEqual(out.distance, [
    { date:'2026-09-01', value:1400 },
    { date:'2026-09-04', value:1200 },
  ]);
});

test('aggregateWalkSeries returns empty series for no walk data', () => {
  assert.deepEqual(app.aggregateWalkSeries(null), { minutes:[], distance:[] });
  assert.deepEqual(app.aggregateWalkSeries([{ type:'weight', date:'2026-01-01', details:{ kilograms:4 } }]), { minutes:[], distance:[] });
});

test('aggregateWalkSeries excludes null / undefined / empty-string but keeps numeric 0', () => {
  const events = [
    { type:'walk', date:'2026-09-01', details:{ durationMinutes:null, distanceMeters:undefined } }, // 欠損: 両系列から除外
    { type:'walk', date:'2026-09-02', details:{ durationMinutes:'', distanceMeters:'' } },          // 空文字: 除外
    { type:'walk', date:'2026-09-03', details:{ durationMinutes:0, distanceMeters:0 } },            // 数値0: 有効な記録
    { type:'walk', date:'2026-09-04', details:{ durationMinutes:0 } },                              // 時間だけ0、距離は欠損
  ];
  const out = app.aggregateWalkSeries(events);
  // 09-01 と 09-02 はどちらの系列にも入らない
  assert.deepEqual(out.minutes, [
    { date:'2026-09-03', value:0 },
    { date:'2026-09-04', value:0 },
  ]);
  assert.deepEqual(out.distance, [
    { date:'2026-09-03', value:0 },
  ]);
});

test('aggregateWalkSeries treats a 0 alongside real values as a valid data point', () => {
  const events = [
    { type:'walk', date:'2026-09-01', details:{ durationMinutes:0, distanceMeters:0 } },
    { type:'walk', date:'2026-09-02', details:{ durationMinutes:20, distanceMeters:900 } },
  ];
  const out = app.aggregateWalkSeries(events);
  assert.deepEqual(out.minutes, [{ date:'2026-09-01', value:0 }, { date:'2026-09-02', value:20 }]);
  assert.deepEqual(out.distance, [{ date:'2026-09-01', value:0 }, { date:'2026-09-02', value:900 }]);
});
