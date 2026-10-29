export type Verdict = 'down' | 'degraded' | 'recovered' | 'operational' | 'idle'

/** Rates in percent (0–100); the figures cover the last `windowMinutes`. */
interface HealthMetrics {
  serverErrorRate: number
  clientErrorRate: number
  /** Null when no call was measured in the window. */
  p95Ms: number | null
  requestsPerMinute: number
}

/** Rates in percent, like the metrics. */
interface HealthThresholds {
  /** Degraded from this 5xx rate over `windowMinutes`. */
  degradedServerErrorRate: number
  /** Down from this 5xx rate over `downWindowMinutes`. */
  downServerErrorRate: number
  windowMinutes: number
  downWindowMinutes: number
  /** How far back the verdict looks for an incident. */
  lookbackMinutes: number
  /** The slow threshold of the settings: a p95 from it is slow. */
  slowThresholdMs: number
}

/** What one rule reads now, over its own window. */
interface RuleWindow {
  minutes: number
  requests: number
  serverErrors: number
  serverErrorRate: number
}

export interface HealthPayload {
  verdict: Verdict
  /** Start of the current incident, or of the last one. */
  incidentStart: string | null
  /** How long the verdict has held; null when longer than the lookback. */
  durationMs: number | null
  checkedAt: string
  metrics: HealthMetrics
  /** The degraded and down rules' windows; null without any call. */
  ruleWindows: { degraded: RuleWindow; down: RuleWindow } | null
  thresholds: HealthThresholds
  failingRoutes: number
  recoveredRoutes: number
  slowRoutes: number
  serverErrors: number
  routes: { value: number; needingAttention: number }
  serverErrorsLink: string
  firstRun: boolean
}

export type MetricTone = 'default' | 'warning' | 'error' | 'muted'

export interface HeroMetric {
  id: string
  label: string
  value: string
  unit?: string
  sub: string
  tone: MetricTone
  /** A figure of context: smaller, and grey whatever its value. */
  secondary?: boolean
}

export interface VerdictLook {
  icon: string
  text: string
  dot: string
  tint: string
  line: string
}
