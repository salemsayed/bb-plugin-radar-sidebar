import { useState } from "react";
import { experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { z } from "zod";

const contract = {
  bot_desk_history: {
    input: z.object({ bot: z.string() }),
    output: z.object({ threads: z.array(z.object({
      threadId: z.string(), title: z.string(), archived: z.boolean(), updatedAt: z.number(),
    })) }),
  },
};

const date = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

function HistoryRows({ bot, onOpen }: { bot: string; onOpen: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const { data, error, refetch } = experimental_useRpcQuery({
    pluginId: "orchestrator-mode", method: "bot_desk_history", contract, input: { bot },
  });
  const words = query.trim().toLocaleLowerCase().split(/\s+/);
  const matches = data?.threads.filter(row => words.every(word => row.title.toLocaleLowerCase().includes(word)));
  return <>
    <input type="search" aria-label="Search desk threads" placeholder="Search desk threads" value={query} onChange={event => setQuery(event.target.value)} />
    {error && <p role="status">Couldn’t load desk threads. <button type="button" onClick={() => void refetch()}>Try again</button></p>}
    {!data && !error && <p role="status">Loading desk threads…</p>}
    {matches?.length === 0 && <p role="status">{query.trim() ? "No matching desk threads." : "No desk threads yet."}</p>}
    {matches?.map(row => <button type="button" className="radar-desk-row" key={row.threadId} onClick={() => onOpen(row.threadId)}>
      <span className="radar-desk-copy"><b dir="auto">{row.title}</b><small>{date.format(row.updatedAt)}{row.archived ? " · Archived" : ""}</small></span>
    </button>)}
  </>;
}

export function DeskHistory({ bot, onOpen }: { bot: string; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return <details className="desk-history radar-desks-done" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>All desk threads</summary>
    {open && <HistoryRows key={bot} bot={bot} onOpen={onOpen} />}
  </details>;
}
