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
  it("scale to their box, and give every crew member its own silhouette and prop", () => {
    expect(face()).toContain('width="100%"');
    const crew = ["personal", "home", "bricks", "work", "erbareeq", "lab"].map(key => renderToStaticMarkup(<BotFace botKey={key} name={key} />));
    expect(new Set(crew).size).toBe(6);
    // Bricks wears a hard hat; Lab's face floats in its liquid.
    expect(face()).toContain("hsl(46 96% 56%)");
    expect(crew[5]).toContain("hsl(330 45% 95%)");
  });
  it("keep their gradient and clip ids apart, so two faces on one page never share a fill", () => {
    const html = renderToStaticMarkup(<><BotFace botKey="home" name="Home" /><BotFace botKey="home" name="Home" /></>);
    const ids = [...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    for (const id of ids) expect(id).toMatch(/^bot-(fill|clip)-[a-zA-Z0-9_-]+$/);
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

it("uses an alert badge for saved updates, never a chat unread dot", () => {
  const saved = renderToStaticMarkup(<BotAvatar botKey="bricks" name="Bricks" state="updates" updates={1} />);
  expect(saved).toContain("radar-bot-badge-warning");
  expect(saved).not.toContain("radar-bot-unread-dot");
  const working = renderToStaticMarkup(<BotAvatar botKey="bricks" name="Bricks" state="working" updates={1} />);
  expect(working).toContain("radar-bot-state-ring-working");
  expect(working).toContain("radar-bot-badge-warning");
  const read = renderToStaticMarkup(<BotAvatar botKey="bricks" name="Bricks" state="idle" />);
  expect(read).not.toContain("radar-bot-badge-warning");
  expect(read).not.toContain("radar-bot-unread-dot");
});
