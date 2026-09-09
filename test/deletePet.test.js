'use strict';

// App.deletePet をスタブ化した firebase/確認ダイアログの上で実際に実行し、
// 破壊的処理の安全条件を検証する。ネットワーク・本番データには一切触れない
// (すべて loadApp() へ渡すインメモリのフェイクで完結する)。
//
// 検証対象(公開Web版レビュー指摘3):
//  - 対象は records/events/mealProfiles/medications/preventions の5コレクションだけで、
//    いずれも where('petId','==',petId) で当該ペットに限定する
//  - 1コレクション400件を超えるときはバッチを分割してコミットする
//  - 5コレクションすべての削除に成功したあとにだけ pets ドキュメントを削除する
//  - 読み取り失敗・バッチコミット失敗のあとは、後続コレクションと pets を削除しない
//  - 家族アカウント閲覧中・確認ダイアログのキャンセル時は一切書き込まない

const assert = require('node:assert/strict');
const test = require('node:test');
const { loadApp } = require('./load-app');

const SUBCOLLECTIONS = ['records', 'events', 'mealProfiles', 'medications', 'preventions'];

// spec:
//   counts          : { [collection]: number }  where().get() が返す件数
//   failReadOn       : collection 名  その get() で例外
//   failCommitOnCount: number         そのコミット回目(1始まり)で例外
function makeHarness(spec = {}) {
  const counts = spec.counts || {};
  const calls = {
    log: [],
    where: [],
    commitCount: 0,
    batchDeletedRefs: [],
    docDeletes: [],
    userDocSet: [],
    consoleErrors: [],
  };

  const makeDocs = (name) =>
    Array.from({ length: counts[name] || 0 }, (_, i) => ({
      id: `${name}#${i}`,
      ref: { __path: `users/u1/${name}/${name}#${i}` },
    }));

  const subcollection = (name) => ({
    where(field, op, value) {
      calls.where.push({ name, field, op, value });
      calls.log.push({ op: 'where', name });
      return {
        async get() {
          if (spec.failReadOn === name) {
            throw new Error(`stub read failure on ${name}`);
          }
          return { docs: makeDocs(name) };
        },
      };
    },
    doc(id) {
      return {
        async delete() {
          calls.docDeletes.push({ name, id });
          calls.log.push({ op: 'docDelete', name, id });
        },
      };
    },
  });

  const userDoc = {
    collection: (name) => subcollection(name),
    async set(data, opts) {
      calls.userDocSet.push({ data, opts });
      calls.log.push({ op: 'userDocSet' });
    },
  };

  const db = {
    enablePersistence: () => ({ catch: () => {} }),
    collection(top) {
      assert.equal(top, 'users');
      return { doc: () => userDoc };
    },
    batch() {
      const refs = [];
      return {
        delete(ref) {
          refs.push(ref);
        },
        async commit() {
          calls.commitCount += 1;
          const n = calls.commitCount;
          calls.log.push({ op: 'commit', n });
          if (spec.failCommitOnCount && spec.failCommitOnCount === n) {
            throw new Error(`stub batch commit failure #${n}`);
          }
          for (const ref of refs) calls.batchDeletedRefs.push(ref);
        },
      };
    },
  };

  const firebase = {
    initializeApp: () => {},
    auth: () => ({}),
    firestore: () => db,
    app: () => ({ functions: () => ({}) }),
  };
  firebase.firestore.FieldValue = { serverTimestamp: () => '<ts>' };

  const alerts = [];
  const app = loadApp({
    firebase,
    alert: (msg) => alerts.push(msg),
    confirm: spec.confirm || (() => true),
    prompt: spec.prompt || (() => 'モモ'),
    console: { ...console, error: (...a) => calls.consoleErrors.push(a) },
  });
  app.__household.setCurrentUser({ uid: 'u1' });
  app.state = app.__household.getState();
  app.state.bootPhase = 'ready';
  app.state.linkedOwnerUid = spec.linkedOwnerUid || null;
  app.state.pets = spec.pets || [{ id: 'p1', name: 'モモ' }];
  app.state.currentPetId = 'currentPetId' in spec ? spec.currentPetId : 'p1';

  return { app, calls, alerts };
}

