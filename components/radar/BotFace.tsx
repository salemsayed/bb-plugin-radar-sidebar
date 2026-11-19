import { crewBody, crewCrop, crewPaper, crewPupils, crewShape, type CrewDetail, type CrewLook } from "./crew/art";
import type { BotState } from "./bots";

const GLYPH_BELOW_PX = 22;

function lookFor(state: BotState | undefined): CrewLook {
  if (state === "failed") return "stuck";
  if (state === "working" || state === "rollover") return "working";
  if (state === "needs-you" || state === "decision") return "asking";
  if (state === "unavailable") return "asleep";
  return "idle";
}

export function BotFace({ botKey, state, size = 24 }: { botKey: string; name: string; state?: BotState; size?: number | string }) {
  const shape = crewShape(botKey);
  const look = lookFor(state);
  const detail: CrewDetail = typeof size === "number" && size < GLYPH_BELOW_PX ? "glyph" : "face";
  const paper = crewPaper(botKey, look === "asleep");
  return (
    <svg className="bot-mascot" data-mascot={shape} data-look={look} width={size} height={size} viewBox={crewCrop(shape)} aria-hidden="true" focusable="false">
      {crewBody(shape, look, detail, paper)}
      {crewPupils(shape, look, detail)}
    </svg>
  );
}
