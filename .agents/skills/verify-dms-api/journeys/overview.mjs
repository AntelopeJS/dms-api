import { guarded } from "../guard.mjs";
import { verdict } from "./overview/verdict.mjs";
import { blocksAndPeriod } from "./overview/blocks-and-period.mjs";
import { comparison } from "./overview/comparison.mjs";

export const journeys = guarded([...verdict, ...blocksAndPeriod, ...comparison]);
