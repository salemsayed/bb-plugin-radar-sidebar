// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { createCrewServer } from "./crewServer";
import { createCrewStore } from "./crewStore";
import { NEEDS_BOT, makeNeed } from "../components/radar/needsFixtures";
const disposers:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const d of disposers.splice(0))await d();vi.restoreAllMocks();});
async function fixture(options: { events?: unknown[]; prepare?: (store: ReturnType<typeof createCrewStore>) => void } = {}){
 let items=[makeNeed({id:"n",bot:"home",due:null,source:{threadId:"home-thread"}})];
 const sent:{threadId:string;input:unknown}[]=[];let fail=false;let events:unknown[]=options.events??[{seq:1,createdAt:Date.now(),type:"client/turn/requested",data:{initiator:"user",source:"submit",input:[{type:"text",text:"Inspect X and verify it"}]}}];let current="home-thread";let spawned=0;let crewCurrent:string|null=null;let rolling=false;const updates:unknown[]=[];
 const threadEvents=new Map<string,unknown[]>([["old",[]]]);
 const workers=new Map<string,ReturnType<typeof makeThreadResponse>>();
 const unavailable=new Set<string>();
 let {bb,harness}=createFakePluginHost({pluginId:"radar-sidebar",sdk:{plugins:{callRpc:async({method,input}:{method:string;input:{id:string;action:string}})=>{
  if(method==="needs_list")return {items};
  if(method==="needs_update"){const item=items.find(i=>i.id===input.id)!;item.state=input.action==="drop"?"dropped":input.action==="done"?"done":"open";return {item};}
  return {bots:[{...NEEDS_BOT,key:"home",current,coordinatorIds:["old","home-thread"],rollover:rolling?"handoff":null},...(crewCurrent?[{...NEEDS_BOT,key:"crew",current:crewCurrent,projectId:"crew-project"}]:[])]};
 }},threads:{interactions:{list:async()=>[]},events:{list:async(args:{threadId:string;afterSeq?:string;beforeSeq?:string;order?:string;limit?:string;types?:string[]})=>{
 let rows=(threadEvents.get(args.threadId)??events) as {seq:number;type:string}[];
 if(args.types)rows=rows.filter(e=>args.types!.includes(e.type));
 if(args.afterSeq!==undefined)rows=rows.filter(e=>e.seq>Number(args.afterSeq));
 if(args.beforeSeq!==undefined)rows=rows.filter(e=>e.seq<Number(args.beforeSeq));
 rows=[...rows].sort((a,b)=>args.order==="desc"?b.seq-a.seq:a.seq-b.seq);
 return rows.slice(0,Number(args.limit??100));
 }},send:async(i:{threadId:string;input:unknown})=>{sent.push(i);if(fail)throw new Error("transport lost");},get:async({threadId}:{threadId:string})=>{if(unavailable.has(threadId))throw new Error("Thread unavailable");return workers.get(threadId)??makeThreadResponse({id:threadId,projectId:threadId.startsWith("manager")?"crew-project":"proj",environmentId:"env",providerId:"codex",status:"idle",visibility:"visible"});},update:async(i:unknown)=>{updates.push(i);return {}; },defaultExecutionOptions:async()=>null,spawn:async()=>{spawned++;return{id:"manager"};},getPluginMetadata:async()=>({}),list:async()=>[]}} as never});
 disposers.push(()=>harness.lifecycle.dispose());let store=createCrewStore(bb.storage.database());store.setControl({coordinator:"manager"});options.prepare?.(store);let server=createCrewServer(bb);await server.crew_refresh();
 const call=(name:string,input:unknown,threadId="manager")=>harness.behavior.callAgentTool(name,input,{threadId});
 await new Promise(r=>setTimeout(r,0));
 return{get server(){return server;},get store(){return store;},call,sent,get harness(){return harness;},workers,unavailable,spawned:()=>spawned,fail:()=>{fail=true;},events:(x:unknown[],threadId?:string)=>{if(threadId)threadEvents.set(threadId,x);else events=x;},needs:(x:typeof items)=>{items=x;},roll:()=>{current="new-home";},registerCrew:(id="manager")=>{crewCurrent=id;},rolling:()=>{rolling=true;},updates,
 async reload(){let next!:ReturnType<typeof createCrewServer>;const replacement=await harness.lifecycle.reload(api=>{next=createCrewServer(api);});bb=replacement.bb;harness=replacement.harness;server=next;store=createCrewStore(bb.storage.database());await new Promise(r=>setTimeout(r,10));}};
}
const assignment={eventId:"assign",owner:"home",key:"x",title:"X",objective:"Inspect X",userSeq:1};
it("shadow manager proposes but never sends a specialist message",async()=>{const h=await fixture();await h.call("crew_assign",assignment);expect(h.store.commands()[0]?.state).toBe("proposed");expect(h.sent).toEqual([]);});
it("unregistered threads cannot create work",async()=>{const h=await fixture();await expect(h.call("crew_assign",assignment,"other")).rejects.toThrow("registered");});
it("bots can adopt only their own direct work",async()=>{const h=await fixture();await h.call("crew_assign",assignment,"home-thread");expect(h.store.work().find(w=>w.key==="x")?.origin).toBe("direct");expect(h.sent).toEqual([]);await expect(h.call("crew_assign",{...assignment,owner:"bricks"},"home-thread")).rejects.toThrow("owner");});
it("pause prevents new manager work",async()=>{const h=await fixture();await h.server.crew_control({paused:true});await expect(h.call("crew_assign",assignment)).rejects.toThrow("paused");});
it("explicit live activation does not promote old shadow proposals",async()=>{const h=await fixture();await h.call("crew_assign",assignment);await h.server.crew_control({mode:"live"});expect(h.store.control().mode).toBe("live");expect(h.store.commands()[0]?.state).toBe("proposed");expect(h.sent).toEqual([]);});
it("uncertain delivery stays pinned across bot rollover and never resends",async()=>{const h=await fixture();h.store.setControl({mode:"live"});h.fail();await h.call("crew_assign",assignment);await new Promise(r=>setTimeout(r,20));expect(h.sent).toHaveLength(1);expect(h.store.commands()[0]?.state).toBe("uncertain");h.roll();await h.server.crew_refresh();await h.server.crew_reconcile({commandId:"assign"});expect(h.sent).toHaveLength(1);expect(h.store.commands()[0]?.recipient).toBe("home-thread");});
it("receipt reconciles after lost send response",async()=>{const h=await fixture();h.store.setControl({mode:"live"});h.fail();await h.call("crew_assign",assignment);await new Promise(r=>setTimeout(r,20));h.events([{seq:2,type:"client/turn/requested",data:{input:[{type:"text",text:"[crew-command:assign]"}]}}]);expect((await h.server.crew_reconcile({commandId:"assign"})).state).toBe("received");expect(h.store.work().find(w=>w.key==="x")?.stage).toBe("queued");});
it("existing coordinator setup does not spawn again",async()=>{const h=await fixture();h.registerCrew();await h.server.crew_setup({baseThreadId:"base"});expect(h.spawned()).toBe(0);expect(h.updates).toContainEqual({threadId:"manager",visibility:"hidden"});});
it("replacement uses the registered bot rollover lifecycle",async()=>{const h=await fixture();await expect(h.server.crew_setup({baseThreadId:"base",replace:true})).rejects.toThrow("saelmbot rollover");expect(h.spawned()).toBe(0);});
it("manager cannot pretend to be a bot acknowledging completion",async()=>{const h=await fixture();await h.call("crew_assign",assignment);const w=h.store.work().find(w=>w.key==="x")!;await expect(h.call("crew_report",{eventId:"done",workId:w.id,expectedRevision:1,kind:"completed",evidence:"Trust me"})).rejects.toThrow("specialist");});
it("organize rejects closures without source event evidence",async()=>{const h=await fixture();await expect(h.call("crew_organize",{eventId:"o",sourceIds:["n"],sourceVersions:{n:"v"},workKey:"x",title:"X",requestKey:"x",state:"withdrawn",placement:"later",evidence:"Old"})).rejects.toThrow("user event");});
it("answer tool rejects fabricated or automatic user events",async()=>{const h=await fixture();h.events([{seq:4,type:"client/turn/requested",data:{initiator:"agent",input:[{type:"text",text:"yes"}]}}]);await expect(h.call("crew_answer",{commandId:"a",requestId:"q",expectedVersion:1,userSeq:4})).rejects.toThrow("real user");});

