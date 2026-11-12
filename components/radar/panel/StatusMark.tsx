import type { Mark } from "./status";

export function StatusMark({ mark }: { mark: Mark }) {
  return <i className="panel-mark" data-mark={mark} aria-hidden="true" />;
}
