// もふもふカルテ サンプルレポート用の架空データ。
//
// 実ユーザーの記録は一切使わない。ここで組み立てるのは完全な作り物で、
// 値は決定的（乱数を使わない）。日付・ペット・薬などを変えたいときはこのファイルだけ編集する。
//
// レポート生成処理（index.html の App.printReport）が読むのは:
//   - state.pets / state.currentPetId       … 見出し・CIBDAI 表示の有無
//   - state.records（レガシー日次記録）       … 体重/食欲グラフ・日々の状態&症状タイムライン・毎日の記録の下段サマリー
//   - state.events（クイック記録／タイムライン）… 毎日の記録の24時間軸・お散歩グラフ・受診歴
//   - state.medications / state.mealProfiles / state.preventions … 各一覧表
//   - state.entitlements.subscriptionActive  … 有料限定セクション（食欲/お散歩グラフ・タイムライン）
//
// 期間は PERIOD_FROM〜PERIOD_TO（両端含む）。31日以内にすること（reportRangeError 制約）。

export const PET_ID = 'sample-pet';
export const PERIOD_FROM = '2026-08-16';
export const PERIOD_TO = '2026-09-02'; // 18日間 → 毎日の記録は4日/ページで、5ページ目に残り2日だけの
                                       // 「最終ページ（枠寸法は維持・空枠は作らない）」が見本に入る。
                                       // 14日を超えるのでタイムラインの2分割（PRINT_TIMELINE_CHUNK_DAYS）も見本に含まれる。

const MED_GABA = 'sample-med-gabapentin';
const MED_PROBIOTIC = 'sample-med-probiotic';