it("explicit dismissal closes the original reminder source in live mode",async()=>{const h=await fixture();await h.server.crew_control({mode:"live"});const q=h.store.requests()[0]!;await h.server.crew_user_request({commandId:"dismiss",requestId:q.id,expectedVersion:q.version,action:"dismiss"});await new Promise(r=>setTimeout(r,20));expect(h.store.sources()[0]?.state).toBe("dropped");expect(h.store.commands().find(c=>c.kind==="source_update")?.state).toBe("received");expect(h.sent).toHaveLength(0);});
it("direct-chat answer uses real user text and needs no reply dispatch",async()=>{const h=await fixture();await h.call("crew_assign",assignment,"home-thread");const w=h.store.work().find(w=>w.key==="x")!;await h.call("crew_report",{eventId:"q",workId:w.id,expectedRevision:1,kind:"question",requestKey:"a",text:"A?",evidence:"Need input"},"home-thread");const q=h.store.requests().find(q=>q.workId===w.id)!;h.events([{seq:12,type:"client/turn/requested",data:{initiator:"user",source:"submit",systemMessageKind:"unlabeled",input:[{type:"text",text:"200"}]}}]);await h.call("crew_report",{eventId:"ack",workId:w.id,expectedRevision:2,kind:"direct_answer",requestId:q.id,expectedVersion:1,userSeq:12,evidence:"Accepted balance"},"home-thread");expect(h.store.getRequest(q.id)).toMatchObject({state:"answered",answer:"200"});expect(h.sent).toEqual([]);});
it("manager binds native chat answers using unlabeled human events",async()=>{const h=await fixture();const q=h.store.requests()[0]!;h.events([{seq:9,type:"client/turn/requested",data:{initiator:"user",source:"submit",systemMessageKind:"unlabeled",input:[{type:"text",text:"My exact reply"}]}}]);await h.call("crew_answer",{commandId:"reply",requestId:q.id,expectedVersion:q.version,userSeq:9});expect(h.store.getRequest(q.id).answer).toBe("My exact reply");});
it("explicit proposal dispatch sends once after live activation",async()=>{const h=await fixture();await h.call("crew_assign",assignment);await h.server.crew_control({mode:"live"});await h.server.crew_proposal({commandId:"approve",proposalId:"assign",action:"send"});await new Promise(r=>setTimeout(r,20));expect(h.sent).toHaveLength(1);expect(h.sent[0]?.threadId).toBe("home-thread");await h.server.crew_proposal({commandId:"approve",proposalId:"assign",action:"send"});expect(h.sent).toHaveLength(1);});
it("source imports cannot be counted as reviewed real transitions",async()=>{const h=await fixture();const e=h.store.events().find(e=>e.kind==="source")!;await expect(h.server.crew_review({eventId:e.id,verdict:"correct"})).rejects.toThrow("actual coordinator");});

