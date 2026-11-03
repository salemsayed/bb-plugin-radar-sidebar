import { UrlLink } from "@get-bb/plugin-sdk/app";
import type { UnseenBoundary } from "./unseenBoundary";
import "./backToLeftOff.css";

export function BackToLeftOff({ threadId, boundary, rect }: { threadId: string; boundary: UnseenBoundary; rect?: { x: number; y: number; width: number } }) {
  return <div className="radar-return-place" style={rect ? { left: rect.x + rect.width / 2, top: rect.y + 56 } : undefined}>
    <UrlLink href={`/threads/${encodeURIComponent(threadId)}#msg=${boundary.firstSeq}`} className="radar-return-button">
      <span aria-hidden="true">↑</span><span>Back to where I left off</span><span className="radar-return-count">{boundary.count} new</span>
    </UrlLink>
  </div>;
}
