// Re-export the capture controller so the side-effect of class decoration
// (which registers @Prefix/@Monitor handlers) runs as soon as `middlewares`
// is imported by src/index.ts. Keeping the implementation in the
// request-log service folder preserves the "single owner per concern" layout.
export { RequestLogCapture } from "@/services/request-log/capture";
