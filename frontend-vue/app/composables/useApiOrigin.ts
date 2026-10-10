import { computed } from 'vue'

interface PublicConfig {
  dms?: { baseURL?: string }
}

/**
 * Where the API answers, for the snippets the console hands out (cURL,
 * fetch): the DMS backend URL when the frontend knows it, else this origin.
 */
export function useApiOrigin() {
  const config = useDmsRuntimeConfig()
  return computed(() => {
    const configured = (config.public as PublicConfig).dms?.baseURL
    if (configured) return configured.replace(/\/$/, '')
    return typeof window === 'undefined' ? '' : window.location.origin
  })
}
