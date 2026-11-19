import { guarded } from "../guard.mjs";
import { verdict } from "./overview/verdict.mjs";
import { blocksAndPeriod } from "./overview/blocks-and-period.mjs";
import { comparison } from "./overview/comparison.mjs";
import { liveShortcut } from "./overview/live-shortcut.mjs";

export const journeys = guarded([...verdict, ...blocksAndPeriod, ...comparison, ...liveShortcut]);