test('対象5コレクションを petId 限定で照会し、成功後に pets を削除する', async () => {
  const { app, calls, alerts } = makeHarness({ counts: { records: 2, events: 1 } });

  await app.App.deletePet('p1');

  assert.deepEqual(calls.where.map((w) => w.name), SUBCOLLECTIONS);
  for (const w of calls.where) {
    assert.equal(w.field, 'petId');
    assert.equal(w.op, '==');
    assert.equal(w.value, 'p1');
  }
  // pets はサブコレクションではなく doc().delete() で最後に消す。
  assert.deepEqual(calls.docDeletes, [{ name: 'pets', id: 'p1' }]);
  const lastWhereIdx = calls.log.map((e) => e.op).lastIndexOf('where');
  const petsDeleteIdx = calls.log.findIndex((e) => e.op === 'docDelete' && e.name === 'pets');
  assert.ok(petsDeleteIdx > lastWhereIdx, 'pets deletion must come after every subcollection query');
  // 選択中ペットを消したので currentPetId を張り替える。
  assert.deepEqual(calls.userDocSet, [{ data: { currentPetId: null }, opts: { merge: true } }]);
  assert.ok(alerts.some((m) => m.includes('削除しました')));
});

test('1コレクション400件超はバッチ分割してコミットする', async () => {
  const { app, calls } = makeHarness({ counts: { records: 901 } });

  await app.App.deletePet('p1');

  // 901 = 400 + 400 + 101 -> コミット3回、削除参照は全901件。
  assert.equal(calls.commitCount, 3);
  assert.equal(calls.batchDeletedRefs.length, 901);
  // 空コレクションはコミットを発生させない。
  assert.deepEqual(calls.where.map((w) => w.name), SUBCOLLECTIONS);
  assert.deepEqual(calls.docDeletes, [{ name: 'pets', id: 'p1' }]);
});

test('読み取り失敗後は後続コレクションも pets も削除しない', async () => {
  const { app, calls, alerts } = makeHarness({
    counts: { records: 3, events: 3, mealProfiles: 3, medications: 3, preventions: 3 },
    failReadOn: 'mealProfiles',
  });

  await app.App.deletePet('p1');

  // records -> events -> mealProfiles(で失敗) まで。medications/preventions は照会しない。
  assert.deepEqual(calls.where.map((w) => w.name), ['records', 'events', 'mealProfiles']);
  assert.deepEqual(calls.docDeletes, []); // pets を消していない
  assert.deepEqual(calls.userDocSet, []);
  assert.ok(calls.consoleErrors.length >= 1);
  assert.ok(alerts.some((m) => m.includes('削除に失敗しました')));
  assert.ok(!alerts.some((m) => m.includes('削除しました。')));
});

test('バッチコミット失敗後は後続コレクションも pets も削除しない', async () => {
  const { app, calls, alerts } = makeHarness({
    counts: { records: 5, events: 5 },
    failCommitOnCount: 1,
  });

  await app.App.deletePet('p1');

  assert.deepEqual(calls.where.map((w) => w.name), ['records']); // 1コレクション目で中断
  assert.equal(calls.commitCount, 1);
  assert.equal(calls.batchDeletedRefs.length, 0); // 失敗したコミットは反映されない
  assert.deepEqual(calls.docDeletes, []);
  assert.deepEqual(calls.userDocSet, []);
  assert.ok(alerts.some((m) => m.includes('削除に失敗しました')));
});

test('家族アカウント閲覧中は照会も削除も一切行わない', async () => {
  const { app, calls, alerts } = makeHarness({ linkedOwnerUid: 'owner-9' });

  await app.App.deletePet('p1');

  assert.deepEqual(calls.where, []);
  assert.equal(calls.commitCount, 0);
  assert.deepEqual(calls.docDeletes, []);
  assert.deepEqual(calls.userDocSet, []);
  assert.ok(alerts.some((m) => m.includes('共有された記録は削除できません')));
});

test('確認ダイアログをキャンセルすると一切書き込まない', async () => {
  for (const spec of [
    { confirm: () => false },
    { prompt: () => null },
    { prompt: () => 'ちがう名前' },
  ]) {
    const { app, calls } = makeHarness(spec);
    await app.App.deletePet('p1');
    assert.deepEqual(calls.where, [], JSON.stringify(spec));
    assert.equal(calls.commitCount, 0);
    assert.deepEqual(calls.docDeletes, []);
    assert.deepEqual(calls.userDocSet, []);
  }
});
