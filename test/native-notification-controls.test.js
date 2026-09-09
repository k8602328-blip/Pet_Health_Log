const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./load-app');

test('notification times reject off-slot minutes reported on device', () => {
  const {isValidReminderTime}=loadApp();
  for(const time of ['12:41','12:42','13:22','24:00','12:60','12:45:00','']) assert.equal(isValidReminderTime(time),false,time);
  for(const time of ['00:00','12:40','12:45','13:25','23:55']) assert.equal(isValidReminderTime(time),true,time);
});

test('off-slot notification time is not added to the saved draft', () => {
  const input={value:'12:41'};
  const app=loadApp({document:{addEventListener(){},getElementById:()=>input}});
  const previous=global.alert; global.alert=()=>{};
  try { app.App.addReminderTime(); assert.deepEqual(app.__household.getState().reminderTimesDraft,[]); }
  finally { global.alert=previous; }
});

test('existing off-slot notification blocks medication save for a subscriber', () => {
  const app=loadApp({document:{addEventListener(){},getElementById:()=>({value:'med'})}});
  const state=app.__household.getState();
  state.bootPhase='ready'; state.householdStatus='ready'; state.currentPetId='pet';
  app.__household.setCurrentUser({uid:'A'});
  state.entitlements={subscriptionActive:true}; state.reminderTimesDraft=['13:22'];
  const messages=[]; const previous=global.alert; global.alert=m=>messages.push(m);
  try { app.App.submitMed({preventDefault(){}}); assert.match(messages[0],/5分刻み以外/); }
  finally { global.alert=previous; }
});

test('native notification explanation and controls are hidden for non-subscribers', () => {
  const main={innerHTML:''};
  const app=loadApp({document:{addEventListener(){},getElementById:()=>main},
    window:{NativeBridge:{isNative:true,notifications:{getStatus:()=>({enabled:true,registered:true})}}}});
  const state=app.__household.getState();
  state.entitlements={subscriptionActive:false};
  app.App.renderMedsTab();
  assert.doesNotMatch(main.innerHTML,/再ログイン時|App\.disableNotifications|App\.enableNotifications/);
  state.entitlements.subscriptionActive=true;
  app.App.renderMedsTab();
  assert.match(main.innerHTML,/再ログイン時/);
  assert.match(main.innerHTML,/App\.disableNotifications/);
});

test('native notification off reports success only after cleanup completes', async () => {
  let resolve; const pending = new Promise(r => { resolve = r; });
  const app = loadApp({ window:{ NativeBridge:{ isNative:true, notifications:{ turnOff:()=>pending } } } });
  app.__household.setCurrentUser({uid:'A'});
  const messages=[]; const previous=global.alert; global.alert=message=>messages.push(message);
  let renders=0; app.App.render=()=>renders++;
  try {
    const result=app.App.disableNotifications(); assert.equal(messages.length,0);
    resolve(); await result;
    assert.match(messages[0],/無効にしました/); assert.equal(renders,1);
  } finally { global.alert=previous; }
});

test('native notification cleanup failure provides retry without claiming off', async () => {
  const app=loadApp({window:{NativeBridge:{isNative:true,notifications:{turnOff:async()=>{throw Error('offline');}}}}});
  app.__household.setCurrentUser({uid:'A'}); app.App.render=()=>{};
  const messages=[]; const previous=global.alert; global.alert=m=>messages.push(m);
  try { await app.App.disableNotifications(); assert.match(messages[0],/解除が完了していません/); }
  finally { global.alert=previous; }
});

test('late notification enable result does not alert or redraw another account', async () => {
  let resolve; const pending=new Promise(r=>{resolve=r;});
  const app=loadApp({window:{NativeBridge:{isNative:true,notifications:{enable:()=>pending}}}});
  app.__household.setCurrentUser({uid:'A'}); app.App.render=()=>assert.fail('stale redraw');
  const previous=global.alert; global.alert=()=>assert.fail('stale alert');
  try {
    const result=app.App.enableNotifications(); app.__household.setCurrentUser({uid:'B'});
    resolve('granted'); await result;
  } finally { global.alert=previous; }
});
