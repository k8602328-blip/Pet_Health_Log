'use strict';

// レポートの日次サマリー・タイムライン・グラフが「本日の記録」のクイック記録(events)を
// 反映するかの回帰テスト。旧UIでは records(旧「今日の記録」)だけを見ており、events で
// 記録した飲水・便・尿・体重・食欲・症状がレポートに出ていなかった。

const assert = require('node:assert/strict');
const test = require('node:test');
const { loadApp } = require('./load-app');

const app = loadApp();
const { dailyRecordFromEvents, mergeDailyRecordsWithEvents, derivedSymptomsFromEvents, validMealIntakePercents } = app;

const ev = (type, time, details) => ({ type, time, date: '2026-09-01', details });

test('dailyRecordFromEvents: 飲水・尿・便は当日の最後のイベントを採る', () => {
  const out = dailyRecordFromEvents([
    ev('water', '08:00', { amount: 'normal' }),
    ev('water', '20:00', { amount: 'more' }),
    ev('urine', '09:00', { amount: 'less' }),
    ev('stool', '10:00', { score: 3 }),
    ev('stool', '18:00', { score: 6 }),
  ]);
  assert.equal(out.water, '多い');
  assert.equal(out.urine, '少ない');
  assert.equal(out.stool, 6);
});

test('dailyRecordFromEvents: 体重は最後の記録、食欲はごはんの摂取率の平均、症状は和集合', () => {
  const out = dailyRecordFromEvents([
    ev('weight', '07:00', { kilograms: 4.1 }),
    ev('weight', '21:00', { kilograms: 4.2 }),
    ev('meal', '07:30', { intakePercent: 50 }),
    ev('meal', '19:30', { intakePercent: 100 }),
    ev('symptom', '10:00', { symptoms: ['嘔吐', '軟便'] }),
    ev('symptom', '15:00', { symptoms: ['軟便', '元気がない'] }),
    ev('medication', '08:00', {}),
    ev('medication', '20:00', {}),
  ]);
  assert.equal(out.weight, 4.2);
  assert.equal(out.appetite, '75');
  assert.deepEqual([...out.symptoms].sort(), ['元気がない', '嘔吐', '軟便']);
  assert.equal(out.medEventCount, 2);
});

test('dailyRecordFromEvents: 該当イベントが無い項目はキーを作らない', () => {
  const out = dailyRecordFromEvents([ev('play', '09:00', { durationMinutes: 10 })]);
  assert.deepEqual(Object.keys(out).sort(), []);
});

test('mergeDailyRecordsWithEvents: records が無くても events から日次記録を合成する', () => {
  const events = [
    ev('water', '08:00', { amount: 'more' }),
    ev('stool', '13:00', { score: 5 }),
    { ...ev('symptom', '15:00', { symptoms: ['嘔吐'] }) },
  ];
  const merged = mergeDailyRecordsWithEvents([], events, '2026-09-01', '2026-09-07');
  assert.equal(merged.length, 1);
  assert.equal(merged[0].date, '2026-09-01');
  assert.equal(merged[0].water, '多い');
  assert.equal(merged[0].stool, 5);
  assert.deepEqual(merged[0].symptoms, ['嘔吐']);
});

test('mergeDailyRecordsWithEvents: 旧recordの明示値は尊重し、空欄だけ events で補完、症状は統合', () => {
  const records = [{ date: '2026-09-01', petId: 'p1', water: 'いつも通り', cibdai: { attitude: 1 }, symptoms: ['食欲不振'] }];
  const events = [
    ev('water', '20:00', { amount: 'more' }),   // 旧recordに water があるので上書きしない
    ev('urine', '09:00', { amount: 'less' }),    // 旧recordに urine が無いので補完する
    ev('symptom', '15:00', { symptoms: ['嘔吐'] }),
  ];
  const merged = mergeDailyRecordsWithEvents(records, events, '2026-09-01', '2026-09-07');
  assert.equal(merged[0].water, 'いつも通り');
  assert.equal(merged[0].urine, '少ない');
  assert.deepEqual(merged[0].symptoms.sort(), ['嘔吐', '食欲不振']);
  assert.deepEqual(merged[0].cibdai, { attitude: 1 });
});

test('derivedSymptomsFromEvents: 便スコアはその日の最悪値で下痢/軟便のどちらか一方', () => {
  assert.deepEqual(derivedSymptomsFromEvents([ev('stool', '10:00', { score: 4 }), ev('stool', '18:00', { score: 7 })]), ['下痢']);
  assert.deepEqual(derivedSymptomsFromEvents([ev('stool', '10:00', { score: 3 }), ev('stool', '18:00', { score: 5 })]), ['軟便']);
  assert.deepEqual(derivedSymptomsFromEvents([ev('stool', '10:00', { score: 3 })]), []);
});

