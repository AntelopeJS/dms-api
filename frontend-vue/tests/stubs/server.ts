import type { DmsServerSetup } from '#dms/server'

/**
 * Stand-in for the `#dms/server` alias the DMS frontend loader provides, which
 * only exists in the workspace it generates. Its `defineDmsServer` returns the
 * setup it is given, as this one does.
 */
export function defineDmsServer(setup: DmsServerSetup): DmsServerSetup {
  return setup
}
