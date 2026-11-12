import { asks } from "./asks";
import { crowded } from "./crowded";
import { desks } from "./desks";
import { quiet } from "./quiet";
import { text } from "./text";
import type { Scenario } from "./types";
import { work } from "./work";

export const SCENARIOS: Scenario[] = [...quiet, ...asks, ...work, ...desks, ...crowded, ...text];
export type { Scenario };