test('derivedSymptomsFromEvents: ごはん50%以下で食欲不振、体温39.5℃以上で発熱', () => {
  assert.deepEqual(derivedSymptomsFromEvents([ev('meal', '08:00', { intakePercent: 100 }), ev('meal', '19:00', { intakePercent: 25 })]), ['食欲不振']);
  assert.deepEqual(derivedSymptomsFromEvents([ev('meal', '08:00', { intakePercent: 75 })]), []);
  assert.deepEqual(derivedSymptomsFromEvents([ev('temperature', '21:00', { celsius: 39.6 })]), ['発熱']);
  assert.deepEqual(derivedSymptomsFromEvents([ev('temperature', '21:00', { celsius: 38.9 })]), []);
});

test('derivedSymptomsFromEvents: 便→食欲→体温の順で複数返す', () => {
  const out = derivedSymptomsFromEvents([
    ev('stool', '13:00', { score: 6 }),
    ev('meal', '08:00', { intakePercent: 40 }),
    ev('temperature', '21:00', { celsius: 40.1 }),
  ]);
  assert.deepEqual(out, ['下痢', '食欲不振', '発熱']);
});

test('mergeDailyRecordsWithEvents: 自動判定症状は derivedSymptoms に入り、手入力の symptoms とは別枠', () => {
  const events = [
    ev('stool', '13:00', { score: 7 }),
    ev('symptom', '15:00', { symptoms: ['嘔吐'] }),
  ];
  const merged = mergeDailyRecordsWithEvents([], events, '2026-09-01', '2026-09-07');
  assert.deepEqual(merged[0].symptoms, ['嘔吐']);
  assert.deepEqual(merged[0].derivedSymptoms, ['下痢']);
});

// --- 食事量(intakePercent)の未入力・不正値が0%として集計され「食欲不振」を誤付与する問題の回帰テスト ---

test('validMealIntakePercents: 未入力(null/undefined/空文字/空白)は除外する', () => {
  const events = [
    ev('meal', '07:00', { intakePercent: null }),
    ev('meal', '08:00', { intakePercent: undefined }),
    ev('meal', '09:00', {}),                       // intakePercent キー自体が無い
    ev('meal', '10:00', { intakePercent: '' }),
    ev('meal', '11:00', { intakePercent: '   ' }),
    ev('meal', '12:00', { intakePercent: '\t\n' }),
  ];
  assert.deepEqual(validMealIntakePercents(events), []);
});

test('validMealIntakePercents: 不正値(非数値文字列・NaN・Infinity・真偽値・配列・オブジェクト・範囲外)は除外する', () => {
  const events = [
    ev('meal', '07:00', { intakePercent: 'abc' }),
    ev('meal', '08:00', { intakePercent: NaN }),
    ev('meal', '09:00', { intakePercent: Infinity }),
    ev('meal', '10:00', { intakePercent: -Infinity }),
    ev('meal', '11:00', { intakePercent: true }),
    ev('meal', '12:00', { intakePercent: false }),
    ev('meal', '13:00', { intakePercent: [] }),
    ev('meal', '14:00', { intakePercent: [50] }),
    ev('meal', '15:00', { intakePercent: {} }),
    ev('meal', '16:00', { intakePercent: 101 }),
    ev('meal', '17:00', { intakePercent: -1 }),
    ev('meal', '18:00', { intakePercent: 150 }),
  ];
  assert.deepEqual(validMealIntakePercents(events), []);
});

test('validMealIntakePercents: 明示的な0・"0"・50・50超・100 は有効値として残す', () => {
  const events = [
    ev('meal', '06:00', { intakePercent: 0 }),
    ev('meal', '07:00', { intakePercent: '0' }),
    ev('meal', '08:00', { intakePercent: 50 }),
    ev('meal', '09:00', { intakePercent: '50' }),
    ev('meal', '10:00', { intakePercent: 75 }),
    ev('meal', '11:00', { intakePercent: 100 }),
    ev('meal', '12:00', { intakePercent: ' 100 ' }),
  ];
  assert.deepEqual(validMealIntakePercents(events), [0, 0, 50, 50, 75, 100, 100]);
});

test('dailyRecordFromEvents: 有効値と未入力値が混在する日は有効値だけで平均を出す', () => {
  const out = dailyRecordFromEvents([
    ev('meal', '07:00', { intakePercent: 100 }),
    ev('meal', '12:00', { intakePercent: null }),   // 未入力 → 集計に入れない
    ev('meal', '15:00', { intakePercent: '' }),      // 未入力 → 集計に入れない
    ev('meal', '19:00', { intakePercent: 80 }),
  ]);
  assert.equal(out.appetite, '90'); // (100 + 80) / 2
});

test('dailyRecordFromEvents: 有効な食事量が1件も無い日は appetite を0%で補完しない', () => {
  const out = dailyRecordFromEvents([
    ev('meal', '07:00', { intakePercent: null }),
    ev('meal', '12:00', { intakePercent: '' }),
    ev('meal', '19:00', { intakePercent: 'abc' }),
  ]);
  assert.equal('appetite' in out, false);
});

test('dailyRecordFromEvents: 明示的な0%は有効な0として平均に反映する', () => {
  const out = dailyRecordFromEvents([
    ev('meal', '07:00', { intakePercent: 0 }),
    ev('meal', '19:00', { intakePercent: '0' }),
  ]);
  assert.equal(out.appetite, '0');
});

