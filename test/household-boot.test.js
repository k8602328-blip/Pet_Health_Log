'use strict';

// 起動・再試行時の共有情報(household)解決の非同期安全性をテストする。
// 時間(setTimeout)と通信(Firestore/functions)を差し替えたスタブで、
// ・正常な個人／共有アカウントの起動
// ・通信が応答しないときの15秒上限でのエラー表示
// ・上限超過後に遅れて返った成功/失敗を採用しないこと
// ・再試行の連打で購読を多重登録しないこと
// ・読み込み中のログアウト／A→Bのアカウント変更でAの遅延応答がBへ影響しないこと
// ・キャッシュ単独・権限拒否で誤った個人表示をしないこと
// ・オーバーレイの禁止URL拒否とクエリ/アンカー保持
// を確認する。

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./load-app');

const HANG = () => new Promise(() => {}); // 永久に解決しないget()

// テスト用のFirestore/functionsスタブ。パスごとに挙動を差し込める。
function makeFirebase(autoSnapshots = true){
  const calls = { subscribed: 0, unsubscribed: 0, writes: [], callables: [], snapshotHandlers: [] };
  // key: `${collectionPath}/${docId}` -> { server, cache, def, update }
  const behaviors = new Map();
  const callableImpls = new Map();

  function register(path, cb, errcb){
    calls.subscribed++;
    const handler = { path, cb: cb || (() => {}), errcb: errcb || (() => {}), live: true };
    calls.snapshotHandlers.push(handler);
    if(autoSnapshots) queueMicrotask(() => {
      if(handler.live) handler.cb({docs:[], data:()=>({}), metadata:{fromCache:false}});
    });
    return () => { calls.unsubscribed++; handler.live = false; };
  }
  function docRef(colPath, id){
    const key = `${colPath}/${id}`;
    return {
      get(opts){
        const b = behaviors.get(key) || {};
        const src = (opts && opts.source) || 'def';
        const fn = b[src] || b.def || (() => Promise.resolve({ exists: true, data: () => (b.data || {}) }));
        return fn();
      },
      update(patch){
        calls.writes.push(['update', key, patch]);
        const b = behaviors.get(key) || {};
        return b.update ? b.update() : Promise.resolve();
      },
      set(v){ calls.writes.push(['set', key, v]); return Promise.resolve(); },
      delete(){ calls.writes.push(['delete', key]); return Promise.resolve(); },
      onSnapshot(options, cb, errcb){ return register(key, cb, errcb); },
      collection(sub){ return colRef(`${key}/${sub}`); },
    };
  }
  function colRef(colPath){
    return {
      doc(id){ return docRef(colPath, id); },
      onSnapshot(options, cb, errcb){ return register(colPath, cb, errcb); },
    };
  }
  const db = {
    enablePersistence: () => ({ catch: () => {} }),
    collection: (name) => colRef(name),
  };
  const functions = {
    httpsCallable(name){
      return (...args) => {
        calls.callables.push([name, args]);
        const impl = callableImpls.get(name);
        return impl ? impl(...args) : Promise.resolve({ data: {} });
      };
    },
  };
  const firebase = {
    initializeApp: () => {},
    auth: Object.assign(() => ({ onAuthStateChanged: () => {} }), {
      GoogleAuthProvider: { credential: () => ({}) },
    }),
    firestore: Object.assign(() => db, { FieldValue: { serverTimestamp: () => 'ts' } }),
    app: () => ({ functions: () => functions }),
  };
  return { firebase, calls, setDoc: (key, spec) => behaviors.set(key, spec), setCallable: (n, fn) => callableImpls.set(n, fn) };
}

function makeDocument(){
  // setBootPhase等はgetElementById(...)がnullなら早期returnする。
  // 起動処理の状態遷移(state.bootPhase等)だけを見たいので、DOMは持たせない。
  return { addEventListener: () => {}, getElementById: () => null, documentElement: { style: {} } };
}

// 起動オーバーレイのDOM効果(読み込み中/エラー表示、再試行ボタンの操作可否)を
// 確認するための最小の擬似DOM。
function makeElement(id){
  const set = new Set();
  return {
    id,
    disabled: false,
    hidden: false,
    textContent: '',
    value: '',
    onclick: null,
    style: {},
    addEventListener(){},
    classList: {
      add: (c) => set.add(c),
      remove: (c) => set.delete(c),
      contains: (c) => set.has(c),
      toggle: (c, force) => {
        const want = force === undefined ? !set.has(c) : !!force;
        if(want) set.add(c); else set.delete(c);
        return want;
      },
    },
  };
}
function makeRichDocument(){
  const els = new Map();
  const ids = ['bootOverlay','bootLoading','bootError','bootErrorTitle','bootErrorDetail','bootRetryButton','bootInviteResendButton',
    'authScreen','switchRecordButton','currentPetDisplayName','usageGuideButton','localPageOverlay','familyModalBackdrop',
    'familyJoinCode','familyJoinButton','familyJoinError','familyError'];
  for(const id of ids) els.set(id, makeElement(id));
  els.get('bootOverlay').classList.add('hidden');
  return {
    addEventListener(){},
    getElementById: (id) => els.get(id) || null,
    documentElement: { style: {} },
    _els: els,
  };
}

// 再読み込みをまたぐ永続化(未確認招待)を確認するための最小localStorage。
// opts.failWrites=true でプライベートモード等の setItem 失敗を再現する。
function makeLocalStorage(seed = {}, opts = {}){
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { if(opts.failWrites) throw new Error('QuotaExceededError'); map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map,
  };
}

function setup(t, opts = {}){
  const fb = makeFirebase(opts.autoSnapshots !== false);
  const origError = console.error;
  const origAlert = global.alert;
  const origConfirm = global.confirm;
  const origLocation = global.location;
  const origHistory = global.history;
  const origLocalStorage = global.localStorage;
  console.error = () => {};
  global.alert = () => {};
  global.confirm = () => true;
  global.location = { search: opts.search || '', pathname: '/', href: 'https://app.example/' + (opts.search || '') };
  global.history = { replaceState: (a, b, url) => { global.location.search = String(url || '').replace(/^[^?]*/, ''); } };
  global.localStorage = opts.localStorage || makeLocalStorage(opts.storageSeed, { failWrites: opts.failStorageWrites });
  t.after(() => {
    console.error = origError;
    global.alert = origAlert;
    global.confirm = origConfirm;
    global.location = origLocation;
    global.history = origHistory;
    global.localStorage = origLocalStorage;
  });

  const doc = opts.richDom ? makeRichDocument() : makeDocument();
  const app = loadApp({
    firebase: fb.firebase,
    document: doc,
    window: { location: { href: opts.appHref || 'https://app.example/', origin: opts.appOrigin || 'https://app.example', protocol: opts.appProtocol || 'https:', host: opts.appHost || 'app.example' }, NativeBridge: { isNative: true } },
    navigator: {},
  });
  // render/startは大量のDOMに触るのでスタブ化(呼ばれた回数だけ数える)。
  const seen = { render: 0, start: 0, checkout: 0 };
  app.App.render = () => { seen.render++; };
  app.App.start = () => { seen.start++; };
  app.App.handleCheckoutRedirect = () => { seen.checkout++; };
  return { app, fb, seen, doc, storage: global.localStorage };
}

