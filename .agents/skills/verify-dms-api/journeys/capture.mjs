import { guarded } from "../guard.mjs";
import { captured } from "./capture/captured.mjs";
import { redaction } from "./capture/redaction.mjs";

export const journeys = guarded([...captured, ...redaction]);
