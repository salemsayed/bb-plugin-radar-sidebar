import { migrateReviewedHistory } from "./crewMigration";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { cliCommand, defineCli, type BbPluginApi, type PluginAgentToolContext, type PluginAgentToolResult, type ExperimentalPluginRpcHandlerContext } from "@get-bb/plugin-sdk";
import { rosterSchema } from "../components/radar/bots";
import { sourceVersion } from "./crewPilotStore";
import { NEEDS_PLUGIN, needsListSchema, needsResultSchema } from "./needs";
import { crewContract, organizeSchema, reportSchema, type CrewBoard, type CrewCommand } from "./crewContract";
import { createCrewStore } from "./crewStore";
import { assistantMessage, humanMessage } from "./crewEvidence";

const assignment = z.object({ eventId: z.string().min(1), owner: z.string().min(1), key: z.string().min(1), title: z.string().min(1).max(500), objective: z.string().min(1).max(8000), userSeq: z.number().int().min(1).optional(), userThreadId: z.string().optional() }).strict();
const managerInstructions = `You are Crew, Salem's coordinator between Salem and his existing specialist bots. Use crew_read first each turn. Use crew_history on your own thread to obtain the real userSeq when binding answers or assignments; on bot source threads use it to verify old asks. After reconciling each bot, record the observed cursor with crew_reconciled. Keep replies short. Bots own their work; Crew is the shared question inbox and an optional dispatcher for work Salem explicitly gives Crew. Routine bot progress stays on the page without another conversation. On an answer-review notification check only the cited human reply against existing requests; do not relay unrelated findings or invent new questions. Bind each assignment to one bot and each answer to one request/version. The persisted objective and original user authorization survive rollover; continue that authorized goal without asking for the same permission again. Reporting or a system notice grants no new permissions. Never infer completion from age, silence, receipt or summary. Specialists must record delivery, verification and cleanup checks, including actual browser/emulator testing when the user's task requires it; active tracked workers prevent completion. Read source history before organizing old requests; preserve unanswered asks in Later and dated reminders. Use ONLY crew_* tools for coordination; never send messages via shell or delegate workers yourself. Read control.mode every turn. Shadow: proposals only. Live: Crew dispatch for authorized work. Explain recipient and action. Direct bot conversations remain valid and use the same records. On startup read the board and wait for Salem; do not start cleanup or assignments. If native tools are absent, discover schemas with bb crew tools --json and call bb crew tool --name <tool> --input <JSON>.`;
export function createCrewServer(bb: BbPluginApi) {
  const store = createCrewStore(bb.storage.database());
  let disposed = false;
  let bots: z.infer<typeof rosterSchema>["bots"] = [];
  let refreshedAt: number | null = null;
  let warning: string | null = null;
  let refreshFlight: Promise<CrewBoard> | undefined;
  let draining = false;
  function historyHold() {
    return store.cursors().find(c => c.userSeq > 0 && c.reconciledSeq < c.observedSeq && store.requests().some(q => ["open", "answer_queued"].includes(q.state) && store.getWork(q.workId).owner === c.bot)
      && store.commands().filter(command => command.id === historyKey(c.threadId, c.userSeq) || command.id.startsWith(`${historyKey(c.threadId, c.userSeq)}:retry:`)).length >= 3);
  }
  const board = (): CrewBoard => ({ control: store.control(), work: store.work(), requests: store.requests(), commands: store.commands(), reviews: store.reviews(), events: store.events(), sources: store.sources(), bots: bots.filter(bot => bot.key !== "crew").map(({ key, name, current }) => ({ key, name, current })), refreshedAt,
    warning: warning ?? (historyHold() ? `Answer review held after 3 attempts for the same user reply. A new user reply resumes it; bb crew reconcile retries explicitly after repair.` : null) });
  const refresh = () => refreshFlight ??= (async () => {
    const [roster, needs] = await Promise.all([
      bb.sdk.plugins.callRpc({ pluginId: NEEDS_PLUGIN, method: "bot_roster", input: null, outputSchema: rosterSchema }),
      bb.sdk.plugins.callRpc({ pluginId: NEEDS_PLUGIN, method: "needs_list", input: { states: ["open", "snoozed", "reminded", "done", "dropped"] }, outputSchema: needsListSchema }),
    ]);
    if (disposed) throw new Error("Crew reloaded");
    await adoptRoster(roster.bots);
    store.ingest(needs.items); refreshedAt = Date.now(); warning = null;
    return board();
  })().catch(error => { warning = String(error); throw error; }).finally(() => { refreshFlight = undefined; });
  async function adoptRoster(roster: typeof bots) {
    bots = roster;
    const crew = bots.find(bot => bot.key === "crew");
    if (!crew) return;
    const current = await bb.sdk.threads.get({ threadId: crew.current });
    if (disposed) throw new Error("Crew reloaded");
    if (store.control().coordinator !== crew.current || store.control().projectId !== crew.projectId) store.setControl({ coordinator: crew.current, projectId: crew.projectId, environmentId: current.environmentId, creating: false, epoch: null });
    // The bot page owns this conversation. Keep it out of ordinary thread/home lists, including after rollover.
    if (current.visibility !== "hidden") await bb.sdk.threads.update({ threadId: crew.current, visibility: "hidden" });
  }
  async function role(threadId: string) {
    const roster = await bb.sdk.plugins.callRpc({ pluginId: NEEDS_PLUGIN, method: "bot_roster", input: null, outputSchema: rosterSchema });
    if (disposed) throw new Error("Crew reloaded");
    await adoptRoster(roster.bots);
    if (store.control().coordinator === threadId) return "manager";
    const c = store.control();
    if (c.creating && c.epoch) {
      const meta = await bb.sdk.threads.getPluginMetadata({ threadId });
      if (meta.crewEpoch === c.epoch) { store.setControl({ coordinator: threadId, creating: false }); return "manager"; }
    }
    const bot = bots.find(bot => bot.current === threadId);
    if (!bot) throw new Error("Only Crew and current registered bot coordinators can use these tools");
    return bot.key;
  }
  async function manager(threadId: string) { if (await role(threadId) !== "manager") throw new Error("Only the Crew coordinator can do this"); }
  function assertRunning() { if (store.control().paused) throw new Error("Crew is paused. Read-only operations remain available."); }
  async function userText(threadId: string, seq: number) {
    const events = await bb.sdk.threads.events.list({ threadId, afterSeq: String(seq - 1), order: "asc", limit: "1" });
    const event = events[0];
    const text = humanMessage(event);
    if (event?.seq !== seq || !text) throw new Error("A real user message is required");
    if (!text || text.length > 4000) throw new Error("Use the request's Reply button for this answer");
    return text;
  }
  const sourceCommand = z.object({ id: z.string(), action: z.enum(["drop", "done", "reopen"]), version: z.string() });
  const marker = (command: CrewCommand) => `[crew-command:${command.id}]`;
  const historyKey = (threadId: string, userSeq: number) => `history:${threadId}:user:${userSeq}`;
  function mayWake(command: CrewCommand) {
    if (command.id.startsWith("transport-probe:")) return true;
    if (store.work().some(w => w.id === command.workId && w.origin === "crew")) return true;
    return store.cursors().some(c => c.userSeq > 0 && (command.id === historyKey(c.threadId, c.userSeq) || command.id.startsWith(`${historyKey(c.threadId, c.userSeq)}:retry:`))
      && (c.reconciledSeq < c.observedSeq || command.id.includes(":retry:manual:"))
      && store.requests().some(q => ["open", "answer_queued"].includes(q.state) && store.getWork(q.workId).owner === c.bot));
  }
  async function reconcile(id: string) {
    const command = store.commands().find(c => c.id === id);
    if (!command) throw new Error("Unknown command");
    if (command.kind === "source_update" && ["sending", "uncertain"].includes(command.state)) {
      const input = sourceCommand.parse(JSON.parse(command.text));
      const result = await bb.sdk.plugins.callRpc({ pluginId: NEEDS_PLUGIN, method: "needs_list", input: { states: ["open", "snoozed", "reminded", "done", "dropped"] }, outputSchema: needsListSchema });
      if (disposed) throw new Error("Crew reloaded");
      const state = result.items.find(item => item.id === input.id)?.state;
      const target = input.action === "drop" ? "dropped" : input.action === "done" ? "done" : "open";
      const reconciled = { ...command, state: state === target ? "received" as const : "uncertain" as const, receivedAt: state === target ? Date.now() : null };
      store.saveCommand(reconciled); return reconciled;
    }
    if (!command.recipient || !["sending", "uncertain"].includes(command.state)) return command;
    let after = command.baseline;
    for (let page = 0; page < 100; page++) {
      const rows = await bb.sdk.threads.events.list({ threadId: command.recipient, afterSeq: String(after), order: "asc", limit: "100", types: ["client/turn/requested"] });
      if (disposed) throw new Error("Crew reloaded");
      if (rows.some(row => JSON.stringify(row.data).includes(marker(command)))) {
        const received = { ...command, state: "received" as const, receivedAt: Date.now() };
        store.saveCommand(received); return received;
      }
      if (rows.length < 100) break;
      after = rows.at(-1)!.seq;
    }
    const uncertain = { ...command, state: "uncertain" as const };
    store.saveCommand(uncertain); return uncertain;
  }
  async function drain() {
    if (draining || disposed || store.control().paused) return;
    draining = true;
    try {
      // Upgrade queued routine/legacy wakes without discarding their requests or
      // touching a message whose delivery is already pinned or uncertain.
      for (const command of store.commands()) if (command.kind === "wake" && command.state === "queued" && !mayWake(command)) store.saveCommand({ ...command, state: "obsolete" });
      const queuedWakes = store.commands().filter(c => c.kind === "wake" && c.state === "queued");
      if (queuedWakes.length > 1) {
        const latest = queuedWakes.at(-1)!;
        store.saveCommand({ ...latest, text: `Several relevant updates arrived. Read crew_read and check every pending human-answer cursor and cited Crew-assigned report.\n${queuedWakes.map(c => c.text).join("\n").slice(-12000)}` });
      }
      for (const obsolete of queuedWakes.slice(0, -1)) store.saveCommand({ ...obsolete, state: "obsolete" });
      for (const original of store.commands()) {
        if (disposed || store.control().paused) break;
        if (["sending", "uncertain"].includes(original.state)) { await reconcile(original.id); continue; }
        // Shadow proposals never auto-promote when live mode is selected later.
        if (original.state !== "queued" || (original.kind !== "wake" && store.control().mode !== "live")) continue;
        if (original.kind === "source_update") {
          const input = sourceCommand.parse(JSON.parse(original.text));
          const source = store.sources().find(s => s.id === input.id);
          if (!source || sourceVersion(source) !== input.version) { store.saveCommand({ ...original, state: "obsolete" }); continue; }
          store.saveCommand({ ...original, state: "sending" });
          try {
            const result = await bb.sdk.plugins.callRpc({ pluginId: NEEDS_PLUGIN, method: "needs_update", input: { id: input.id, action: input.action }, outputSchema: needsResultSchema });
            if (!disposed) { store.ingest([result.item]); store.saveCommand({ ...original, state: "received", receivedAt: Date.now() }); }
          } catch { if (!disposed) await reconcile(original.id); }
          continue;
        }
        if (original.requestId) {
          const request = store.getRequest(original.requestId);
          if (request.state !== "answer_queued" || request.version !== original.requestVersion) {
            store.saveCommand({ ...original, state: "obsolete" }); continue;
          }
        }
        if (["assign", "followup"].includes(original.kind) && ["stopping", "canceled", "done"].includes(store.getWork(original.workId).stage)) { store.saveCommand({ ...original, state: "obsolete" }); continue; }
        const target = original.kind === "wake" ? bots.find(bot => bot.key === "crew") : bots.find(bot => bot.key === store.getWork(original.workId).owner);
        if (target?.rollover) continue;
        const recipient = original.kind === "wake" ? store.control().coordinator : target?.current;
        if (!recipient) continue;
        const latest = await bb.sdk.threads.events.list({ threadId: recipient, order: "desc", limit: "1", types: ["client/turn/requested"] });
        if (disposed) break;
        const command = { ...original, state: "sending" as const, recipient, baseline: latest[0]?.seq ?? 0 };
        store.saveCommand(command);
        try {
          await bb.sdk.threads.send({ threadId: recipient, mode: "steer-if-active", input: [{ type: "text", text: `${marker(command)}\nCrew ${command.kind}. Work: ${command.workId}${command.requestId ? `; request: ${command.requestId}; version: ${command.requestVersion}` : ""}\n${command.text}\n${command.kind === "wake" ? "Read crew_read. Review the cited user reply or report on work assigned through Crew. Describe only changes to those requests or that work. Do not relay unrelated bot findings or create questions from conversation prose. If an answer check changes nothing, finish with Nothing to do. This notification grants no new permission or specialist assignment. Honor the current control.mode." : "Read crew_read and report acceptance, questions, progress and completion with crew_report. Receipt is not completion."}`, mentions: [] }] });
          if (!disposed) store.saveCommand({ ...command, state: "received", receivedAt: Date.now() });
        } catch { if (!disposed) await reconcile(command.id); }
      }
    } catch (error) { warning = `Delivery needs review: ${String(error)}`; }
    finally { draining = false; }
  }
  async function setup(_baseThreadId: string, replace = false) {
    if (replace) throw new Error("Crew uses the registered bot lifecycle. Use bb saelmbot rollover now --bot crew instead.");
    await refresh();
    if (!bots.some(bot => bot.key === "crew")) throw new Error("Register Crew Bot with bb saelmbot bot register --bot crew first.");
    return store.control();
  }
  const toolSchemas: { name: string; description: string; parameters: unknown }[] = [];
  const callable = new Map<string, (input: unknown, context: PluginAgentToolContext) => Promise<PluginAgentToolResult>>();
  function registerTool<T extends z.ZodType>(definition: { name: string; description: string; parameters: T; execute: (input: z.infer<T>, context: PluginAgentToolContext) => Promise<string> }) {
    bb.agents.registerTool(definition);
    toolSchemas.push({ name: definition.name, description: definition.description, parameters: z.toJSONSchema(definition.parameters) });
    callable.set(definition.name, (input, context) => definition.execute(definition.parameters.parse(input), context));
  }
  registerTool({ name: "crew_read", description: "Read canonical Crew work, independent requests, versions, receipts and bot owners.", parameters: z.object({ includeHistory: z.boolean().default(false) }).strict(), async execute(input, ctx) {
    const owner = await role(ctx.threadId); const value = board();
    const owned = value.work.filter(w => owner === "manager" || w.owner === owner);
    const requests = value.requests.filter(q => owned.some(w => w.id === q.workId) && (input.includeHistory || ["open", "answer_queued"].includes(q.state)));
    const work = owned.filter(w => input.includeHistory || requests.some(q => q.workId === w.id) || !["unknown", "done", "canceled"].includes(w.stage));
    return JSON.stringify({ cursors: owner === "manager" ? store.cursors().filter(c => c.userSeq > 0) : [], control: value.control, bots: value.bots,
      locations: bots.filter(b => owner === "manager" || b.key === owner).map(b => ({ bot: b.key, current: b.current, hostId: b.hostId, projectId: b.projectId, projects: b.projects })),
      operatingContext: "Use the registered host and project for each owner. Shared signed-in browsing uses BB's desktop profile on salem-pc host_wc76jrwkq6; discover its current browser instance and verify this site's session. Check available browser and Android emulator/ADB tools on that host before asking Salem to test locally. Check host connectivity before diagnosing a provider outage. Read the relevant central handbook page at /home/salem/Documents/Coding/bb/bot-handbook on salem-pc when needed. This routing context is not permission for cross-bot work, sends, payments or device changes.",
      work, requests, sources: value.sources.filter(s => requests.some(q => q.sourceIds.includes(s.id))), commands: value.commands.filter(c => !["received", "obsolete"].includes(c.state) && (owner === "manager" || owned.some(w => w.id === c.workId))), events: value.events.filter(e => e.kind !== "source" && work.some(w => w.id === e.workId)).slice(0, 25) });
  } });
  registerTool({ name: "crew_assign", description: "Manager proposes work for one bot; a bot adopts its own direct-chat work without redispatch. Stable key/event ID required.", parameters: assignment, async execute(input, ctx) {
    const owner = await role(ctx.threadId);
    if (input.owner === "crew" || !bots.some(bot => bot.key === input.owner) || (owner !== "manager" && owner !== input.owner)) throw new Error("Wrong bot owner");
    assertRunning();
    if (owner === "manager" && !input.userSeq) throw new Error("Assignment needs the actual user event sequence");
    const threadId = input.userThreadId ?? ctx.threadId;
    const lineage = bots.find(b => b.current === ctx.threadId);
    if (threadId !== ctx.threadId && !lineage?.coordinatorIds?.includes(threadId)) throw new Error("Authorization must belong to your own bot conversation");
    const authorization = input.userSeq ? { threadId, userSeq: input.userSeq, text: await userText(threadId, input.userSeq) } : undefined;
    const result = store.assign({ ...input, authorization, origin: owner === "manager" ? "crew" : "direct", actor: ctx.threadId }); void drain(); return JSON.stringify(result);
  } });
  registerTool({ name: "crew_report", description: "Owning bot reports lifecycle, independent questions, exact answer acknowledgment or withdrawal. Requires current work revision and request version.", parameters: reportSchema, async execute(input, ctx) {
    const owner = await role(ctx.threadId);
    if (owner === "manager") throw new Error("Only the specialist can acknowledge its work");
    const work = store.getWork(input.workId);
    if (work.owner !== owner) throw new Error("Only the owning bot can report this work");
    const lineage = bots.find(b => b.key === owner)!;
    const coordinators = new Set([lineage.current, ...(lineage.coordinatorIds ?? [])]);
    for (const threadId of [...new Set([...(input.workerIds ?? []), ...(input.kind === "completed" || input.kind === "cancel_ack" ? work.workerIds ?? [] : [])])]) {
      const worker = await bb.sdk.threads.get({ threadId });
      if (!coordinators.has(worker.parentThreadId ?? "") && !coordinators.has(worker.lifecycleOwnerThreadId ?? "")) throw new Error("Worker does not belong to this bot");
      if ((input.kind === "completed" || input.kind === "cancel_ack") && (["starting", "active", "stopping"].includes(worker.status) || worker.queuedMessageCount > 0 || worker.activeBackgroundAgentCount > 0)) throw new Error("Tracked worker is still running or queued");
      if ((input.kind === "completed" || input.kind === "cancel_ack") && (await bb.sdk.threads.interactions.list({ threadId })).length) throw new Error("Tracked worker still needs input");
    }
    if (input.kind === "direct_answer") {
      if (!input.userSeq) throw new Error("Direct answer needs a real user event sequence");
      const threadId = input.userThreadId ?? ctx.threadId;
      if (!coordinators.has(threadId)) throw new Error("Answer evidence must belong to your own bot conversation");
      input = { ...input, text: await userText(threadId, input.userSeq) };
    }
    const result = store.report(input, owner); void drain(); return JSON.stringify(result);
  } });
  registerTool({ name: "crew_history", description: "Read user messages and bot replies with exact event sequences. Defaults to newest; use nextBeforeSeq to read older context. Tool output and worker chatter are omitted.", parameters: z.object({ threadId: z.string(), afterSeq: z.number().int().min(0).optional(), beforeSeq: z.number().int().min(1).optional() }).strict(), async execute(input, ctx) {
    const owner = await role(ctx.threadId);
    const allowed = owner === "manager" ? bots.some(bot => bot.current === input.threadId || bot.coordinatorIds?.includes(input.threadId)) || store.sources().some(s => s.source.threadId === input.threadId)
      : bots.some(bot => bot.key === owner && (bot.current === input.threadId || bot.coordinatorIds?.includes(input.threadId)));
    if (input.threadId !== ctx.threadId && !allowed) throw new Error("Thread is not an owned Crew source");
    const messages: { seq: number; at: number; role: string; text: string }[] = [];
    const asc = input.afterSeq !== undefined;
    let after = input.afterSeq; let before = input.beforeSeq; let exhausted = false;
    for (let page = 0; page < 15 && messages.length < 25; page++) {
      const rows = await bb.sdk.threads.events.list({ threadId: input.threadId, afterSeq: after === undefined ? undefined : String(after), beforeSeq: before === undefined ? undefined : String(before), order: asc ? "asc" : "desc", limit: "100", types: ["client/turn/requested", "item/completed"] });
      for (const row of rows) {
        const d = row.data as { initiator?: string; senderThreadId?: string; systemMessageKind?: string; input?: { text?: string }[]; parentToolCallId?: string; item?: { type?: string; text?: string; parentToolCallId?: string } };
        const text = row.type === "client/turn/requested" ? d.input?.map(i => i.text ?? "").join("\n") : d.item?.text;
        const user = humanMessage(row) !== null;
        const reply = row.type === "item/completed" && d.item?.type === "agentMessage" && !d.parentToolCallId && !d.item.parentToolCallId;
        if (text && (user || reply)) messages.push({ seq: row.seq, at: row.createdAt, role: user ? "user" : "bot", text: text.slice(0, 5000) });
      }
      if (rows.length < 100) { exhausted = true; break; }
      if (asc) after = rows.at(-1)!.seq; else before = rows.at(-1)!.seq;
    }
    return JSON.stringify({ messages, nextBeforeSeq: !asc && !exhausted ? before : null, nextAfterSeq: asc && !exhausted ? after : null });
  } });
  registerTool({ name: "crew_organize", description: "Group source cards into work and independent requests. Closures require exact user and later bot event references. If that bot explicitly leaves a distinct task pending, remaining creates its own request with clear text; never keep the answered old question open as its placeholder. Never close from age or summary alone.", parameters: organizeSchema, async execute(input, ctx) {
    await manager(ctx.threadId); await refresh();
    if (input.state !== "open") {
      if (!input.evidenceThread || input.userSeq === undefined || input.botSeq === undefined || input.botSeq <= input.userSeq) throw new Error("Closure requires a user event and later bot acknowledgment");
      const sources = input.sourceIds.map(id => store.sources().find(s => s.id === id));
      if (!sources.every(s => s?.source.threadId === input.evidenceThread)) throw new Error("Evidence must belong to each source thread");
      const [users, replies] = await Promise.all([
        bb.sdk.threads.events.list({ threadId: input.evidenceThread, afterSeq: String(input.userSeq - 1), order: "asc", limit: "1" }),
        bb.sdk.threads.events.list({ threadId: input.evidenceThread, afterSeq: String(input.botSeq - 1), order: "asc", limit: "1" }),
      ]);
      const user = users[0]; const bot = replies[0];
      const botData = bot?.data as { parentToolCallId?: string; item?: { type?: string; parentToolCallId?: string } } | undefined;
      if (user?.seq !== input.userSeq || bot?.seq !== input.botSeq || !humanMessage(user) || bot?.type !== "item/completed" || botData?.item?.type !== "agentMessage" || botData.parentToolCallId || botData.item.parentToolCallId) throw new Error("Evidence events do not establish a user reply and bot acknowledgment");
      if (sources.some(s => s && Date.parse(s.createdAt) > user.createdAt)) throw new Error("That answer predates this request occurrence");
    }
    assertRunning();
    const workId = store.organize(input, ctx.threadId); void drain(); return JSON.stringify({ workId });
  } });
  registerTool({ name: "crew_answer", description: "Bind Salem's exact chat reply to one request. Requires the real user event sequence from this coordinator's conversation.", parameters: z.object({ commandId: z.string().min(1), requestId: z.string(), expectedVersion: z.number().int(), userSeq: z.number().int().min(1) }).strict(), async execute(input, ctx) {
    await manager(ctx.threadId); assertRunning();
    await refresh();
    const text = await userText(ctx.threadId, input.userSeq);
    store.userRequest({ ...input, action: "answer", text }); void drain(); return JSON.stringify(store.getRequest(input.requestId));
  } });
  registerTool({ name: "crew_followup", description: "Forward an authorized follow-up to the existing owner without creating duplicate work. Requires current revision and an actual user message.", parameters: z.object({ eventId: z.string().min(1), workId: z.string(), expectedRevision: z.number().int(), userSeq: z.number().int().min(1) }).strict(), async execute(input, ctx) {
    await manager(ctx.threadId); assertRunning();
    const text = await userText(ctx.threadId, input.userSeq);
    store.followup({ ...input, text, actor: ctx.threadId }); void drain(); return JSON.stringify(store.getWork(input.workId));
  } });
  registerTool({ name: "crew_request_action", description: "Apply Salem's explicit Later, Dismiss or Reopen instruction to one request. Requires its version and an actual user event.", parameters: z.object({ commandId: z.string().min(1), requestId: z.string(), expectedVersion: z.number().int(), action: z.enum(["later", "dismiss", "reopen"]), userSeq: z.number().int().min(1) }).strict(), async execute(input, ctx) {
    await manager(ctx.threadId); assertRunning(); await userText(ctx.threadId, input.userSeq); await refresh();
    store.userRequest(input); void drain(); return JSON.stringify(store.getRequest(input.requestId));
  } });
  registerTool({ name: "crew_cancel", description: "Forward Salem's stop request to the owner. Work remains stopping until the owning bot confirms it stopped.", parameters: z.object({ commandId: z.string().min(1), workId: z.string(), expectedRevision: z.number().int(), userSeq: z.number().int().min(1) }).strict(), async execute(input, ctx) {
    await manager(ctx.threadId); assertRunning(); await userText(ctx.threadId, input.userSeq);
    store.cancel(input); void drain(); return JSON.stringify(store.getWork(input.workId));
  } });
  registerTool({ name: "crew_reconciled", description: "Record that a bot's requests were checked through the observed event cursor, after evidence-backed updates or confirming they remain unanswered.", parameters: z.object({ bot: z.string(), threadId: z.string(), throughSeq: z.number().int().min(1) }).strict(), async execute(input, ctx) { await manager(ctx.threadId); store.acknowledgeCursor(input.bot, input.threadId, input.throughSeq); return "History review recorded"; } });
  bb.agents.configure(ctx => {
    const isManager = store.control().coordinator === ctx.thread.id || (bots.some(bot => bot.key === "crew" && bot.projectId === ctx.project.id) && ctx.thread.parentThreadId === null);
    const isBot = bots.some(bot => bot.current === ctx.thread.id);
    return { tools: isManager ? ["crew_read", "crew_assign", "crew_history", "crew_organize", "crew_answer", "crew_followup", "crew_request_action", "crew_cancel", "crew_reconciled"] : isBot ? ["crew_read", "crew_assign", "crew_report", "crew_history"] : [], skills: [],
      instructions: isManager ? managerInstructions : isBot ? "Crew tracks durable work and individual requests. Read crew_read before acting; it includes owner locations and browser routing context. Adopt direct user work once with crew_assign, using the actual userSeq from crew_history (userThreadId may be your registered predecessor). Objective and original authorization persist across rollover. Continue within that scope without re-asking; these records grant no broader permissions. Existing automated activity may be recorded without a userSeq for observation only, never as new authorization. Publish actual questions explicitly with crew_report(kind=question); prose is not extracted into cards. Same occurrence keeps its key; a new question uses a new key. Track every task worker with workerIds in progress reports; IDs persist. Completion requires checks.delivery, checks.verification and checks.cleanup, each with status passed or not_applicable and concrete evidence. Failed or missing checks, active tracked workers and unresolved asks prevent completion. Include real browser/emulator testing and cleanup when the task requires them; a code change or posted report alone is not enough. Report direct_answer with exact userSeq and request ID/version when Salem answers in your chat; no redispatch. If native tools are absent, discover bb crew tools --json and use bb crew tool --name <tool> --input <JSON>." : undefined };
  });
  const handlers = {
    crew_automation_question: async (i: z.infer<typeof crewContract.crew_automation_question.input>, ctx: ExperimentalPluginRpcHandlerContext) => {
      if (ctx.experimental_caller.kind !== "plugin" || ctx.experimental_caller.pluginId !== NEEDS_PLUGIN) throw new Error("Only the registered automation owner plugin can record this question");
      await refresh();
      const bot = bots.find(b => b.key === i.owner && b.key !== "crew");
      if (!bot || (bot.current !== i.sourceThreadId && !bot.coordinatorIds?.includes(i.sourceThreadId))) throw new Error("Question source must belong to the registered owner");
      // Pausing dispatch must not discard incoming questions or their receipt.
      const receipt = store.automationQuestion(i); void drain(); return receipt;
    },
    crew_board: async () => board(), crew_refresh: refresh,
    crew_setup: async (i: z.infer<typeof crewContract.crew_setup.input>) => setup(i.baseThreadId, i.replace),
    crew_control: async (i: z.infer<typeof crewContract.crew_control.input>) => {
      const result = store.setControl(i); void drain(); return result;
    },
    crew_user_request: async (i: z.infer<typeof crewContract.crew_user_request.input>) => { await refresh(); store.userRequest(i); void drain(); return board(); },
    crew_user_cancel: async (i: z.infer<typeof crewContract.crew_user_cancel.input>) => { store.cancel(i); void drain(); return board(); },
    crew_proposal: async (i: z.infer<typeof crewContract.crew_proposal.input>) => { await refresh(); store.proposal(i); void drain(); return board(); },
    crew_review: async (i: z.infer<typeof crewContract.crew_review.input>) => { store.review(i.eventId, i.verdict); return board(); },
    crew_reconcile: async (i: z.infer<typeof crewContract.crew_reconcile.input>) => reconcile(i.commandId),
  };
  bb.cli.register(defineCli({ name: "crew", summary: "Crew coordinator and persistent work board", commands: {
    tools: cliCommand({ summary: "Discover Crew tool schemas", options: { json: { type: "boolean", description: "JSON" } }, async run() { return { exitCode: 0, stdout: JSON.stringify(toolSchemas) }; } }),
    tool: cliCommand({ summary: "Use a Crew tool from an existing bot session", options: { name: { type: "string", required: true, description: "Crew tool name" }, input: { type: "string", required: true, description: "JSON arguments" }, json: { type: "boolean", description: "JSON" } }, async run(i, ctx) {
      if (!ctx.threadId || !ctx.projectId) throw new Error("Run this command within the owning bot or Crew thread");
      const tool = callable.get(i.options.name); if (!tool) throw new Error("Unknown Crew tool");
      return { exitCode: 0, stdout: String(await tool(JSON.parse(i.options.input), { threadId: ctx.threadId, projectId: ctx.projectId, signal: ctx.signal ?? new AbortController().signal })) };
    } }),
    "sync-closed": cliCommand({ summary: "Sync evidence-backed historical closures to the original source cards", options: { json: { type: "boolean", description: "JSON" } }, async run() { await refresh(); store.syncClosedSources(); await drain(); return { exitCode: 0, stdout: JSON.stringify({ commands: store.commands().filter(c => c.kind === "source_update") }) }; } }),
    reconcile: cliCommand({ summary: "Ask Crew to review actual human replies against open requests", options: { json: { type: "boolean", description: "JSON" } }, async run() { const before = new Set(store.commands().map(c => c.id)); await refresh(); await scanAnswers(true); return { exitCode: 0, stdout: JSON.stringify({ queued: store.commands().some(c => c.kind === "wake" && !before.has(c.id)), coordinator: store.control().coordinator, warning: board().warning }) }; } }),
    probe: cliCommand({ summary: "Test durable delivery to Crew itself without messaging specialist bots", options: { json: { type: "boolean", description: "JSON" } }, async run() {
      const c = store.control(); if (!c.coordinator || c.paused || c.mode !== "live") throw new Error("Crew must be live, initialized and resumed");
      const id = `transport-probe:${randomUUID()}`;
      store.saveCommand({ id, workId: "crew-service", requestId: null, requestVersion: null, kind: "wake", state: "queued", text: "Integration transport probe. Acknowledge that this message arrived. No specialist work, assignments or source changes are requested.", recipient: null, baseline: 0, createdAt: Date.now(), receivedAt: null });
      await drain(); return { exitCode: 0, stdout: JSON.stringify(store.commands().find(command => command.id === id)) };
    } }),
    control: cliCommand({ summary: "Set Crew dispatch mode and pause state", options: { mode: { type: "enum", values: ["live", "shadow"] as const, description: "Dispatch mode" }, paused: { type: "enum", values: ["yes", "no"] as const, description: "Pause automatic delivery" }, json: { type: "boolean", description: "JSON" } }, async run(i) { return { exitCode: 0, stdout: JSON.stringify(await handlers.crew_control({ ...(i.options.mode ? { mode: i.options.mode } : {}), ...(i.options.paused ? { paused: i.options.paused === "yes" } : {}) })) }; } }),
    "import-reviewed": cliCommand({ summary: "Preview or apply the reviewed October 8 historical cleanup", options: { manifest: { type: "string", required: true, description: "Reviewed JSON manifest content, not a file path" }, apply: { type: "boolean", description: "Apply exact-version matches" }, json: { type: "boolean", description: "JSON" } }, async run(i) { await refresh(); return { exitCode: 0, stdout: JSON.stringify(migrateReviewedHistory(store, JSON.parse(i.options.manifest), i.options.apply === true)) }; } }),
    status: cliCommand({ summary: "Read Crew board", options: { json: { type: "boolean", description: "JSON" } }, async run() { return { exitCode: 0, stdout: JSON.stringify(await refresh()) }; } }),
    setup: cliCommand({ summary: "Attach the workspace to the registered Crew Bot", options: { thread: { type: "string", description: "Base thread ID" }, replace: { type: "boolean", description: "Use the registered bot rollover command instead" }, json: { type: "boolean", description: "JSON" } }, async run(i, ctx) {
      const thread = i.options.thread ?? ctx.threadId; if (!thread) throw new Error("Pass --thread <id>");
      return { exitCode: 0, stdout: JSON.stringify(await setup(thread, i.options.replace)) };
    } }),
  } }));
  type HistoryEvent = { seq: number; createdAt: number; type: string; data: unknown };
  async function latestMessage(threadId: string, type: "client/turn/requested" | "item/completed", afterSeq: number, since: number, read: (event: HistoryEvent) => string | null) {
    let before: number | undefined;
    for (let page = 0; page < 100; page++) {
      const rows = await bb.sdk.threads.events.list({ threadId, afterSeq: String(afterSeq), beforeSeq: before === undefined ? undefined : String(before), order: "desc", limit: "100", types: [type] });
      if (disposed) return null;
      for (const row of rows) {
        if (row.createdAt < since) return null;
        if (read(row)) return row;
      }
      if (rows.length < 100) return null;
      before = rows.at(-1)!.seq;
    }
    throw new Error("Answer history exceeds the bounded scan; explicit review is needed");
  }
  async function observeBot(threadId: string, drainNow = true, manual = false) {
    await refresh();
    const bot = bots.find(bot => bot.key !== "crew" && (bot.current === threadId || bot.coordinatorIds?.includes(threadId)));
    if (!bot) return;
    const requests = store.requests().filter(q => ["open", "answer_queued"].includes(q.state) && store.getWork(q.workId).owner === bot.key);
    if (!requests.length) return;
    const thread = await bb.sdk.threads.get({ threadId });
    if (["starting", "active", "stopping"].includes(thread.status) || thread.queuedMessageCount > 0 || thread.activeBackgroundAgentCount > 0) return;
    const cursor = store.cursors().find(c => c.bot === bot.key && c.threadId === threadId);
    const since = Math.min(...requests.map(q => {
      const sourceDates = store.sources().filter(s => q.sourceIds.includes(s.id)).map(s => Date.parse(s.createdAt)).filter(Number.isFinite);
      return sourceDates.length ? Math.min(...sourceDates) : store.getWork(q.workId).createdAt;
    }));
    // User-shaped automation/child notices are not human answers. Query requests
    // separately from tool output so a long tool run cannot hide the actual user.
    const user = await latestMessage(threadId, "client/turn/requested", manual ? 0 : cursor?.reconciledSeq ?? 0, since, humanMessage);
    if (!user || disposed) { if (!disposed) store.checkCursor(bot.key, threadId, thread.latestAttentionAt ?? Date.now()); return; }
    const id = historyKey(threadId, user.seq);
    const attempts = store.commands().filter(c => c.id === id || c.id.startsWith(`${id}:retry:`));
    const previous = attempts.at(-1);
    if (!manual && attempts.length >= 3) return;
    if (!manual && previous && (previous.state === "queued" || ["sending", "uncertain"].includes(previous.state) || Date.now() - previous.createdAt < 300000)) return;
    const reply = await latestMessage(threadId, "item/completed", user.seq, user.createdAt, assistantMessage);
    if (!reply || disposed) return;
    const current = store.cursors().find(c => c.bot === bot.key && c.threadId === threadId);
    if (!manual && current && (current.userSeq > user.seq || current.reconciledSeq >= reply.seq)) return;
    store.observeCursor(bot.key, threadId, reply.seq, thread.latestAttentionAt ?? reply.createdAt, user.seq);
    const commandId = manual ? `${id}:retry:manual:${randomUUID()}` : attempts.length ? `${id}:retry:${attempts.length}` : id;
    if (!store.commands().some(c => c.id === commandId)) store.saveCommand({ id: commandId, workId: "crew-service", requestId: null, requestVersion: null, kind: "wake", state: "queued", text: `Salem replied in ${bot.name} (${threadId}), user event ${user.seq}, followed by bot reply ${reply.seq}. Check only whether that user reply answers an existing request, using crew_history and exact event evidence. Preserve distinct unanswered questions and reminders. Record the reviewed cursor with crew_reconciled. Do not copy unrelated bot findings or dispatch new work.`, recipient: null, baseline: 0, createdAt: Date.now(), receivedAt: null });
    if (drainNow) await drain();
  }
  async function scanAnswers(manual = false) {
    const failures: string[] = [];
    for (const bot of [...bots].filter(b => b.key !== "crew")) for (const threadId of new Set([bot.current, ...(bot.coordinatorIds ?? [])])) {
      if (disposed) return;
      try { await observeBot(threadId, false, manual); }
      catch (error) { failures.push(`${bot.name} (${threadId}): ${String(error)}`); }
    }
    await drain();
    // One missing/offline predecessor must not prevent other answers catching up.
    if (failures.length) warning = `Answer checks deferred: ${failures.join("; ").slice(0, 1500)}`;
  }
  let catchingUp = false;
  async function catchUp() {
    if (catchingUp || disposed) return; catchingUp = true;
    try { await refresh(); await scanAnswers(); }
    finally { catchingUp = false; }
  }
  bb.events.on("thread.idle", ({ thread }) => {
    if (bots.some(bot => bot.key !== "crew" && (bot.current === thread.id || bot.coordinatorIds?.includes(thread.id)))) void observeBot(thread.id).catch(error => { warning = `History reconciliation deferred: ${String(error)}`; });
    else if (bots.some(bot => bot.key === "crew" && bot.projectId === thread.projectId)) void refresh().then(drain).catch(() => {});
  });
  bb.events.on("thread.archived", ({ thread }) => {
    if (thread.id === store.control().coordinator) void refresh().then(drain).catch(() => {});
  });
  const timer = setInterval(() => { void catchUp().catch(error => { warning = `History catch-up deferred: ${String(error)}`; }); }, 30000);
  void catchUp().catch(() => {});
  bb.onDispose(() => { disposed = true; clearInterval(timer); });
  return handlers;
}