function ymd(d) {
  // ローカル日付をそのまま YYYY-MM-DD にする（toISOString は UTC へずれるため使わない）
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function eachDate(from, to) {
  const out = [];
  const d = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (d <= end) {
    out.push(ymd(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}
export const DATES = eachDate(PERIOD_FROM, PERIOD_TO);

// 日ごとの「症状」。症状タイムラインと症状出現回数に効く。
const SYMPTOM_PLAN = {
  '2026-08-18': ['嘔吐', '軟便'],
  '2026-08-19': ['軟便'],
  '2026-08-20': ['食欲不振'],
  '2026-08-22': ['軟便'],
  '2026-08-25': ['嘔吐'],
  '2026-08-26': ['元気がない'],
  '2026-08-29': ['軟便'],
};

// 日ごとの便スコア（1〜7）。未指定日は3（理想）。
const STOOL_PLAN = {
  '2026-08-18': 6, '2026-08-19': 5, '2026-08-20': 4, '2026-08-22': 5,
  '2026-08-25': 4, '2026-08-29': 5, '2026-08-30': 4,
};

// ゆるやかに増える体重（kg）。グラフの線が単調にならないよう軽く上下させる。
function weightFor(i) {
  const base = 4.02 + i * 0.011;
  const wobble = [0, 0.03, -0.02, 0.01, 0.04, -0.01, 0.02, 0.05, 0.03, 0.06, 0.04, 0.07, 0.05, 0.08, 0.06, 0.09][i] || 0;
  return Math.round((base + wobble) * 100) / 100;
}
// 食欲（%）。序盤に不調、中盤で回復。
const APPETITE_PLAN = {
  '2026-08-18': 50, '2026-08-19': 50, '2026-08-20': 25, '2026-08-21': 75,
  '2026-08-25': 75, '2026-08-26': 50,
};
function appetiteFor(date) {
  return String(APPETITE_PLAN[date] != null ? APPETITE_PLAN[date] : 100);
}

function waterFor(date) {
  if (['2026-08-18', '2026-08-25'].includes(date)) return '多い';
  if (['2026-08-20'].includes(date)) return '少ない';
  return 'いつも通り';
}
function urineFor(date) {
  if (['2026-08-18', '2026-08-19', '2026-08-25'].includes(date)) return '多い';
  if (['2026-08-20'].includes(date)) return '少ない';
  return 'いつも通り';
}

// CIBDAI（IBD モニタリング）。0〜3/項目。中盤までやや高く、後半で寛解目安まで下がる。
function cibdaiFor(i) {
  if (i <= 2) return { attitude: 1, appetite: 2, vomiting: 1, consistency: 2, frequency: 1, weightLoss: 0 }; // 7 中等度
  if (i <= 6) return { attitude: 1, appetite: 1, vomiting: 0, consistency: 1, frequency: 1, weightLoss: 0 }; // 4 軽度
  return { attitude: 0, appetite: 0, vomiting: 0, consistency: 1, frequency: 0, weightLoss: 0 }; // 1 寛解目安
}

export const pet = {
  id: PET_ID,
  name: 'モカ',
  species: '猫',
  breed: 'ミックス',
  gender: 'female',
  honorific: 'chan',
  birthday: '2021-05-14',
  trackCibdai: true,
};

export const medications = [
  {
    id: MED_GABA, petId: PET_ID, name: 'ガバペンチン', dosage: '25mg 1回1カプセル',
    dosesPerDay: 2, startDate: '2026-08-10', endDate: '', prescriber: 'さくら動物病院',
    scheduledTimes: ['08:00', '20:00'], reminderTimes: [],
  },
  {
    id: MED_PROBIOTIC, petId: PET_ID, name: '整腸剤（プロバイオティクス）', dosage: '1包',
    dosesPerDay: 1, startDate: '2026-08-15', endDate: '2026-08-28', prescriber: 'さくら動物病院',
    scheduledTimes: ['08:00'], reminderTimes: [],
  },
];

export const mealProfiles = [
  { id: 'mp-morning', petId: PET_ID, label: '朝ごはん（療法食ドライ）', description: '消化器サポート ドライ 20g', suggestedTime: '07:30', active: true, sortOrder: 1 },
  { id: 'mp-night', petId: PET_ID, label: '夜ごはん（療法食ウェット）', description: '消化器サポート パウチ 1/2袋', suggestedTime: '19:30', active: true, sortOrder: 2 },
  { id: 'mp-treat', petId: PET_ID, label: '投薬用おやつ', description: 'ちゅ〜る 1本（内服にかぶせる用）', suggestedTime: '', active: true, sortOrder: 3 },
];

export const preventions = [
  { id: 'pv-1', petId: PET_ID, category: '混合ワクチン', name: '3種混合', date: '2026-04-12', nextDate: '2027-04-12', clinic: 'さくら動物病院' },
  { id: 'pv-2', petId: PET_ID, category: 'ノミ・マダニ', name: 'スポットオン', date: '2026-08-01', nextDate: '2026-09-01', clinic: 'さくら動物病院' },
  { id: 'pv-3', petId: PET_ID, category: 'フィラリア', name: '通年予防（内服）', date: '2026-08-01', nextDate: '2026-09-01', clinic: 'さくら動物病院' },
];

// レガシー日次記録（旧「今日の記録」モーダル）。
// 現行UIでは飲水・便・尿・体重・食欲・症状はすべてクイック記録(events)へ入り、この
// モーダルはメニュー奥の「以前の日次記録」からしか開けない。唯一クイック記録に対応が
// ないCIBDAIスコアだけ、数日おきにここへ記録する想定にする（実際の併用パターン）。
// レポートの日次サマリー・タイムライン・グラフの飲水/便/尿/体重/食欲/症状は events 由来。
export const records = DATES
  .map((date, i) => ({ date, i }))
  .filter(({ i }) => i % 3 === 0)
  .map(({ date, i }) => ({
    id: `rec-${date}`, petId: PET_ID, date,
    cibdai: cibdaiFor(i),
  }));

// クイック記録イベント（毎日の記録の24時間軸・お散歩グラフ・受診歴の素）
export const events = [];
let evSeq = 0;
function pushEvent(date, time, type, details, note) {
  events.push({
    id: `ev-${date}-${String(++evSeq).padStart(3, '0')}`,
    petId: PET_ID, date, time, type,
    sortKey: `${date}T${time}`,
    details: details || {},
    note: note || '',
  });
}

DATES.forEach((date, i) => {
  const stool = STOOL_PLAN[date] != null ? STOOL_PLAN[date] : 3;
  const appetitePct = Number(appetiteFor(date));

  pushEvent(date, '07:35', 'medication', { medicationId: MED_GABA, medicationLabel: 'ガバペンチン', scheduledTime: '08:00' });
  if (date <= '2026-08-28') {
    pushEvent(date, '07:36', 'medication', { medicationId: MED_PROBIOTIC, medicationLabel: '整腸剤', scheduledTime: '08:00' });
  }
  pushEvent(date, '07:40', 'meal', { intakePercent: appetitePct, mealProfileLabels: ['朝ごはん（療法食ドライ）'] });
  pushEvent(date, '08:05', 'urine', { amount: urineFor(date) === '多い' ? 'more' : urineFor(date) === '少ない' ? 'less' : 'normal' });
  if (i % 2 === 0) {
    pushEvent(date, '09:15', 'play', { durationMinutes: 10 + (i % 3) * 5 }, '猫じゃらし');
  }
  pushEvent(date, '12:30', 'water', { amount: waterFor(date) === '多い' ? 'more' : waterFor(date) === '少ない' ? 'less' : 'normal' });
  if (stool >= 4) {
    pushEvent(date, '13:10', 'stool', { score: stool }, stool >= 6 ? '泥状。においつよめ' : '');
  } else {
    pushEvent(date, '13:10', 'stool', { score: stool });
  }
  if ((SYMPTOM_PLAN[date] || []).length) {
    pushEvent(date, '15:20', 'symptom', { symptoms: SYMPTOM_PLAN[date] });
  }
  if (i % 3 === 1) {
    pushEvent(date, '16:40', 'walk', { durationMinutes: 10 + (i % 4) * 5, distanceMeters: 260 + (i % 5) * 45 }, 'ハーネスでベランダ〜庭');
  }
  pushEvent(date, '19:35', 'meal', { intakePercent: Math.min(100, appetitePct + 25), mealProfileLabels: ['夜ごはん（療法食ウェット）'] });
  pushEvent(date, '20:10', 'medication', { medicationId: MED_GABA, medicationLabel: 'ガバペンチン', scheduledTime: '20:00' });
  if (i % 3 === 0 || i === DATES.length - 1) {
    pushEvent(date, '21:00', 'weight', { kilograms: weightFor(i) });
  }
  if ([0, 3, 6, 9, 12].includes(i)) {
    // i=3(08-19)は微熱ぎみ、それ以外は平熱。体温39.5℃以上は「発熱」として自動集計される。
    pushEvent(date, '21:05', 'temperature', { celsius: i === 3 ? 39.6 : 38.4 + (i % 2) * 0.2 });
  }
  if (i === 4) {
    pushEvent(date, '22:10', 'memo', { text: '夜中に一度吐いた。毛玉っぽい。翌朝は元気。' });
  }
});

// 記録が午後〜夜に集中した日（体調を崩して頻回に排便・投薬・おやつを記録したケース）。
// 24時間軸の重なり回避（前方＋後方パス）の見本として1日だけ盛り込む。
const BUSY_DAY = '2026-08-26';
[
  ['13:05', 'stool', { score: 6 }, '軟便'],
  ['13:40', 'water', { amount: 'more' }],
  ['14:15', 'stool', { score: 6 }],
  ['14:50', 'treat', { item: '投薬用ちゅ〜る' }],
  ['15:20', 'medication', { medicationLabel: '制吐剤（頓服）' }, '嘔吐したため追加'],
  ['15:55', 'symptom', { symptoms: ['嘔吐', '元気がない'] }],
  ['16:30', 'stool', { score: 7 }, '水様。少量'],
  ['17:10', 'water', { amount: 'more' }],
  ['17:45', 'urine', { amount: 'less' }],
  ['18:20', 'stool', { score: 6 }],
  ['18:55', 'treat', { item: '投薬用ちゅ〜る' }],
  ['19:30', 'meal', { intakePercent: 25, mealProfileLabels: ['夜ごはん（療法食ウェット）'] }],
  ['20:40', 'medication', { medicationLabel: '整腸剤（追加）' }],
  ['21:00', 'temperature', { celsius: 39.8 }],
  ['21:15', 'stool', { score: 6 }],
  ['22:00', 'symptom', { symptoms: ['軟便'] }],
].forEach(([time, type, details, note]) => pushEvent(BUSY_DAY, time, type, details, note));

// 記録が夜間（20時以降）に集中した日。24時間軸の「下端超過 → 全体を上方向へ平行移動」
// （順序と最小間隔は保つ）の見本として1日だけ盛り込む。件数は DAY_LANE_DENSE_LIMIT 未満に
// 収め、時刻配置のまま補正されることを確認する。長い要約が1行で…省略されるケースも混ぜる。
const NIGHT_DAY = '2026-08-30';
[
  ['20:05', 'stool', { score: 5 }],
  ['20:35', 'water', { amount: 'more' }],
  ['21:05', 'symptom', { symptoms: ['軟便', '元気がない'] }],
  ['21:30', 'treat', { item: '投薬用ちゅ〜る' }],
  ['21:55', 'medication', { medicationLabel: '制吐剤（マロピタント）皮下注射 体重換算1.0mg/kg 夜間救急にて実施' }, '嘔吐が続くため追加'],
  ['22:20', 'stool', { score: 6 }, '泥状'],
  ['22:45', 'water', { amount: 'more' }],
  ['23:10', 'urine', { amount: 'normal' }],
  ['23:35', 'symptom', { symptoms: ['嘔吐'] }],
].forEach(([time, type, details, note]) => pushEvent(NIGHT_DAY, time, type, details, note));

// 受診（毎日の記録の病院イベント → 受診歴セクション）
pushEvent('2026-08-18', '10:30', 'visit', {
  clinic: 'さくら動物病院', reason: '3日前からの嘔吐・軟便', diagnosis: '慢性腸症の疑い（IBD/フードアレルギー鑑別中）',
  treatment: '制吐剤・整腸剤処方、消化器サポート食へ変更、CIBDAI記録開始', followUpDate: '2026-08-25',
}, '血液検査は大きな異常なし。1週間後に再診。');
pushEvent('2026-08-25', '11:00', 'visit', {
  clinic: 'さくら動物病院', reason: '再診（嘔吐・軟便の経過）', diagnosis: '慢性腸症（食事反応性腸症の可能性）',
  treatment: '療法食継続、ガバペンチン継続、整腸剤は今週で終了予定', followUpDate: '2026-09-08',
}, 'CIBDAI 低下傾向。体重維持。次回は2週間後。');
pushEvent('2026-08-30', '23:50', 'visit', {
  clinic: '夜間動物救急センター', reason: '夜間の反復嘔吐（4回）と元気消失', diagnosis: '急性胃腸炎の増悪（慢性腸症のフレア）',
  treatment: '皮下輸液、制吐剤（マロピタント）皮下注、絶食12時間の指示、翌日かかりつけ受診を指示',
  followUpDate: '2026-08-31',
}, '脱水軽度。血糖・電解質は正常範囲。');
pushEvent('2026-08-31', '09:40', 'visit', {
  clinic: 'さくら動物病院', reason: '夜間救急からの申し送り受診', diagnosis: '慢性腸症フレア後の経過観察',
  treatment: '低脂肪療法食へ一時変更、ガバペンチン減量、整腸剤を再開、1週間後に体重再測定',
  followUpDate: '2026-09-07',
}, '嘔吐は止まっている。少量頻回給餌を継続。');

export const fixture = {
  generatedNote: 'もふもふカルテ サンプルレポート用の架空データ（実データ不使用）',
  period: { from: PERIOD_FROM, to: PERIOD_TO },
  pet,
  currentPetId: PET_ID,
  entitlements: { subscriptionActive: true },
  records,
  events,
  medications,
  mealProfiles,
  preventions,
};

export default fixture;
