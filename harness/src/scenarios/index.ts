import { asks } from "./asks";
import { crew } from "./crew";
import { crowded } from "./crowded";
import { desks } from "./desks";
import { quiet } from "./quiet";
import { text } from "./text";
import type { Scenario } from "./types";
import { work } from "./work";

export const SCENARIOS: Scenario[] = [...quiet, ...asks, ...work, ...desks, ...crowded, ...text, ...crew];
export type { Scenario };
