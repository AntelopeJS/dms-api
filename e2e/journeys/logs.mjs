import { guarded } from "../guard.mjs";
import { listAndPause } from "./logs/list-and-pause.mjs";
import { histogramAndDrawer } from "./logs/histogram-and-drawer.mjs";
import { filtersAndLabels } from "./logs/filters-and-labels.mjs";

export const journeys = guarded([...listAndPause, ...histogramAndDrawer, ...filtersAndLabels]);