it("follows registered Crew rollover and hides the replacement",async()=>{const h=await fixture();h.registerCrew("manager-new");await h.server.crew_refresh();expect(h.store.control().coordinator).toBe("manager-new");expect(h.updates).toContainEqual({threadId:"manager-new",visibility:"hidden"});});
it("holds dispatch while the destination bot is handing off",async()=>{const h=await fixture();h.rolling();await h.server.crew_control({mode:"live"});await h.call("crew_assign",assignment);await new Promise(r=>setTimeout(r,20));expect(h.sent).toEqual([]);expect(h.store.commands()[0]?.state).toBe("queued");});

it("evidence closure reads exact user and acknowledgment events across long tool runs",async()=>{const h=await fixture();const q=h.store.requests()[0]!;h.events([{seq:10,createdAt:Date.now(),type:"client/turn/requested",data:{initiator:"user",systemMessageKind:"unlabeled",input:[{text:"Done except descale"}]}},{seq:1010,createdAt:Date.now()+1,type:"item/completed",data:{item:{type:"agentMessage",text:"Recorded; descale remains pending"}}}]);await h.call("crew_organize",{eventId:"o",sourceIds:q.sourceIds,sourceVersions:q.sourceVersions,workKey:"care",title:"Care",requestKey:"date-input",state:"answered",placement:"needs_you",remaining:{key:"descale",text:"Descale is pending",placement:"reminders"},evidenceThread:"home-thread",userSeq:10,botSeq:1010,evidence:"Actual answer and acknowledgment"});expect(h.store.requests().find(r=>r.key==="date-input")?.state).toBe("answered");expect(h.store.requests().find(r=>r.key==="descale")).toMatchObject({text:"Descale is pending",state:"open",sourceIds:[]});});