const USER_A = { uid: 'uidA', email: 'a@example.com', displayName: 'A' };
const USER_B = { uid: 'uidB', email: 'b@example.com', displayName: 'B' };

test('個人アカウントの起動: 解決できたら ready になり購読を開始する', async (t) => {
  const { app, fb, seen } = setup(t);
  fb.setDoc('users/uidA', { def: () => Promise.resolve({ exists: true, data: () => ({}) }) });
  app.__household.setCurrentUser(USER_A);

  await app.App.bootWithHousehold();

  assert.equal(app.__household.getState().householdStatus, 'personal');
  assert.equal(app.__household.getState().bootPhase, 'ready');
  assert.ok(fb.calls.subscribed > 0, '購読が開始されている');
  assert.equal(seen.start, 1);
});

test('共有アカウントの起動: linkedOwnerUid があれば shared で ready になる', async (t) => {
  const { app, fb } = setup(t);
  fb.setDoc('users/uidA', { def: () => Promise.resolve({ exists: true, data: () => ({ linkedOwnerUid: 'owner1', knownHouseholdUid: 'owner1' }) }) });
  fb.setDoc('users/owner1', { def: () => Promise.resolve({ exists: true, data: () => ({}) }) });
  app.__household.setCurrentUser(USER_A);

  await app.App.bootWithHousehold();

  assert.equal(app.__household.getState().householdStatus, 'shared');
  assert.equal(app.__household.getState().bootPhase, 'ready');
});

