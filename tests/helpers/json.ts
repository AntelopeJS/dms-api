import { z } from "zod";

/** A JSON value, as an answer of the API holds it. */
export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };

export const jsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonSchema),
    z.record(z.string(), jsonSchema),
  ]),
);

/** A response body as JSON, or as its text when it is not JSON. */
export function parseBody(body: string): Json {
  try {
    return jsonSchema.parse(JSON.parse(body));
  } catch {
    return body;
  }
}

/** The rows of a list answer of the console: `{ results: [...] }`. */
export function resultsOf<T extends z.ZodTypeAny>(
  body: Json,
  row: T,
): z.infer<T>[] {
  return z.object({ results: z.array(row) }).parse(body).results;
}
