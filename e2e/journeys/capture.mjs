import { guarded } from "../guard.mjs";
import { redaction } from "./capture/redaction.mjs";

export const journeys = guarded(redaction);
