import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BotAvatar } from "./BotAvatar";
import { BotFace } from "./BotFace";
import type { BotState } from "./bots";

const face = (state?: BotState) => renderToStaticMarkup(<BotFace botKey="bricks" name="Bricks Bot" state={state} size="100%" />);

describe("bot faces", () => {
  it("give each kind of state its own expression", () => {
    const expressions = (["idle", "working", "needs-you", "failed", "unavailable"] as const).map(face);
    expect(new Set(expressions).size).toBe(5);
    // Busy states share one expression; asking states share another.
    expect(face("rollover")).toBe(face("working"));
    expect(face("decision")).toBe(face("needs-you"));
  });
  it("keep marks out of the face area and scale to their box", () => {
    expect(face()).not.toContain('fill="#fff"');
    expect(face()).toContain('width="100%"');
  });
  it("frame the face with the state ring and a corner badge in the avatar", () => {
    const html = renderToStaticMarkup(<BotAvatar botKey="home" name="Home Bot" state="decision" />);
    expect(html).toContain("radar-bot-badge-warning");
    expect(html).toContain('width="100%"');
    expect(renderToStaticMarkup(<BotAvatar botKey="home" name="Home Bot" state="working" />)).toContain("radar-bot-state-ring-working");
  });
  it("spin an HTML wrapper so the ring keeps turning while the page is busy", () => {
    const html = renderToStaticMarkup(<BotAvatar botKey="bricks" name="Bricks Bot" state="working" />);
    expect(html).toMatch(/<span class="radar-bot-state-spin radar-bot-state-spin-working radar-bot-state-motion"><svg class="radar-bot-state-ring radar-bot-state-ring-working"/);
  });
});
