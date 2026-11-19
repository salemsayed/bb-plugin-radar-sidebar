import { useRef, type CSSProperties } from "react";
import { CREW_BOX, crewBody, crewEyeLine, crewHands, crewHasPupils, crewPaper, crewPupils, crewShape, crewShoulder, type CrewDetail, type CrewHands, type CrewLook, type CrewTab } from "./crew/art";
import { useCrewMotion } from "./crew/motion";

export type StagePose = "idle" | "working" | "asking" | "unread" | "waiting" | "checking" | "blocked" | "offline" | "done";

interface PoseParts { look: CrewLook; tab?: CrewTab; hands?: CrewHands; laptop?: boolean }

const POSES: Record<StagePose, PoseParts> = {
  idle: { look: "idle" },
  working: { look: "working", laptop: true },
  asking: { look: "asking", hands: "raised", tab: "question" },
  unread: { look: "idle", tab: "letter" },
  waiting: { look: "waiting", tab: "clock" },
  checking: { look: "checking", tab: "lens" },
  blocked: { look: "stuck", tab: "alert" },
  offline: { look: "asleep", tab: "sleep" },
  done: { look: "done", hands: "cheer", tab: "confetti" },
};

const ROW_OWNED_TABS: ReadonlySet<CrewTab> = new Set(["question", "letter"]);
const FIGURE_FROM_PX = 40;
const VIEW_BOX = `0 0 ${CREW_BOX.width} ${CREW_BOX.height}`;

export function StageFace({ botKey, pose, size = 88, bare = false }: { botKey: string; name: string; pose: StagePose; size?: number; bare?: boolean }) {
  const root = useRef<HTMLSpanElement>(null);
  const shape = crewShape(botKey);
  const parts = POSES[pose];
  const detail: CrewDetail = size < FIGURE_FROM_PX ? "face" : "figure";
  const paper = crewPaper(botKey, parts.look === "asleep");
  const tab = bare && parts.tab && ROW_OWNED_TABS.has(parts.tab) ? undefined : parts.tab;
  useCrewMotion(root, { loop: pose === "working" ? "typing" : null, pose });
  return (
    <span ref={root} className="stage-face crew" data-pose={pose} data-mascot={shape} style={{ "--crew-size": `${size}px`, "--crew-eye": crewEyeLine(shape) } as CSSProperties} aria-hidden="true">
      <svg className="crew-body" viewBox={VIEW_BOX} focusable="false">
        {crewBody(shape, parts.look, detail, paper, { laptop: parts.laptop, tab })}
      </svg>
      {crewHasPupils(parts.look) ? <svg className="crew-pupils" viewBox={VIEW_BOX} focusable="false">{crewPupils(shape, parts.look, detail)}</svg> : null}
      {parts.hands ? <svg className="crew-hands" viewBox={VIEW_BOX} focusable="false" style={{ transformOrigin: crewShoulder(shape) }}>{crewHands(shape, parts.hands, paper)}</svg> : null}
    </span>
  );
}
