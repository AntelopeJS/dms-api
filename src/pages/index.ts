/**
 * The module's pages. `./module` is imported first so RegisterModule("api")
 * fires before any @RegisterPage decorator below runs: pages look the module
 * up synchronously when their decorator is invoked at import time.
 *
 * @packageDocumentation
 */
import "./module";
import "./displays";

export * from "./logs";
export * from "./module";
export * from "./overview";
export * from "./routes";
export * from "./settings";
