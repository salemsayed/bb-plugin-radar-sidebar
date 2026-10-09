import { z } from "zod";
export const migrationSchema = z.object({ source: z.string().min(1), items: z.array(needsItemSchema.extend({ assignment: z.string(), issueKey: z.string(), evidence: z.string(), proposedLane: z.enum(["needs_you", "reminders", "later", "history"]) })) });
import { needsItemSchema } from "./needs";
import { sourceVersion } from "./crewPilotStore";
import type { CrewStore } from "./crewStore";
/** Reviewed historical facts, never a runtime age heuristic. Exact source CAS makes this safe to rerun. */
export function migrateReviewedHistory(store: CrewStore, manifest: unknown, apply: boolean) {
  const reviewed = migrationSchema.parse(manifest);
  const eligible = reviewed.items.filter(item => {
    const current = store.sources().find(s => s.id === item.id);
    return current && sourceVersion(current) === sourceVersion(needsItemSchema.parse(item));
  });
  const groups = new Map<string, typeof eligible>();
  for (const item of eligible) {
    const key = `${item.bot}:${item.assignment}:${item.issueKey}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const changes = [...groups.values()].map(items => ({
    eventId: `reviewed-import:${items.map(i => i.id).sort().join(":")}`,
    sourceIds: items.map(i => i.id), sourceVersions: Object.fromEntries(items.map(i => [i.id, sourceVersion(needsItemSchema.parse(i))])),
    workKey: items[0]!.assignment, title: items[0]!.assignment.replaceAll("-", " "), requestKey: items[0]!.issueKey,
    state: items[0]!.proposedLane === "history" ? "withdrawn" as const : "open" as const,
    placement: items[0]!.proposedLane === "history" ? "later" as const : items[0]!.proposedLane as "needs_you" | "reminders" | "later",
    evidence: `${reviewed.source}: ${[...new Set(items.map(i => i.evidence))].join(" ")}`,
  }));
  // Keep input event identities bounded while retaining a stable identity for the full group.
  for (const change of changes) {
    change.eventId = `reviewed-import:${change.sourceIds[0]}:${change.sourceIds.length}`;
    if (apply) store.organize(change, "reviewed-history", true);
  }
  return { applied: apply, eligibleSources: eligible.length, skippedSources: reviewed.items.filter(i => !eligible.includes(i)).map(i => i.id), groups: changes.length };
}
