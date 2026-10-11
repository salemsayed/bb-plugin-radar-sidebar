import { toast } from "sonner";

/** One line per outcome so a partly-failed bulk action never reads as success. */
export function reportBulk(
  results: readonly PromiseSettledResult<unknown>[],
  success: (count: number) => string,
  failure: (count: number) => string,
): void {
  const failed = results.filter((result) => result.status === "rejected").length;
  const succeeded = results.length - failed;
  if (failed > 0) toast.error(failure(failed));
  if (succeeded > 0) toast.success(success(succeeded));
}

export const nThreads = (count: number) => `${count} thread${count === 1 ? "" : "s"}`;

export const problem = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);
