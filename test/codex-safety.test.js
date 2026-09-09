'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loadApp } = require('./load-app');
const { reportRangeError, App, __household } = loadApp();
// 起動オーバーレイのガード(isAppReady)が入ったため、レポート系の入口テストは
// 「起動完了(ready)」状態で回す。範囲チェック・多重実行ガードの検証が本来の目的。
__household.getState().bootPhase = 'ready';
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');

test('report rejects empty, reversed, impossible and oversized ranges before spending credit', async () => {
  const cases = [
    {from:'2026-09-01',to:'2026-09-02',records:[],events:[]},
    {from:'2026-09-02',to:'2026-09-01',records:[{}],events:[]},
    {from:'2026-02-30',to:'2026-03-01',records:[{}],events:[]},
    {from:'2026-08-01',to:'2026-09-01',records:[],events:[{}]},
  ];
  const previous = global.alert;
  let alerts = 0, consumed = 0;
  global.alert = () => alerts++;
  try {
    for(const range of cases){
      assert.ok(reportRangeError(range));
      await App.printReport.call({getExportRange:()=>range,consumeReportCreditOrPrompt:()=>{consumed++;}});
    }
    assert.equal(consumed,0);
    assert.equal(alerts,cases.length);
  } finally { global.alert = previous; }
  assert.equal(reportRangeError({from:'2026-09-01',to:'2026-10-01',records:[],events:[{}]}),'');
});

test('in-flight report calls cannot spend a second credit', async () => {
  let consumed = 0;
  await App.printReport.call({reportPrinting:true,
    getExportRange:()=>({from:'2026-09-01',to:'2026-09-01',records:[],events:[{}]}),
    consumeReportCreditOrPrompt:()=>{consumed++;}});
  assert.equal(consumed,0);
});

function deletionFixture({member=false,fail=false}={}){
  const queries=[], deleted=[];
  // Compile the actual method, injecting its persistence boundary.
  const body=html.match(/  async deletePet\(petId\)\{([\s\S]*?)\n  \},/)[1];
  const state={linkedOwnerUid:member?'owner':null,pets:[{id:'p1',name:'Mofu'}],currentPetId:'other'};
  const colRef=name=>({where:(field,idop,id)=>{queries.push([name,field,idop,id]);return {get:async()=>({docs:Array.from({length:name==='events'?401:1},(_,i)=>({ref:`${name}/${i}`}))})};},doc:id=>({delete:async()=>deleted.push(`${name}/${id}`)})});
  const db={batch:()=>{const pending=[];return {delete:ref=>pending.push(ref),commit:async()=>{if(fail)throw Error('offline');deleted.push(...pending);}};}};
  const fn=new Function('state','colRef','db','confirm','prompt','alert','console','isAppReady',`return async function(petId){${body}}`)(state,colRef,db,()=>true,()=> 'Mofu',()=>{}, {error:()=>{}},()=>true);
  return {fn,queries,deleted};
}

test('pet deletion includes events and meals, chunks batches, deletes parent last',async()=>{
  const f=deletionFixture();await f.fn('p1');
  assert.deepEqual(f.queries.map(q=>q[0]),['records','events','mealProfiles','medications','preventions']);
  assert.ok(f.queries.every(q=>q[1]==='petId'&&q[2]==='=='&&q[3]==='p1'));
  assert.equal(f.deleted.filter(x=>x.startsWith('events/')).length,401);
  assert.equal(f.deleted.at(-1),'pets/p1');
});
test('failed child deletion retains parent; shared member cannot delete',async()=>{
  const failed=deletionFixture({fail:true});await failed.fn('p1');assert.ok(!failed.deleted.includes('pets/p1'));
  const member=deletionFixture({member:true});await member.fn('p1');assert.equal(member.queries.length,0);
});

