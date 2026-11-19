import { guarded } from "../guard.mjs";
import { treeAndStatistics } from "./routes/tree-and-statistics.mjs";
import { documentation } from "./routes/documentation.mjs";
import { comparisonAndSnippets } from "./routes/comparison-and-snippets.mjs";
import { keyboardAndClipboard } from "./routes/keyboard-and-clipboard.mjs";

export const journeys = guarded([...treeAndStatistics, ...documentation, ...comparisonAndSnippets, ...keyboardAndClipboard]);
