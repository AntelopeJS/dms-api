/**
 * Stand-in for the `#dms/server` alias the DMS frontend loader provides, which
 * only exists in the workspace it generates. Its `defineDmsServer` returns the
 * setup it is given, as this one does.
 */
export interface DmsServer {
  registerRoute(
    method: string,
    path: string,
    handler: (event: never) => unknown,
    options?: object,
  ): void
}

export type DmsServerSetup = (server: DmsServer) => void

export function defineDmsServer(setup: DmsServerSetup): DmsServerSetup {
  return setup
}