test('通信が応答しない: 15秒でエラー表示に切り替わり、通常画面へ進まない', async (t) => {
  const { app, fb, seen } = setup(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fb.setDoc('users/uidA', { server: HANG, cache: HANG });
  app.__household.setCurrentUser(USER_A);

  const p = app.App.bootWithHousehold();
  await Promise.resolve();
  t.mock.timers.tick(app.HOUSEHOLD_BOOT_TIMEOUT_MS);
  await p;

  assert.equal(app.__household.getState().bootPhase, 'error');
  assert.equal(seen.start, 0, '通常画面(start)へは進んでいない');
  assert.equal(fb.calls.subscribed, 0, '購読は開始していない');
});

test('上限超過後に遅れて返った成功は採用しない', async (t) => {
  const { app, fb, seen } = setup(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let releaseServer;
  fb.setDoc('users/uidA', {
    server: () => new Promise(res => { releaseServer = () => res({ exists: true, data: () => ({}) }); }),
    cache: HANG,
  });
  app.__household.setCurrentUser(USER_A);

  const p = app.App.bootWithHousehold();
  await Promise.resolve();
  t.mock.timers.tick(app.HOUSEHOLD_BOOT_TIMEOUT_MS);
  await p;
  assert.equal(app.__household.getState().bootPhase, 'error');

  // タイムアウト後にサーバ応答が遅れて到着しても、状態を上書きしない。
  const genBefore = app.__household.getRunGeneration();
  releaseServer();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(app.__household.getState().bootPhase, 'error', '遅延成功で ready に戻らない');
  assert.equal(app.__household.getState().householdStatus !== 'personal', true, '遅延成功で personal を採用しない');
  assert.equal(fb.calls.subscribed, 0, '遅延成功で購読を開始しない');
  assert.equal(app.__household.getRunGeneration(), genBefore, '新たな世代は増えていない');
});

test('再試行の連打で購読を多重登録しない', async (t) => {
  const { app, fb } = setup(t);
  fb.setDoc('users/uidA', { def: () => Promise.resolve({ exists: true, data: () => ({}) }) });
  app.__household.setCurrentUser(USER_A);

  await app.App.bootWithHousehold();
  const afterFirst = fb.calls.subscribed;
  assert.ok(afterFirst > 0);

  // 連打(2回続けて呼ぶ)。2回目は bootPhase==='loading' 中の呼び出しは弾かれる想定だが、
  // 直列に2回呼んでも購読数は1回分ずつしか増えない(古い購読は解除される)。
  await Promise.all([app.App.retryHousehold(), app.App.retryHousehold()]);

  assert.equal(fb.calls.subscribed - fb.calls.unsubscribed, afterFirst,
    '有効な購読数は1セット分のまま(多重登録なし)');
});

test('読み込み中にログアウト: Aの解決処理はBの状態・購読へ影響しない', async (t) => {
  const { app, fb, seen } = setup(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let releaseA;
  fb.setDoc('users/uidA', {
    server: () => new Promise(res => { releaseA = () => res({ exists: true, data: () => ({}) }); }),
    cache: HANG,
  });
  app.__household.setCurrentUser(USER_A);

  const pA = app.App.bootWithHousehold();
  await Promise.resolve();

  // onAuthStateChanged(null) 相当: 進行中の起動を無効化し、購読を解除する。
  app.invalidateHouseholdRun();
  app.detachFirestoreListeners();
  app.__household.setCurrentUser(null);
  app.setBootPhase('loading');

  // Aのサーバ応答が今になって返る。
  releaseA();
  t.mock.timers.tick(app.HOUSEHOLD_BOOT_TIMEOUT_MS);
  await pA;

  assert.equal(seen.start, 0, 'ログアウト後にAが通常画面を開かない');
  assert.equal(fb.calls.subscribed, 0, 'ログアウト後にAが購読を開始しない');
});

test('A→Bのアカウント変更: Aの遅延応答がBの解決結果を上書きしない', async (t) => {
  const { app, fb } = setup(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let releaseA;
  fb.setDoc('users/uidA', {
    server: () => new Promise(res => { releaseA = () => res({ exists: true, data: () => ({ linkedOwnerUid: 'ownerA', knownHouseholdUid: 'ownerA' }) }); }),
    cache: HANG,
  });
  fb.setDoc('users/uidB', { def: () => Promise.resolve({ exists: true, data: () => ({}) }) });
  app.__household.setCurrentUser(USER_A);

  const pA = app.App.bootWithHousehold();
  await Promise.resolve();

  // アカウントがBへ変わる。
  app.invalidateHouseholdRun();
  app.detachFirestoreListeners();
  app.__household.setCurrentUser(USER_B);
  await app.App.bootWithHousehold();
  assert.equal(app.__household.getState().householdStatus, 'personal');
  assert.equal(app.__household.getState().linkedOwnerUid, null);

  // 今になってAのサーバ応答(共有あり)が返っても、Bの状態を汚さない。
  releaseA();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(app.__household.getState().householdStatus, 'personal', 'BのままでAのsharedに戻らない');
  assert.equal(app.__household.getState().linkedOwnerUid, null, 'AのlinkedOwnerUidを持ち込まない');
});

test('自分のプロフィールをサーバー確認できずキャッシュのみ: 個人表示にせずエラーにする', async (t) => {
  const { app, fb, seen } = setup(t);
  fb.setDoc('users/uidA', {
    server: () => Promise.reject(Object.assign(new Error('offline'), { code: 'unavailable' })),
    cache: () => Promise.resolve({ exists: true, data: () => ({}) }), // 共有先なしのキャッシュ
  });
  app.__household.setCurrentUser(USER_A);

  await app.App.bootWithHousehold();

  assert.equal(app.__household.getState().householdStatus, 'unavailable');
  assert.equal(app.__household.getState().bootPhase, 'error');
  assert.equal(seen.start, 0);
  assert.equal(fb.calls.subscribed, 0);
});

test('共有先が権限拒否(revoked): 誤って個人データを開かずエラー導線を出す', async (t) => {
  const { app, fb, seen } = setup(t);
  fb.setDoc('users/uidA', { def: () => Promise.resolve({ exists: true, data: () => ({ linkedOwnerUid: 'owner1', knownHouseholdUid: 'owner1' }) }) });
  fb.setDoc('users/owner1', { server: () => Promise.reject(Object.assign(new Error('denied'), { code: 'permission-denied' })) });
  // clearRevokedHouseholdLink の update は失敗させ、revoked のままにする。
  fb.setDoc('users/uidA', {
    def: () => Promise.resolve({ exists: true, data: () => ({ linkedOwnerUid: 'owner1', knownHouseholdUid: 'owner1' }) }),
    update: () => Promise.reject(Object.assign(new Error('offline'), { code: 'unavailable' })),
  });

  app.__household.setCurrentUser(USER_A);
  await app.App.bootWithHousehold();

  assert.equal(app.__household.getState().householdStatus, 'revoked');
  assert.equal(app.__household.getState().bootPhase, 'error');
  assert.equal(seen.start, 0);
});

test('resolveLocalPageUrl: 禁止URLを拒否し、許可ページのクエリ/アンカーを保持する', (t) => {
  const { app } = setup(t);
  const ok = app.resolveLocalPageUrl;

  // 許可: 同梱ガイド・規約。クエリとアンカーは保持。
  assert.equal(ok('usage-guide.html'), 'usage-guide.html');
  assert.equal(ok('usage-guide.html?x=1#s3'), 'usage-guide.html?x=1#s3');
  assert.equal(ok('/terms.html#a'), 'terms.html#a');
  assert.equal(ok('https://app.example/privacy.html?v=2'), 'privacy.html?v=2');

  // 拒否: アプリ本体・空・任意外部URL・javascript:・別オリジン。
  assert.equal(ok('index.html'), null);
  assert.equal(ok(''), null);
  assert.equal(ok('/'), null);
  assert.equal(ok('https://evil.example/usage-guide.html'), null);
  assert.equal(ok('javascript:alert(1)'), null);
  assert.equal(ok('data:text/html,<h1>x'), null);
  assert.equal(ok('../../secret.html'), null);
});

test('resolveLocalPageUrl: アプリ版WebViewのスキーム(capacitor:// / https://localhost)でもガイドを開ける', (t) => {
  // iOS Capacitor: capacitor://localhost
  const ios = setup(t, { appHref: 'capacitor://localhost/index.html', appOrigin: 'capacitor://localhost', appProtocol: 'capacitor:', appHost: 'localhost' });
  assert.equal(ios.app.resolveLocalPageUrl('usage-guide.html'), 'usage-guide.html');
  assert.equal(ios.app.resolveLocalPageUrl('pdf-guide.html#s2'), 'pdf-guide.html#s2');
  assert.equal(ios.app.resolveLocalPageUrl('/terms.html'), 'terms.html');
  assert.equal(ios.app.resolveLocalPageUrl('index.html'), null);
  assert.equal(ios.app.resolveLocalPageUrl('javascript:alert(1)'), null);
  assert.equal(ios.app.resolveLocalPageUrl('data:text/html,x'), null);
  assert.equal(ios.app.resolveLocalPageUrl('https://evil.example/usage-guide.html'), null);
  assert.equal(ios.app.resolveLocalPageUrl('capacitor://other/usage-guide.html'), null);

  // Android Capacitor: https://localhost
  const android = setup(t, { appHref: 'https://localhost/index.html', appOrigin: 'https://localhost', appProtocol: 'https:', appHost: 'localhost' });
  assert.equal(android.app.resolveLocalPageUrl('usage-guide.html'), 'usage-guide.html');
  assert.equal(android.app.resolveLocalPageUrl('https://app.example/usage-guide.html'), null, '別ホストは拒否');
});

// ---- レビュー指摘の追加修正の回帰テスト ----

const flush = async () => { for(let i=0;i<4;i++) await Promise.resolve(); };

test('registerFamilyMembership: get待機中のA→B切替で set を発行せず、Bの情報も使わない', async (t) => {
  const { app, fb } = setup(t);
  let releaseGet;
  fb.setDoc('users/owner1/familyMembers/uidA', {
    server: () => new Promise(res => { releaseGet = () => res({ exists: false }); }),
  });
  app.__household.setCurrentUser(USER_A);
  const run = app.beginHouseholdRun();

  const p = app.App.registerFamilyMembership('owner1', run);
  await flush();

  // A→B(onAuthStateChanged相当)
  app.invalidateHouseholdRun();
  app.__household.setCurrentUser(USER_B);

  releaseGet();
  await p;

  assert.equal(fb.calls.writes.some(w => w[0] === 'set'), false, 'set を発行していない');
  assert.equal(fb.calls.writes.some(w => w[0] === 'set' && JSON.stringify(w[2] || {}).includes('b@example.com')), false,
    'Bのメールで書いていない');
});

test('clearRevokedHouseholdLink: update完了が遅れても、新世代の状態を書き換えない', async (t) => {
  const { app, fb } = setup(t);
  let releaseUpdate;
  fb.setDoc('users/uidA', {
    def: () => Promise.resolve({ exists: true, data: () => ({}) }),
    update: () => new Promise(res => { releaseUpdate = res; }),
  });
  app.__household.setCurrentUser(USER_A);
  const run = app.beginHouseholdRun();
  const state = app.__household.getState();
  state.householdStatus = 'revoked';

  const p = app.clearRevokedHouseholdLink(run);
  await flush();

  // 新しい世代(再試行)が走って personal に解決したとする
  app.invalidateHouseholdRun();
  state.householdStatus = 'personal';
  state.householdError = null;

  releaseUpdate();
  const result = await p;

  assert.equal(result, false, '取り消せたとは扱わない');
  assert.equal(state.householdStatus, 'personal', '新世代の状態を上書きしない');
});

test('アプリ内招待: Callable無応答は15秒で invite-unconfirmed、readyにならず購読ゼロ', async (t) => {
  const { app, fb, seen } = setup(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fb.setDoc('users/uidA', { def: () => Promise.resolve({ exists: true, data: () => ({}) }) });
  fb.setCallable('acceptFamilyInviteCode', () => new Promise(() => {})); // 無応答
  app.__household.setCurrentUser(USER_A);

  app.__household.setPendingInAppInviteCode('ABCD1234ABCD1234');
  const p = app.App.bootWithHousehold();
  await flush();
  // 招待Callable専用上限(<全体上限)が先に発火する。
  t.mock.timers.tick(12000);
  await flush();
  const result = await p;

  assert.equal(result.status, 'invite-unconfirmed');
  assert.equal(app.__household.getState().bootPhase, 'invite-unconfirmed', 'readyにならない');
  assert.equal(app.__household.getState().householdStatus, 'invite-unconfirmed');
  assert.equal(fb.calls.subscribed, 0, '旧購読は解除されたまま(購読開始ゼロ)');
  assert.equal(seen.start, 0, '通常画面へ進まない');
  // 再読み込みをまたぐ未確認保持
  assert.ok(app.readPendingInvite('uidA'), 'pendingInvite が localStorage に保存されている');
});

test('アプリ内招待: 確定した業務エラー(not-found)は invite-business-error で ready に戻す', async (t) => {
  const { app, fb } = setup(t);
  fb.setDoc('users/uidA', { def: () => Promise.resolve({ exists: true, data: () => ({}) }) });
  fb.setCallable('acceptFamilyInviteCode', () => Promise.reject(Object.assign(new Error('not found'), { code: 'functions/not-found' })));
  app.__household.setCurrentUser(USER_A);

  app.__household.setPendingInAppInviteCode('ZZZZ0000ZZZZ0000');
  const result = await app.App.bootWithHousehold();

  assert.equal(result.status, 'invite-business-error');
  assert.ok(result.message, 'モーダル表示用メッセージがある');
  assert.equal(app.__household.getState().bootPhase, 'ready', '通常画面へ戻す');
  assert.equal(app.__household.getState().householdStatus, 'personal');
  assert.ok(fb.calls.subscribed > 0, '自分のデータへ購読を張り直す');
  assert.equal(app.readPendingInvite('uidA'), null, '業務エラーは未確認を残さない');
});

test('アプリ内招待: 不明なエラー(unavailable)は業務エラー扱いせず invite-unconfirmed', async (t) => {
  const { app, fb } = setup(t);
  fb.setDoc('users/uidA', { def: () => Promise.resolve({ exists: true, data: () => ({}) }) });
  fb.setCallable('acceptFamilyInviteCode', () => Promise.reject(Object.assign(new Error('backend down'), { code: 'functions/unavailable' })));
  app.__household.setCurrentUser(USER_A);

  app.__household.setPendingInAppInviteCode('AAAA1111AAAA1111');
  const result = await app.App.bootWithHousehold();

  assert.equal(result.status, 'invite-unconfirmed', '未知エラーを安全な業務エラーとして扱わない');
  assert.equal(fb.calls.subscribed, 0);
  assert.ok(app.readPendingInvite('uidA'));
});

test('URL招待コードは応答不明後の再試行で自動再送しない(Callableは一度きり)', async (t) => {
  const { app, fb } = setup(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  global.location.search = '?familyInvite=XYZ';
  fb.setDoc('users/uidA', { def: () => Promise.resolve({ exists: true, data: () => ({}) }) });
  let calls = 0;
  fb.setCallable('acceptFamilyInviteCode', () => { calls++; return new Promise(() => {}); }); // 無応答
  app.__household.setCurrentUser(USER_A);

  const p = app.App.bootWithHousehold();
  await flush();
  t.mock.timers.tick(12000);
  await flush();
  await p;
  assert.equal(app.__household.getState().bootPhase, 'invite-unconfirmed');
  assert.equal(calls, 1);

  // 未確認画面から「状態を再確認」
  await app.App.retryHousehold();
  assert.equal(calls, 1, '再試行で acceptFamilyInviteCode を再送していない');
  assert.equal(app.__household.getState().bootPhase, 'invite-unconfirmed', '未確認のまま');

  // 再読み込み相当(module state を作り直し、localStorage は引き継ぐ)でも再送しない
  const reload = setup(t, { search: '?familyInvite=XYZ', localStorage: app.storage || global.localStorage });
  reload.fb.setDoc('users/uidA', { def: () => Promise.resolve({ exists: true, data: () => ({}) }) });
  let calls2 = 0;
  reload.fb.setCallable('acceptFamilyInviteCode', () => { calls2++; return Promise.resolve({ data: { ownerUid: 'x' } }); });
  reload.app.__household.setCurrentUser(USER_A);
  await reload.app.App.bootWithHousehold();
  assert.equal(calls2, 0, '再読み込みでも暗黙の再送を起こさない');
  assert.equal(reload.app.__household.getState().bootPhase, 'invite-unconfirmed');
});

test('古い共有キャッシュ + サーバー通信失敗: error になり購読開始ゼロ', async (t) => {
  const { app, fb, seen } = setup(t);
  fb.setDoc('users/uidA', {
    server: () => Promise.reject(Object.assign(new Error('offline'), { code: 'unavailable' })),
    cache: () => Promise.resolve({ exists: true, data: () => ({ linkedOwnerUid: 'ownerC', knownHouseholdUid: 'ownerC' }) }),
  });
  fb.setDoc('users/ownerC', { server: () => Promise.reject(Object.assign(new Error('offline'), { code: 'unavailable' })) });
  app.__household.setCurrentUser(USER_A);

  await app.App.bootWithHousehold();

  assert.equal(app.__household.getState().bootPhase, 'error');
  assert.equal(app.__household.getState().householdStatus, 'unavailable');
  assert.equal(fb.calls.subscribed, 0, 'キャッシュの共有先だけで購読を開始しない');
  assert.equal(seen.start, 0);
});

test('解除済み(detach後)の旧購読が遅延成功通知を出しても state を上書きしない', async (t) => {
  const { app, fb } = setup(t);
  fb.setDoc('users/uidA', { def: () => Promise.resolve({ exists: true, data: () => ({}) }) });
  app.__household.setCurrentUser(USER_A);
  await app.App.bootWithHousehold();

  const petsHandler = fb.calls.snapshotHandlers.find(h => h.path.endsWith('/pets'));
  assert.ok(petsHandler);

  // ログアウト相当: 購読解除(世代が進む)
  app.detachFirestoreListeners();

  // 旧購読の遅延スナップショットが今になって届く
  petsHandler.cb({ docs: [{ id: 'p1', data: () => ({ name: 'ghost' }) }] });

  assert.deepEqual(app.__household.getState().pets, [], '旧購読の遅延通知で pets を上書きしない');
});

test('loading/error 中は 記録削除・購入・レポート消費が入口で拒否される(書き込みゼロ)', async (t) => {
  const { app, fb } = setup(t);
  app.__household.setCurrentUser(USER_A);
  const state = app.__household.getState();

  for(const phase of ['loading', 'error']){
    state.bootPhase = phase;
    app.App.deleteEvent('e1');
    app.App.deleteRecord('r1');
    await app.App.purchase('supportPlan');
    const credit = await app.App.consumeReportCreditOrPrompt();
    await app.App.leaveHousehold();
    assert.equal(credit, false, `${phase}: レポートクレジットを消費しない`);
  }
  assert.equal(fb.calls.writes.length, 0, '書き込みゼロ');
  assert.equal(fb.calls.callables.length, 0, 'Callable呼び出しゼロ(課金・クレジット含む)');
});

test('DOM擬似: 読み込み中表示→15秒でエラー表示、再試行ボタンが操作可能になる', async (t) => {
  const { app, fb, doc } = setup(t, { richDom: true });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fb.setDoc('users/uidA', { server: () => new Promise(() => {}), cache: () => new Promise(() => {}) });
  app.__household.setCurrentUser(USER_A);

  const p = app.App.bootWithHousehold();
  await Promise.resolve();

  // 読み込み中
  assert.equal(doc._els.get('bootOverlay').classList.contains('hidden'), false, 'オーバーレイ表示');
  assert.equal(doc._els.get('bootLoading').classList.contains('hidden'), false, '読み込み中を表示');
  assert.equal(doc._els.get('bootError').classList.contains('hidden'), true, 'エラーは非表示');
  assert.equal(doc._els.get('bootRetryButton').disabled, true, '読み込み中は再試行ボタン無効');

  t.mock.timers.tick(app.HOUSEHOLD_BOOT_TIMEOUT_MS);
  await p;

  // エラー表示
  assert.equal(doc._els.get('bootOverlay').classList.contains('hidden'), false);
  assert.equal(doc._els.get('bootLoading').classList.contains('hidden'), true, '読み込み中は消える');
  assert.equal(doc._els.get('bootError').classList.contains('hidden'), false, 'エラーを表示');
  assert.equal(doc._els.get('bootRetryButton').disabled, false, '再試行ボタンが押せる');
  assert.ok(doc._els.get('bootErrorDetail').textContent.length > 0, '説明文がある');

  // 「再試行」は loading ガードで弾かれず実行できる(bootPhase は 'error')
  assert.equal(app.__household.getState().bootPhase, 'error');
  fb.setDoc('users/uidA', { def: () => Promise.resolve({ exists: true, data: () => ({}) }) });
  await app.App.retryHousehold();
  assert.equal(app.__household.getState().bootPhase, 'ready', '再試行で復帰できる');
});

test('DOM擬似: ログアウトで起動オーバーレイを隠し、認証画面へ戻す下準備', (t) => {
  const { app, doc } = setup(t, { richDom: true });
  const state = app.__household.getState();
  // 起動エラー表示中からのログアウト相当
  app.setBootPhase('error', 'x');
  assert.equal(doc._els.get('bootOverlay').classList.contains('hidden'), false);
  // onAuthStateChanged(null) の該当処理を再現
  state.bootPhase = 'loading';
  doc._els.get('bootOverlay').classList.add('hidden');
  assert.equal(doc._els.get('bootOverlay').classList.contains('hidden'), true);
});

// ---- レビュー指摘3(招待の結果未確認)の回帰テスト ----

test('コード招待: 未確認中の「状態を再確認」で、個人状態が返っても未確認案内を消さない', async (t) => {
  const { app, fb } = setup(t);
  fb.setDoc('users/uidA', { def: () => Promise.resolve({ exists: true, data: () => ({}) }) }); // 個人状態
  fb.setCallable('acceptFamilyInviteCode', () => Promise.reject(Object.assign(new Error('down'), { code: 'functions/internal' })));
  app.__household.setCurrentUser(USER_A);

  app.__household.setPendingInAppInviteCode('CODE0000CODE0000');
  await app.App.bootWithHousehold();
  assert.equal(app.__household.getState().householdStatus, 'invite-unconfirmed');

  // 状態を再確認: サーバーは個人状態を返すが、未確認は維持する
  await app.App.retryHousehold();
  assert.equal(app.__household.getState().householdStatus, 'invite-unconfirmed', '個人状態でも未確認を維持');
  assert.equal(app.__household.getState().bootPhase, 'invite-unconfirmed');
  assert.equal(fb.calls.subscribed, 0, '通常購読は開始しない');
});

test('コード招待: 未確認中に別の共有先が見つかっても「今回の招待成功」と断定しない', async (t) => {
  const { app, fb } = setup(t);
  // 照合時、別の共有先(ownerZ)にリンク済みと分かる
  fb.setDoc('users/uidA', { def: () => Promise.resolve({ exists: true, data: () => ({ linkedOwnerUid: 'ownerZ', knownHouseholdUid: 'ownerZ' }) }) });
  fb.setDoc('users/ownerZ', { def: () => Promise.resolve({ exists: true, data: () => ({}) }) });
  fb.setCallable('acceptFamilyInviteCode', () => Promise.reject(Object.assign(new Error('down'), { code: 'functions/internal' })));
  app.__household.setCurrentUser(USER_A);

  app.__household.setPendingInAppInviteCode('CODE1111CODE1111');
  await app.App.bootWithHousehold();
  assert.equal(app.__household.getState().householdStatus, 'invite-unconfirmed');

  await app.App.retryHousehold();
  assert.equal(app.__household.getState().householdStatus, 'invite-unconfirmed', '別共有先があっても未確認のまま');
});

test('メール招待(?invite=uid): 応答不明 → 未確認、再確認で linkedOwnerUid 一致なら shared に確定', async (t) => {
  const { app, fb } = setup(t, { search: '?invite=ownerM' });
  let writeLanded = false;
  fb.setDoc('users/uidA', {
    def: () => Promise.resolve({ exists: true, data: () => (writeLanded ? { linkedOwnerUid: 'ownerM', knownHouseholdUid: 'ownerM' } : {}) }),
    update: () => { writeLanded = true; return new Promise(() => {}); }, // 書き込みは実際は成立するが応答は返らない
  });
  fb.setDoc('users/ownerM', { def: () => Promise.resolve({ exists: true, data: () => ({}) }) });
  app.__household.setCurrentUser(USER_A);
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const p = app.App.bootWithHousehold();
  await flush();
  t.mock.timers.tick(9000);   // confirmedHouseholdWrite の 8s 上限
  await flush();
  await p;
  assert.equal(app.__household.getState().householdStatus, 'invite-unconfirmed');
  assert.ok(app.readPendingInvite('uidA'));

  // 状態を再確認: 書き込みは実際に成立していた → owner doc 読めて linkedOwnerUid 一致 → 確定
  t.mock.timers.reset();
  await app.App.retryHousehold();
  assert.equal(app.__household.getState().householdStatus, 'shared', '照合で確定できる');
  assert.equal(app.readPendingInvite('uidA'), null, '確定したら未確認を消す');
});

test('未確認画面の再送は明示操作のみ(confirmでキャンセルすると Callable を呼ばない)', async (t) => {
  const { app, fb } = setup(t);
  fb.setDoc('users/uidA', { def: () => Promise.resolve({ exists: true, data: () => ({}) }) });
  let calls = 0;
  fb.setCallable('acceptFamilyInviteCode', () => { calls++; return Promise.reject(Object.assign(new Error('down'), { code: 'functions/internal' })); });
  app.__household.setCurrentUser(USER_A);
  app.__household.setPendingInAppInviteCode('CODE2222CODE2222');
  await app.App.bootWithHousehold();
  assert.equal(calls, 1);

  global.confirm = () => false;  // 利用者が再送をキャンセル
  await app.App.resendUnconfirmedInvite();
  assert.equal(calls, 1, 'キャンセルなら再送しない');

  global.confirm = () => true;   // 明示的に実行
  await app.App.resendUnconfirmedInvite();
  assert.equal(calls, 2, '明示操作でのみ再送する');
});

test('実 acceptFamilyInviteCode(DOMスタブ): 業務エラーはモーダルに表示、readyのまま', async (t) => {
  const { app, fb, doc } = setup(t, { richDom: true });
  fb.setDoc('users/uidA', { def: () => Promise.resolve({ exists: true, data: () => ({}) }) });
  app.__household.setCurrentUser(USER_A);
  await app.App.bootWithHousehold();  // ready

  fb.setCallable('acceptFamilyInviteCode', () => Promise.reject(Object.assign(new Error('used'), { code: 'functions/failed-precondition', message: 'この招待コードは使用済みです。' })));
  doc._els.get('familyJoinCode').value = 'USED0000USED0000';

  await app.App.acceptFamilyInviteCode();

  assert.equal(app.__household.getState().bootPhase, 'ready', 'アプリは通常画面のまま');
  assert.ok(doc._els.get('familyJoinError').textContent.length > 0, 'モーダルにエラー表示');
  assert.equal(doc._els.get('familyJoinButton').disabled, false, 'ボタンは戻る');
  assert.equal(app.readPendingInvite('uidA'), null, '未確認を残さない');
});

test('実 acceptFamilyInviteCode(DOMスタブ): 応答不明は invite-unconfirmed 画面、ボタン復帰は世代確認つき', async (t) => {
  const { app, fb, doc } = setup(t, { richDom: true });
  fb.setDoc('users/uidA', { def: () => Promise.resolve({ exists: true, data: () => ({}) }) });
  app.__household.setCurrentUser(USER_A);
  await app.App.bootWithHousehold();

  fb.setCallable('acceptFamilyInviteCode', () => Promise.reject(Object.assign(new Error('x'), { code: 'functions/internal' })));
  doc._els.get('familyJoinCode').value = 'AAAA9999AAAA9999';

  await app.App.acceptFamilyInviteCode();

  assert.equal(app.__household.getState().bootPhase, 'invite-unconfirmed');
  assert.equal(doc._els.get('bootError').classList.contains('hidden'), false);
  assert.equal(doc._els.get('bootRetryButton').textContent, '状態を再確認');
  assert.equal(doc._els.get('bootInviteResendButton').classList.contains('hidden'), false, '再送ボタンを表示(コード保持)');
});

test('実 acceptFamilyInviteCode(DOMスタブ): 送信後にA→B切替すると旧処理はB画面のUIを触らない', async (t) => {
  const { app, fb, doc } = setup(t, { richDom: true });
  fb.setDoc('users/uidA', { def: () => Promise.resolve({ exists: true, data: () => ({}) }) });
  fb.setDoc('users/uidB', { def: () => Promise.resolve({ exists: true, data: () => ({}) }) });
  app.__household.setCurrentUser(USER_A);
  await app.App.bootWithHousehold();

  let releaseCall;
  fb.setCallable('acceptFamilyInviteCode', () => new Promise((_res, rej) => { releaseCall = () => rej(Object.assign(new Error('x'), { code: 'functions/internal' })); }));
  doc._els.get('familyJoinCode').value = 'BBBB0000BBBB0000';
  const joinP = app.App.acceptFamilyInviteCode();
  await flush();

  // A→B(onAuthStateChanged相当)
  app.invalidateHouseholdRun();
  app.detachFirestoreListeners();
  app.__household.setCurrentUser(USER_B);
  await app.App.bootWithHousehold();
  const bButtonLabel = doc._els.get('familyJoinButton').textContent;
  doc._els.get('familyJoinError').textContent = '';

  releaseCall();
  await joinP;

  assert.equal(doc._els.get('familyJoinError').textContent, '', '旧処理がBのモーダルにエラーを書かない');
  assert.equal(doc._els.get('familyJoinButton').textContent, bButtonLabel, '旧処理がBのボタン表示を触らない');
  assert.equal(app.__household.getState().householdStatus, 'personal', 'Bの解決結果が維持される');
});

// ---- レビュー指摘4(未確認状態の永続化タイミング / deadline-exceeded)の回帰テスト ----

test('プロフィール取得5秒＋招待無応答: 全体15秒超過後も未確認状態(localStorage)が残る', async (t) => {
  const { app, fb } = setup(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let releaseProfile;
  fb.setDoc('users/uidA', {
    server: () => new Promise(res => { releaseProfile = () => res({ exists: true, data: () => ({}) }); }),
  });
  fb.setCallable('acceptFamilyInviteCode', () => new Promise(() => {})); // 無応答
  app.__household.setCurrentUser(USER_A);
  app.__household.setPendingInAppInviteCode('CODE5S00CODE5S00');

  const p = app.App.bootWithHousehold();
  await flush();
  t.mock.timers.tick(5000);      // プロフィール取得に5秒
  releaseProfile();
  await flush();
  // ここで招待Callableへ入り、未確認状態を送信前に保存しているはず
  assert.ok(app.readPendingInvite('uidA'), '送信前に未確認状態を永続保存している');
  t.mock.timers.tick(10000);     // 合計15秒 → 全体上限
  await flush();
  const result = await p;

  assert.equal(result.status, 'invite-unconfirmed', '全体上限でも未確認画面');
  assert.ok(app.readPendingInvite('uidA'), '未確認状態は失われない');
  assert.notEqual(app.__household.getState().bootPhase, 'ready');
});

test('招待送信直後の再読み込み相当: Callable も書き込みも再送しない', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const shared = makeLocalStorage();
  // 1回目: 送信して無応答のまま「再読み込み」される
  const s1 = setup(t, { localStorage: shared });
  s1.fb.setDoc('users/uidA', { def: () => Promise.resolve({ exists: true, data: () => ({}) }) });
  let calls = 0;
  s1.fb.setCallable('acceptFamilyInviteCode', () => { calls++; return new Promise(() => {}); });
  s1.app.__household.setCurrentUser(USER_A);
  s1.app.__household.setPendingInAppInviteCode('CODErelo01relo01');
  const abandoned = s1.app.App.bootWithHousehold();     // await しない = 送信中に離脱
  await flush();
  assert.equal(calls, 1);
  assert.ok(shared.getItem('mmk:pendingInvite:uidA'), '送信前に保存済み');
  s1.app.invalidateHouseholdRun();   // 離脱でこの起動は無効化される
  t.mock.timers.tick(15000);         // 放置された起動の内部タイマーを解放
  await abandoned.catch(() => {});

  // 2回目(別モジュール = 再読み込み)。同じ localStorage を引き継ぐ。
  const s2 = setup(t, { localStorage: shared, search: '?familyInvite=CODErelo01relo01' });
  s2.fb.setDoc('users/uidA', { def: () => Promise.resolve({ exists: true, data: () => ({}) }) });
  let calls2 = 0;
  s2.fb.setCallable('acceptFamilyInviteCode', () => { calls2++; return Promise.resolve({ data: { ownerUid: 'x' } }); });
  s2.app.__household.setCurrentUser(USER_A);
  await s2.app.App.bootWithHousehold();

  assert.equal(calls2, 0, '再読み込みで Callable を再送しない');
  assert.equal(s2.app.__household.getState().householdStatus, 'invite-unconfirmed');
});

test('localStorage 保存失敗時は招待を送信しない', async (t) => {
  const { app, fb } = setup(t, { failStorageWrites: true });
  fb.setDoc('users/uidA', { def: () => Promise.resolve({ exists: true, data: () => ({}) }) });
  let calls = 0;
  fb.setCallable('acceptFamilyInviteCode', () => { calls++; return Promise.resolve({ data: { ownerUid: 'x' } }); });
  app.__household.setCurrentUser(USER_A);
  app.__household.setPendingInAppInviteCode('CODEnostoreCODEnos');

  const result = await app.App.bootWithHousehold();

  assert.equal(calls, 0, '保存できないなら Callable を発行しない');
  assert.equal(result.status, 'error');
  assert.equal(app.__household.getState().householdStatus, 'unavailable');
  assert.ok(app.__household.getState().householdError.length > 0, '説明を表示');
});

test('明示再送: 中断(A→B)されても未確認状態は残り、Bの状態は汚さない', async (t) => {
  const shared = makeLocalStorage();
  const { app, fb } = setup(t, { localStorage: shared });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fb.setDoc('users/uidA', { def: () => Promise.resolve({ exists: true, data: () => ({}) }) });
  fb.setDoc('users/uidB', { def: () => Promise.resolve({ exists: true, data: () => ({}) }) });
  fb.setCallable('acceptFamilyInviteCode', () => Promise.reject(Object.assign(new Error('x'), { code: 'functions/internal' })));
  app.__household.setCurrentUser(USER_A);
  app.__household.setPendingInAppInviteCode('CODEresend01resend');
  await app.App.bootWithHousehold();
  assert.equal(app.__household.getState().householdStatus, 'invite-unconfirmed');
  assert.ok(shared.getItem('mmk:pendingInvite:uidA'));

  // 明示再送。今度は Callable を無応答にして途中でA→B。
  fb.setCallable('acceptFamilyInviteCode', () => new Promise(() => {}));
  const rp = app.App.resendUnconfirmedInvite();
  await flush();
  assert.ok(shared.getItem('mmk:pendingInvite:uidA'), '再送準備で保存済み(空白なし)');

  app.invalidateHouseholdRun();
  app.detachFirestoreListeners();
  app.__household.setCurrentUser(USER_B);
  await app.App.bootWithHousehold();
  // 旧世代の resend は Callable 無応答のまま。専用上限を進めて解放する。
  t.mock.timers.tick(12000);
  await flush();
  await rp;

  assert.ok(shared.getItem('mmk:pendingInvite:uidA'), 'Aの未確認状態は残る');
  assert.equal(shared.getItem('mmk:pendingInvite:uidB'), null, 'Bには未確認状態を作らない');
  assert.equal(app.__household.getState().householdStatus, 'personal', 'Bの解決結果が維持される');
});

test('12秒以内に deadline-exceeded が返っても ready にならない(未確認)', async (t) => {
  const { app, fb } = setup(t);
  fb.setDoc('users/uidA', { def: () => Promise.resolve({ exists: true, data: () => ({}) }) });
  fb.setCallable('acceptFamilyInviteCode', () => Promise.reject(Object.assign(new Error('deadline'), { code: 'functions/deadline-exceeded' })));
  app.__household.setCurrentUser(USER_A);
  app.__household.setPendingInAppInviteCode('CODEdead0000dead00');

  const result = await app.App.bootWithHousehold();

  assert.equal(result.status, 'invite-unconfirmed', 'deadline-exceeded は確定業務エラーにしない');
  assert.equal(app.isDefiniteInviteBusinessError({ code: 'functions/deadline-exceeded' }), false);
  assert.equal(app.isDefiniteInviteBusinessError({ code: 'deadline-exceeded' }), false);
  assert.ok(app.readPendingInvite('uidA'));
  assert.equal(fb.calls.subscribed, 0);
});

test('遅延した旧応答(旧世代)が、新世代の保存した未確認状態を消さない', async (t) => {
  const shared = makeLocalStorage();
  const { app, fb } = setup(t, { localStorage: shared });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fb.setDoc('users/uidA', { def: () => Promise.resolve({ exists: true, data: () => ({}) }) });
  let resolveOld;
  fb.setCallable('acceptFamilyInviteCode', () => new Promise(res => { resolveOld = () => res({ data: { ownerUid: 'ownerOLD' } }); }));
  app.__household.setCurrentUser(USER_A);
  app.__household.setPendingInAppInviteCode('CODEold00000old000');

  const oldRun = app.App.bootWithHousehold();   // 旧世代の起動(招待送信中)
  await flush();
  assert.ok(shared.getItem('mmk:pendingInvite:uidA'), '送信前に保存済み');

  // 旧起動が全体上限に達し、未確認画面へ(世代も進む)。ここで旧 resolveHousehold は stale になる。
  t.mock.timers.tick(15000);
  await flush();
  await oldRun;
  assert.equal(app.__household.getState().householdStatus, 'invite-unconfirmed');
  const savedBefore = shared.getItem('mmk:pendingInvite:uidA');

  // ここで旧世代の Callable がやっと成功して返る(旧世代なので採用されない)
  resolveOld();
  await flush();

  assert.equal(shared.getItem('mmk:pendingInvite:uidA'), savedBefore, '旧応答で保存状態を消さない');
  assert.equal(app.__household.getState().householdStatus, 'invite-unconfirmed', '旧応答で画面を変えない');
});

test('本人の受諾結果を照会して通常解決へ進む: 再送・共有復活なし', async t => {
  const { app, fb } = setup(t);
  app.__household.setCurrentUser(USER_A);
  app.writePendingInvite(USER_A.uid, {kind:'code',code:'23456789ABCDEFGH'});
  fb.setCallable('getFamilyInviteResult', () => Promise.resolve({data:{status:'accepted-inactive',ownerUid:'old-owner'}}));
  await app.App.bootWithHousehold();
  assert.equal(app.isAppReady(), true);
  assert.equal(app.__household.getState().linkedOwnerUid, null);
  assert.equal(app.readPendingInvite(USER_A.uid), null);
  assert.equal(fb.calls.callables.filter(x=>x[0]==='acceptFamilyInviteCode').length,0);
  assert.equal(fb.calls.writes.length,0);
});
test('照会の遅延結果はタイムアウト後の未確認状態を消さない', async t => {
  const { app, fb } = setup(t);
  t.mock.timers.enable({apis:['setTimeout']});
  app.__household.setCurrentUser(USER_A);
  app.writePendingInvite(USER_A.uid,{kind:'code',code:'23456789ABCDEFGH'});
  let finish;
  fb.setCallable('getFamilyInviteResult',()=>new Promise(r=>{finish=r;}));
  const p=app.App.bootWithHousehold();
  for(let i=0;i<10;i++) await Promise.resolve();
  t.mock.timers.tick(15000); await p;
  finish({data:{status:'accepted-active',ownerUid:'owner'}});
  for(let i=0;i<10;i++) await Promise.resolve();
  assert.ok(app.readPendingInvite(USER_A.uid));
  assert.equal(app.isAppReady(),false);
});
test('専用期限切れ識別情報がある場合だけ期限切れを確定する',t=>{
  const {app}=setup(t);
  assert.equal(app.isDefiniteInviteBusinessError({code:'functions/deadline-exceeded'}),false);
  assert.equal(app.isDefiniteInviteBusinessError({code:'functions/deadline-exceeded',details:{reason:'INVITE_EXPIRED'}}),true);
});
test('受諾済み有効な共有の照会後も通常のサーバー共有確認を経由する',async t=>{
 const {app,fb}=setup(t);
 app.__household.setCurrentUser(USER_A);
 app.writePendingInvite(USER_A.uid,{kind:'code',code:'23456789ABCDEFGH'});
 fb.setDoc('users/uidA',{def:()=>Promise.resolve({exists:true,data:()=>({linkedOwnerUid:'owner'})})});
 fb.setCallable('getFamilyInviteResult',()=>Promise.resolve({data:{status:'accepted-active',ownerUid:'owner'}}));
 await app.App.bootWithHousehold();
 assert.equal(app.isAppReady(),true);
 assert.equal(app.__household.getState().householdStatus,'shared');
 assert.equal(app.readPendingInvite(USER_A.uid),null);
 assert.equal(fb.calls.callables.some(x=>x[0]==='acceptFamilyInviteCode'),false);
});

const flushInitial = async () => { for(let i=0;i<12;i++) await Promise.resolve(); };
const initialSnap = (handler, fromCache=false) => ({
  metadata:{fromCache},
  docs: handler.path.endsWith('/pets') ? [{id:'existing-pet',data:()=>({name:'登録済み'})}] : [],
  data:()=>({}),
});
test('全8購読のサーバー初回受信までloadingを維持しキャッシュだけでは開かない', async t => {
  const {app,fb,seen}=setup(t,{autoSnapshots:false});
  app.__household.setCurrentUser(USER_A);
  const p=app.App.bootWithHousehold(); await flushInitial();
  assert.equal(fb.calls.snapshotHandlers.length,8);
  for(const h of fb.calls.snapshotHandlers) h.cb(initialSnap(h,true));
  await flushInitial();
  assert.equal(app.__household.getState().bootPhase,'loading'); assert.equal(seen.start,0);
  const handlers=fb.calls.snapshotHandlers;
  for(const h of handlers.slice(0,-1)) h.cb(initialSnap(h));
  await flushInitial(); assert.equal(seen.start,0);
  handlers.at(-1).cb(initialSnap(handlers.at(-1)));
  await p;
  assert.equal(app.__household.getState().bootPhase,'ready');
  assert.equal(app.__household.getState().pets[0].id,'existing-pet');assert.equal(seen.start,1);
});
test('初回購読無応答も15秒で解除し、遅延応答を無視して再試行できる',async t=>{
  const {app,fb,seen}=setup(t,{autoSnapshots:false});
  t.mock.timers.enable({apis:['setTimeout']});app.__household.setCurrentUser(USER_A);
  const p=app.App.bootWithHousehold();await flushInitial();
  const old=[...fb.calls.snapshotHandlers];
  t.mock.timers.tick(app.HOUSEHOLD_BOOT_TIMEOUT_MS);await p;
  assert.equal(app.__household.getState().bootPhase,'error');assert.equal(seen.start,0);
  assert.ok(old.every(h=>!h.live));
  for(const h of old)h.cb(initialSnap(h));
  assert.equal(app.__household.getState().pets.length,0);
  const retry=app.App.retryHousehold();await flushInitial();
  for(const h of fb.calls.snapshotHandlers.filter(h=>h.live))h.cb(initialSnap(h));
  await retry;assert.equal(app.__household.getState().bootPhase,'ready');assert.equal(seen.start,1);
});
test('初回購読エラーは通常画面を開かず全購読を解除する',async t=>{
  const {app,fb,seen}=setup(t,{autoSnapshots:false});app.__household.setCurrentUser(USER_A);
  const p=app.App.bootWithHousehold();await flushInitial();
  fb.calls.snapshotHandlers[0].errcb({code:'permission-denied'});await p;
  assert.equal(app.__household.getState().bootPhase,'error');assert.equal(seen.start,0);
  assert.ok(fb.calls.snapshotHandlers.every(h=>!h.live));
});
test('初回受信待ちのAからBへ切替後、Aの応答はBのデータを上書きしない',async t=>{
  const {app,fb,seen}=setup(t,{autoSnapshots:false});app.__household.setCurrentUser(USER_A);
  const a=app.App.bootWithHousehold();await flushInitial();const old=[...fb.calls.snapshotHandlers];
  app.__household.setCurrentUser(USER_B);const b=app.App.bootWithHousehold();await flushInitial();
  for(const h of old)h.cb(initialSnap(h));
  assert.equal(app.__household.getState().pets.length,0);assert.equal(seen.start,0);
  for(const h of fb.calls.snapshotHandlers.filter(h=>h.live))h.cb(initialSnap(h));
  assert.equal((await a).status,'aborted');await b;assert.equal(seen.start,1);
});
test('サーバー確認済みの空データは正常な未登録状態として開く',async t=>{
  const {app,fb,seen}=setup(t,{autoSnapshots:false});app.__household.setCurrentUser(USER_A);
  const p=app.App.bootWithHousehold();await flushInitial();
  for(const h of fb.calls.snapshotHandlers)h.cb({docs:[],data:()=>({}),metadata:{fromCache:false}});
  await p;assert.equal(app.__household.getState().pets.length,0);
  assert.equal(app.__household.getState().bootPhase,'ready');assert.equal(seen.start,1);
});

test('共有復帰の読取り待ち中にA→Bへ変わったら書き込まない', async t => {
  const {app,fb}=setup(t);
  app.__household.setCurrentUser(USER_A);
  Object.assign(app.__household.getState(),{bootPhase:'ready',householdStatus:'left',knownHouseholdUid:'owner1'});
  let finish;
  fb.setDoc('users/owner1',{server:()=>new Promise(r=>{finish=r;})});
  const work=app.App.rejoinHousehold();
  app.invalidateHouseholdRun();
  app.__household.setCurrentUser(USER_B);
  Object.assign(app.__household.getState(),{bootPhase:'ready',householdStatus:'personal',knownHouseholdUid:'owner2'});
  finish({exists:true,data:()=>({})});
  await work;
  assert.deepEqual(fb.calls.writes,[]);
  assert.equal(app.__household.getState().householdStatus,'personal');
  assert.equal(fb.calls.subscribed,0);
});

test('共有離脱の書込み待ち中にA→Bへ変わってもBを再起動しない', async t => {
  const {app,fb}=setup(t);
  app.__household.setCurrentUser(USER_A);
  Object.assign(app.__household.getState(),{bootPhase:'ready',householdStatus:'shared',linkedOwnerUid:'owner1'});
  let finish;
  fb.setDoc('users/uidA',{update:()=>new Promise(r=>{finish=r;})});
  const work=app.App.leaveHousehold();
  app.invalidateHouseholdRun();app.__household.setCurrentUser(USER_B);
  Object.assign(app.__household.getState(),{bootPhase:'ready',householdStatus:'personal'});
  finish();await work;
  assert.deepEqual(fb.calls.writes,[['update','users/uidA',{linkedOwnerUid:null}]]);
  assert.equal(app.__household.getState().bootPhase,'ready');
  assert.equal(fb.calls.subscribed,0);
});

test('共有離脱後も全初回データを受信するまで通常画面を開かない', async t => {
  const {app,fb}=setup(t,{autoSnapshots:false});
  app.__household.setCurrentUser(USER_A);
  Object.assign(app.__household.getState(),{bootPhase:'ready',householdStatus:'shared',linkedOwnerUid:'owner1'});
  const work=app.App.leaveHousehold();
  for(let i=0;i<20;i++) await Promise.resolve();
  assert.equal(fb.calls.subscribed,8);
  assert.equal(app.isAppReady(),false);
  for(const h of fb.calls.snapshotHandlers) h.cb({docs:[],data:()=>({}),metadata:{fromCache:false}});
  await work;
  assert.equal(app.isAppReady(),true);
});

test('共有復帰の無応答を15秒で停止し遅延読取り後に書き込まない', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const {app,fb}=setup(t);
  app.__household.setCurrentUser(USER_A);
  Object.assign(app.__household.getState(),{bootPhase:'ready',householdStatus:'left',knownHouseholdUid:'owner1'});
  let finish;
  fb.setDoc('users/owner1',{server:()=>new Promise(r=>{finish=r;})});
  const work=app.App.rejoinHousehold();
  t.mock.timers.tick(15001);await work;
  assert.equal(app.__household.getState().bootPhase,'error');
  finish({exists:true,data:()=>({})});await Promise.resolve();await Promise.resolve();
  assert.deepEqual(fb.calls.writes,[]);
  await app.App.retryHousehold();
  assert.equal(app.isAppReady(),true);
  assert.deepEqual(fb.calls.writes,[]);
});
