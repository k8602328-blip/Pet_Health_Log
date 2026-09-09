const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
test('公開Web版に未完成ストア購入を含めず600円Checkoutを維持する',()=>{
 assert.doesNotMatch(html,/NativeBridge\.billing|restoreNativePurchases|renderSubscriptionManagement|nativePurchasable/);
 assert.match(html,/displayedSupportPlanAmount: 600/);
 assert.match(html,/item:'supportPlan', label:'治療サポートプラン', price:'¥600\/月'/);
});