test('derivedSymptomsFromEvents: 未入力・不正値だけの日は食欲不振を自動付与しない', () => {
  assert.deepEqual(derivedSymptomsFromEvents([
    ev('meal', '07:00', { intakePercent: null }),
    ev('meal', '12:00', { intakePercent: '' }),
    ev('meal', '19:00', { intakePercent: '   ' }),
  ]), []);
  assert.deepEqual(derivedSymptomsFromEvents([
    ev('meal', '07:00', { intakePercent: undefined }),
    ev('meal', '19:00', { intakePercent: 150 }),
  ]), []);
});

test('derivedSymptomsFromEvents: 有効値と未入力値の混在でも有効値だけで食欲不振を判定する', () => {
  // 有効値は 80 のみ(50超) → 食欲不振は付かない
  assert.deepEqual(derivedSymptomsFromEvents([
    ev('meal', '07:00', { intakePercent: 80 }),
    ev('meal', '12:00', { intakePercent: null }),
    ev('meal', '19:00', { intakePercent: '' }),
  ]), []);
  // 有効値に 50 が含まれる → 食欲不振
  assert.deepEqual(derivedSymptomsFromEvents([
    ev('meal', '07:00', { intakePercent: 90 }),
    ev('meal', '12:00', { intakePercent: null }),
    ev('meal', '19:00', { intakePercent: 50 }),
  ]), ['食欲不振']);
});

test('derivedSymptomsFromEvents: 明示的な0%は50%以下として食欲不振を付与する', () => {
  assert.deepEqual(derivedSymptomsFromEvents([ev('meal', '07:00', { intakePercent: 0 })]), ['食欲不振']);
  assert.deepEqual(derivedSymptomsFromEvents([ev('meal', '07:00', { intakePercent: '0' })]), ['食欲不振']);
});

test('derivedSymptomsFromEvents: しきい値50はちょうどで食欲不振、50超は付かない', () => {
  assert.deepEqual(derivedSymptomsFromEvents([ev('meal', '07:00', { intakePercent: 50 })]), ['食欲不振']);
  assert.deepEqual(derivedSymptomsFromEvents([ev('meal', '07:00', { intakePercent: 51 })]), []);
  assert.deepEqual(derivedSymptomsFromEvents([ev('meal', '07:00', { intakePercent: 100 })]), []);
});

test('mergeDailyRecordsWithEvents: 未入力の食事量だけの日は appetite を補完せず食欲不振も付けない', () => {
  const events = [
    ev('meal', '07:00', { intakePercent: null }),
    ev('meal', '19:00', { intakePercent: '' }),
    ev('water', '08:00', { amount: 'normal' }),
  ];
  const merged = mergeDailyRecordsWithEvents([], events, '2026-09-01', '2026-09-07');
  assert.equal(merged.length, 1);
  assert.equal(merged[0].appetite === undefined || merged[0].appetite === null || merged[0].appetite === '', true);
  assert.deepEqual(merged[0].symptoms, []);
  assert.equal('derivedSymptoms' in merged[0], false);
});

test('mergeDailyRecordsWithEvents: 旧recordの明示的な appetite と手入力症状は events の未入力食事量で変化しない', () => {
  const records = [{ date: '2026-09-01', petId: 'p1', appetite: '正常', symptoms: ['嘔吐'] }];
  const events = [
    ev('meal', '07:00', { intakePercent: null }),
    ev('meal', '19:00', { intakePercent: '   ' }),
  ];
  const merged = mergeDailyRecordsWithEvents(records, events, '2026-09-01', '2026-09-07');
  assert.equal(merged[0].appetite, '正常');
  assert.deepEqual(merged[0].symptoms, ['嘔吐']);
  assert.equal('derivedSymptoms' in merged[0], false);
});

test('mergeDailyRecordsWithEvents: 期間外の日付は除外し、日付昇順で返す', () => {
  const events = [
    ev('water', '08:00', { amount: 'normal' }),
    { type: 'water', time: '08:00', date: '2026-09-05', details: { amount: 'more' } },
    { type: 'water', time: '08:00', date: '2026-08-20', details: { amount: 'less' } },
  ];
  const merged = mergeDailyRecordsWithEvents([], events, '2026-09-01', '2026-09-07');
  assert.deepEqual(merged.map(r => r.date), ['2026-09-01', '2026-09-05']);
});

test('症状の日数: 同日の複数記録・自動判定は1日、別日の記録は別の日として数える', () => {
  const events = [
    ev('symptom', '08:00', { symptoms: ['下痢'] }),
    ev('symptom', '12:00', { symptoms: ['下痢'] }),
    ev('stool', '13:00', { score: 7 }),
    { ...ev('symptom', '08:00', { symptoms: ['下痢'] }), date:'2026-09-02' },
  ];
  const days = mergeDailyRecordsWithEvents([], events, null, null);
  const counts = {};
  for(const day of days) for(const symptom of new Set([...(day.symptoms || []), ...(day.derivedSymptoms || [])])) counts[symptom] = (counts[symptom] || 0) + 1;
  assert.equal(counts['下痢'], 2);
});
