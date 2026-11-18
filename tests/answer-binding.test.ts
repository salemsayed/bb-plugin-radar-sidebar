import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerDraft, requestFill, pendingFill } from '../lib/composerFill';
import { armAskStrip, clearAskStrip } from '../lib/askStrip';
test('Radar answer carries the task mention and exact selected text',()=>{
 armAskStrip({key:'ask:ptask_release',threadId:'thr_coordinator',question:'Deploy?',title:'Store release',options:['Deploy it','Hold'],botName:'ERBareeq'});
 const draft=answerDraft('Deploy it','thr_coordinator');
 assert.equal(draft.text,'@Store release Deploy it');
 assert.deepEqual(draft.mentions,[{from:0,to:14,label:'Store release',kind:'plugin',pluginId:'orchestrator-mode',provider:'task',id:'ptask_release'}]);
 assert.deepEqual(answerDraft('Hold','another_thread'),{text:'Hold',mentions:[]});clearAskStrip();
});

test('a queued answer retains its original task when another question opens',()=>{
 armAskStrip({key:'ask:ptask_first',threadId:'coordinator',title:'First',question:'Deploy?',options:['Hold'],botName:'Bot'});
 requestFill('coordinator','Hold',[],true);
 armAskStrip({key:'ask:ptask_second',threadId:'coordinator',title:'Second',question:'Deploy?',options:['Hold'],botName:'Bot'});
 const draft=pendingFill()!.draft;
 assert.equal(draft.text,'@First Hold');
 assert.equal((draft.mentions![0] as {id:string}).id,'ptask_first');clearAskStrip();
});

test('the selected question and option survive a task answer button click', () => {
  armAskStrip({ key: 'ask:ptask_a', questionId: 'q_current', threadId: 'coord', title: 'Review', question: 'Ready?', options: ['Yes'], botName: 'Bot' });
  requestFill('coord', 'Yes', [], true);
  const draft = pendingFill()!.draft;
  assert.equal(draft.text, '@Review Yes');
  assert.deepEqual(draft.mentions?.[0], { from: 0, to: 7, label: 'Review', kind: 'plugin', pluginId: 'orchestrator-mode', provider: 'question', id: 'q_current' });
  clearAskStrip();
});
