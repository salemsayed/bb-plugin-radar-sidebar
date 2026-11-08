import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerDraft } from '../lib/composerFill';
import { armAskStrip, clearAskStrip } from '../lib/askStrip';
test('Radar answer carries the task mention and exact selected text',()=>{
 armAskStrip({key:'ask:ptask_release',threadId:'thr_coordinator',question:'Deploy?',title:'Store release',options:['Deploy it','Hold'],botName:'ERBareeq'});
 const draft=answerDraft('Deploy it','thr_coordinator');
 assert.equal(draft.text,'@Store release Deploy it');
 assert.deepEqual(draft.mentions,[{from:0,to:14,label:'Store release',kind:'plugin',pluginId:'orchestrator-mode',provider:'task',id:'ptask_release'}]);
 assert.deepEqual(answerDraft('Hold','another_thread'),{text:'Hold',mentions:[]});clearAskStrip();
});