it("requires a real user event for assignments and persists its exact scope",async()=>{
 const h=await fixture();await expect(h.call("crew_assign",{...assignment,userSeq:undefined})).rejects.toThrow("actual user");
 h.events([{seq:1,type:"client/turn/requested",data:{initiator:"user",systemMessageKind:"unlabeled",input:[{text:"BOT_AUTOMATION_NOTICE_test"}]}}]);await expect(h.call("crew_assign",assignment)).rejects.toThrow("real user");
 h.events([{seq:1,type:"client/turn/requested",data:{initiator:"user",input:[{text:"Inspect, validate and clean up"}]}}]);await h.call("crew_assign",assignment);
 expect(h.store.work().find(w=>w.key==="x")?.authorization).toEqual({threadId:"manager",userSeq:1,text:"Inspect, validate and clean up"});
});
it("specialists can read their own history but cannot read another bot's conversation",async()=>{
 const h=await fixture();expect(JSON.parse(String(await h.call("crew_history",{threadId:"home-thread"},"home-thread"))).messages).toHaveLength(1);
 await expect(h.call("crew_history",{threadId:"other-private"},"home-thread")).rejects.toThrow("owned");
});
it("checks tracked workers in the actual SDK before completion or cancellation acknowledgment",async()=>{
 const h=await fixture();await h.call("crew_assign",assignment,"home-thread");const w=h.store.work().find(w=>w.key==="x")!;
 h.workers.set("worker",makeThreadResponse({id:"worker",parentThreadId:"home-thread",status:"active",archivedAt:1}));
 await h.call("crew_report",{eventId:"p",workId:w.id,expectedRevision:1,kind:"progress",workerIds:["worker"],evidence:"Worker testing"},"home-thread");
 const checks={delivery:{status:"passed",evidence:"Delivered"},verification:{status:"passed",evidence:"Actual test passed"},cleanup:{status:"passed",evidence:"Temporary files removed"}};
 await expect(h.call("crew_report",{eventId:"d",workId:w.id,expectedRevision:2,kind:"completed",checks,evidence:"Done"},"home-thread")).rejects.toThrow("still running");
 await h.server.crew_user_cancel({commandId:"stop",workId:w.id,expectedRevision:2});
 await expect(h.call("crew_report",{eventId:"c",workId:w.id,expectedRevision:3,kind:"cancel_ack",evidence:"Stopped"},"home-thread")).rejects.toThrow("still running");
 h.workers.set("worker",makeThreadResponse({id:"worker",parentThreadId:"home-thread",status:"idle"}));
 await h.call("crew_report",{eventId:"c",workId:w.id,expectedRevision:3,kind:"cancel_ack",evidence:"Stopped"},"home-thread");expect(h.store.getWork(w.id).stage).toBe("canceled");
});
const human=(seq:number,createdAt=Date.now(),text="My answer")=>({seq,createdAt,type:"client/turn/requested",data:{initiator:"user",source:"submit",systemMessageKind:"unlabeled",input:[{type:"text",text}]}});
const reply=(seq:number,createdAt=Date.now())=>({seq,createdAt,type:"item/completed",data:{item:{type:"agentMessage",text:"Current reply"}}});
const idle=async(h:Awaited<ReturnType<typeof fixture>>,threadId="home-thread")=>{await h.harness.behavior.emitThreadEvent("thread.idle",{thread:makeThreadResponse({id:threadId}),lastAssistantText:"Current reply"});await new Promise(r=>setTimeout(r,20));};
it("bounds retries by human reply across reload; routine bot replies cannot reset them",async()=>{
 const h=await fixture();let at=Date.now();vi.spyOn(Date,"now").mockImplementation(()=>at);
 const original=human(10,at);h.events([original,reply(20,at+1)]);
 for(let n=0;n<3;n++){at+=360000;h.events([original,reply(20+n,at)]);await idle(h);if(n===0)await h.reload();}
 expect(h.store.commands().filter(c=>c.id.startsWith("history:home-thread:user:10"))).toHaveLength(3);
 at+=360000;h.events([original,reply(100,at)]);await idle(h);expect((await h.server.crew_board()).warning).toContain("held after 3");expect(h.store.commands().filter(c=>c.id.startsWith("history:home-thread:user:10"))).toHaveLength(3);
 h.events([original,reply(100,at),human(110,at+1),reply(120,at+2)]);at+=360000;await idle(h);expect(h.store.commands().some(c=>c.id==="history:home-thread:user:110")).toBe(true);
});
it("routine automation and worker notices never wake Crew with an open reminder",async()=>{
 const h=await fixture();h.needs([makeNeed({id:"r",bot:"home",kind:"reminder",due:"2026-11-01",source:{threadId:"home-thread"},reminders:2})]);
 for(const notice of [{...human(10),data:{...human(10).data,initiator:"agent"}},{...human(10),data:{...human(10).data,senderThreadId:"worker"}},human(10,Date.now(),"[bb message from thread:worker] Finished"),human(10,Date.now(),"BOT_AUTOMATION_NOTICE_done")]){h.events([notice,reply(20)]);await idle(h);}
 expect(h.sent).toEqual([]);expect(h.store.commands().filter(c=>c.kind==="wake")).toEqual([]);expect(h.store.requests().find(q=>q.sourceIds.includes("r"))).toMatchObject({state:"open",placement:"reminders",due:"2026-11-01"});
});
it("ignores human messages predating the request and waits for a settled coordinator reply",async()=>{
 const h=await fixture();h.events([human(10,Date.parse("2026-10-06T00:00:00Z")),reply(20)]);await idle(h);expect(h.sent).toEqual([]);
 const answer=human(30);h.events([answer,{...reply(40),data:{item:{type:"agentMessage",text:"Worker output",parentToolCallId:"tool"}}}]);await idle(h);expect(h.sent).toEqual([]);
 h.events([answer,reply(50)]);h.workers.set("home-thread",makeThreadResponse({id:"home-thread",status:"active"}));await idle(h);expect(h.sent).toEqual([]);
 h.workers.set("home-thread",makeThreadResponse({id:"home-thread",status:"idle",queuedMessageCount:1}));await idle(h);expect(h.sent).toEqual([]);
 h.workers.set("home-thread",makeThreadResponse({id:"home-thread",status:"idle",activeBackgroundAgentCount:1}));await idle(h);expect(h.sent).toEqual([]);
 h.workers.delete("home-thread");await idle(h);expect(h.sent).toHaveLength(1);expect(h.store.cursors().find(c=>c.threadId==="home-thread")).toMatchObject({userSeq:30,observedSeq:50});
});
it("reload catches a human answer in a registered predecessor and keeps reviews independent",async()=>{
 const h=await fixture();h.events([human(10),reply(1010)],"home-thread");h.events([],"new-home");h.roll();await h.reload();
 expect(h.sent).toHaveLength(1);expect(h.store.commands().find(c=>c.kind==="wake")).toMatchObject({id:"history:home-thread:user:10",state:"received"});
 await h.call("crew_reconciled",{bot:"home",threadId:"home-thread",throughSeq:1010});
 h.events([human(15),reply(25)],"new-home");await idle(h,"new-home");expect(h.sent).toHaveLength(2);
 expect(h.store.cursors()).toEqual(expect.arrayContaining([expect.objectContaining({threadId:"home-thread",reconciledSeq:1010,userSeq:10}),expect.objectContaining({threadId:"new-home",observedSeq:25,reconciledSeq:0,userSeq:15})]));
 await h.call("crew_reconciled",{bot:"home",threadId:"new-home",throughSeq:25});h.events([human(15),reply(50)],"new-home");await h.reload();await idle(h,"home-thread");await idle(h,"new-home");expect(h.sent).toHaveLength(2);
});
it("pause retains a human review for resume and coalesces multiple bot conversations",async()=>{
 const h=await fixture();await h.server.crew_control({paused:true});h.events([human(10),reply(20)],"home-thread");h.events([human(30),reply(40)],"old");await idle(h);await idle(h,"old");expect(h.sent).toEqual([]);expect(h.store.commands().filter(c=>c.state==="queued")).toHaveLength(2);
 await h.reload();expect(h.sent).toEqual([]);await h.server.crew_control({paused:false});await new Promise(r=>setTimeout(r,20));expect(h.sent).toHaveLength(1);expect(JSON.stringify(h.sent[0]?.input)).toContain("user event 10");expect(JSON.stringify(h.sent[0]?.input)).toContain("user event 30");
 const read=JSON.parse(String(await h.call("crew_read",{})));expect(read.cursors).toHaveLength(2);
});
it("quietly retires queued legacy wakes while preserving pinned uncertain delivery",async()=>{
 const h=await fixture({prepare:s=>{s.setControl({paused:true});const base={workId:"crew-service",requestId:null,requestVersion:null,kind:"wake" as const,text:"Legacy broad review",recipient:null,baseline:0,createdAt:Date.now(),receivedAt:null};s.saveCommand({...base,id:"history:home-thread:20",state:"queued"});s.saveCommand({...base,id:"wake:source:n",state:"queued"});s.saveCommand({...base,id:"old-send",state:"sending",recipient:"manager-old"});s.saveCommand({...base,id:"old-uncertain",state:"uncertain",recipient:"manager-old"});}});
 const before=h.store.requests();h.events([{seq:5,type:"client/turn/requested",data:{input:[{text:"[crew-command:old-send]"}]}}],"manager-old");h.registerCrew("manager-new");await h.server.crew_control({paused:false});await new Promise(r=>setTimeout(r,20));
 expect(h.sent).toEqual([]);expect(h.store.requests()).toEqual(before);expect(h.store.commands().filter(c=>c.state==="obsolete")).toHaveLength(2);expect(h.store.commands().find(c=>c.id==="old-send")).toMatchObject({recipient:"manager-old",state:"received"});expect(h.store.commands().find(c=>c.id==="old-uncertain")).toMatchObject({recipient:"manager-old",state:"uncertain"});
});
it("manual reconcile with no human answer stays quiet",async()=>{const h=await fixture();h.events([reply(20)]);const result=await h.harness.behavior.runCli(["reconcile","--json"]);expect(result.exitCode).toBe(0);expect(JSON.parse(result.stdout!)).toMatchObject({queued:false});expect(h.sent).toEqual([]);});
it("an unavailable conversation does not prevent other lineage answers catching up",async()=>{const h=await fixture();h.unavailable.add("home-thread");h.events([human(10),reply(20)],"old");await h.reload();expect(h.sent).toHaveLength(1);expect(h.store.commands().find(c=>c.kind==="wake")?.id).toBe("history:old:user:10");expect((await h.server.crew_board()).warning).toContain("Thread unavailable");});
it("manual reconcile can explicitly retry an exhausted real-answer review",async()=>{const h=await fixture({events:[human(10),reply(20)],prepare:s=>{s.observeCursor("home","home-thread",20,Date.now(),10);for(let n=0;n<3;n++)s.saveCommand({id:`history:home-thread:user:10${n?`:retry:${n}`:""}`,workId:"crew-service",requestId:null,requestVersion:null,kind:"wake",state:"received",text:"Answer check",recipient:"manager",baseline:0,createdAt:Date.now()-360000*(3-n),receivedAt:Date.now()});}});expect(h.sent).toEqual([]);const result=await h.harness.behavior.runCli(["reconcile","--json"]);expect(result.exitCode).toBe(0);expect(JSON.parse(result.stdout!)).toMatchObject({queued:true});expect(h.sent).toHaveLength(1);await h.call("crew_reconciled",{bot:"home",threadId:"home-thread",throughSeq:20});expect((await h.server.crew_board()).warning).toBeNull();});
it("Crew-assigned blockers wake the coordinator once while ordinary progress stays quiet",async()=>{const h=await fixture();h.store.setControl({mode:"live"});await h.call("crew_assign",assignment);await new Promise(r=>setTimeout(r,20));const w=h.store.work().find(w=>w.key==="x")!;await h.call("crew_report",{eventId:"p",workId:w.id,expectedRevision:1,kind:"progress",evidence:"Working"},"home-thread");await new Promise(r=>setTimeout(r,20));expect(h.sent.map(s=>s.threadId)).toEqual(["home-thread"]);const q={eventId:"q",workId:w.id,expectedRevision:2,kind:"question",requestKey:"a",text:"A?",evidence:"Need a choice"};await h.call("crew_report",q,"home-thread");await new Promise(r=>setTimeout(r,20));await h.call("crew_report",q,"home-thread");expect(h.sent.map(s=>s.threadId)).toEqual(["home-thread","manager"]);expect(JSON.stringify(h.sent[1]?.input)).toContain("Do not relay unrelated bot findings");});
it("records automation questions while paused and rejects non-owner plugin calls",async()=>{
 const h=await fixture();await h.server.crew_control({paused:true});
 const i={eventId:"automation:q",owner:"home",automationId:"auto_1",reportId:"run:1",sourceThreadId:"home-thread",question:"Choose A?",evidence:"A needs an answer"};
 await expect(h.server.crew_automation_question(i,{experimental_caller:{kind:"plugin",pluginId:"other"}})).rejects.toThrow("owner plugin");
 const ctx={experimental_caller:{kind:"plugin" as const,pluginId:"orchestrator-mode"}};
 const first=await h.server.crew_automation_question(i,ctx);const again=await h.server.crew_automation_question(i,ctx);
 expect(again).toEqual(first);expect(h.store.getRequest(first.requestId)).toMatchObject({state:"open",version:1,text:"Choose A?"});expect(h.sent).toEqual([]);
 h.roll();await h.server.crew_refresh();await h.server.crew_automation_question({...i,sourceThreadId:"new-home"},ctx);expect(h.store.getRequest(first.requestId).version).toBe(1);
});
it("binds a direct answer from the owning bot's predecessor after rollover",async()=>{
 const h=await fixture();await h.call("crew_assign",assignment,"home-thread");const w=h.store.work().find(w=>w.key==="x")!;
 await h.call("crew_report",{eventId:"q",workId:w.id,expectedRevision:1,kind:"question",requestKey:"choice",text:"A?",evidence:"Choice needed"},"home-thread");const q=h.store.requests().find(q=>q.workId===w.id)!;
 h.events([{seq:5,type:"client/turn/requested",data:{initiator:"user",input:[{text:"Pick A and verify it"}]}}],"old");
 const i={eventId:"answer",workId:w.id,expectedRevision:2,kind:"direct_answer",requestId:q.id,expectedVersion:1,userSeq:5,evidence:"Accepted A"};
 await expect(h.call("crew_report",{...i,userThreadId:"other-private"},"home-thread")).rejects.toThrow("own bot");
 // The fixture's registry already carries "old" as a registered predecessor.
 await h.call("crew_report",{...i,userThreadId:"old"},"home-thread");expect(h.store.getRequest(q.id)).toMatchObject({state:"answered",answer:"Pick A and verify it"});
});
