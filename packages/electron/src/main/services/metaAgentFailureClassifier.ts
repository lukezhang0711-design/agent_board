/**
 * Classifies a failure at the moment it is written to a work-order.
 *
 * The retry gate deliberately does not inspect raw error text. Once a failure
 * is recorded, the persisted class is the only routing input. Unknown text is
 * conservative by design: it falls into `agent`, which requires the owner's
 * instruction before another dispatch.
 */

export type FailureClass = 'infra' | 'agent';

interface FailurePattern {
  pattern: RegExp;
  /** Why this text is evidence of a platform-side failure. */
  basis: string;
}

const INFRA_FAILURE_PATTERNS: FailurePattern[] = [
  // Node/network error codes mean the request could not reach or stay connected
  // to the provider; they do not describe the child model's work.
  { pattern: /\b(?:ECONNRESET|ECONNREFUSED|ECONNABORTED|ENETUNREACH|EHOSTUNREACH|EAI_AGAIN|ENOTFOUND|ETIMEDOUT)\b/i, basis: 'transport error code' },
  // These phrases are emitted by fetch/HTTP clients when the transport itself
  // fails before a provider can return a model/request diagnosis.
  { pattern: /\b(?:network error|network unavailable|fetch failed|socket hang up|connection (?:reset|refused|closed|timed out|error)|dns error)\b/i, basis: 'transport failure text' },
  // A deadline/timeout is a transient execution boundary, so the platform may
  // safely try the same work once more.
  { pattern: /\b(?:timeout|timed out|deadline exceeded|request took too long)\b/i, basis: 'request deadline/timeout' },
  // HTTP 5xx and the standard 429/rate-limit/quota signals identify provider
  // availability or capacity, not a malformed child instruction.
  { pattern: /\b(?:5\d\d|429)\b|\b(?:rate limit(?:ed)?|too many requests|quota(?: exceeded| exhausted)?|insufficient_quota|resource exhausted|overloaded|capacity temporarily unavailable)\b/i, basis: 'provider availability/capacity response' },
  // These are lifecycle failures of the local engine process/worker. The
  // child cannot repair a process that is offline or has crashed.
  { pattern: /\b(?:engine|process|worker|subprocess|child process|server)\b[\s\S]{0,80}\b(?:offline|unavailable|down|crash(?:ed)?|exited|not running|died)\b/i, basis: 'engine process lifecycle failure' },
  { pattern: /\bno active (?:provider|terminal) for session\b/i, basis: 'engine transport is no longer active' },
];

const AGENT_FAILURE_PATTERNS: FailurePattern[] = [
  // Invalid/unknown model identifiers are a routing/configuration error owned
  // by the Head/agent, not a reason to repeat the same request automatically.
  { pattern: /\b(?:invalid|unknown|unsupported|unrecognized)\b[\s\S]{0,80}\bmodel(?: identifier| name)?\b|\bmodel(?: identifier| name)?\b[\s\S]{0,80}\b(?:invalid|unknown|unsupported|not supported|not found|does not exist)\b/i, basis: 'model identifier/configuration' },
  // Auth and login failures require the owner to repair credentials or choose
  // another account/provider before retrying.
  { pattern: /\b(?:authentication|unauthori[sz]ed|invalid api key|api key|login|logged in|credential|oauth|access token|token expired|token invalid)\b|\b401\b/i, basis: 'credential/authentication' },
  // 4xx request/schema/format errors describe the request made by the agent;
  // the same malformed request should not be replayed automatically.
  { pattern: /\b(?:400|404)\b|\b(?:bad request|invalid request|invalid_request_error|malformed|schema|json|format|parse error|illegal argument|invalid parameter)\b/i, basis: 'request shape/format' },
  // Context-window exhaustion is caused by the prompt/conversation assembled by
  // the agent and needs an explicit decision about shortening or changing it.
  { pattern: /\b(?:context(?: window| length)?|too many tokens|token limit|maximum tokens|prompt too long|input too long)[\s\S]{0,80}\b(?:exceed|exceeded|limit|length|long|maximum|overflow)\b|\bcontext_length_exceeded\b/i, basis: 'prompt/context size' },
];

/**
 * Return the durable routing class for a raw failure reason.
 *
 * `AGENT_FAILURE_PATTERNS` is intentionally evaluated after infrastructure
 * patterns: a response such as "429: invalid model" is still a platform rate
 * limit at the time it is observed. A non-matching string is the required
 * conservative `agent` fallback.
 */
export function classifyFailureReason(failureReason: string): FailureClass {
  const normalized = String(failureReason ?? '').trim();
  if (INFRA_FAILURE_PATTERNS.some(({ pattern }) => pattern.test(normalized))) {
    return 'infra';
  }
  if (AGENT_FAILURE_PATTERNS.some(({ pattern }) => pattern.test(normalized))) {
    return 'agent';
  }
  return 'agent';
}

export function isFailureClass(value: unknown): value is FailureClass {
  return value === 'infra' || value === 'agent';
}
