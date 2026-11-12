import type { Sketch } from "../build";

export interface Scenario {
  id: string;
  title: string;
  look: string;
  sketch: Sketch;
}
