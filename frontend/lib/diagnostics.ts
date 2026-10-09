import type { Strings } from './language';
import type { AgentError, AgentErrorCode } from './protocol';

/** One fix step; `command` is shown as copyable code. */
export interface Step {
  text: string;
  command?: string;
}

/** A failure explained for the user: what went wrong, and numbered steps to fix it. */
export interface Problem {
  title: string;
  message: string;
  steps: Step[];
  /** Redacted technical detail, shown collapsed. */
  detail?: string;
  /** Link to the model settings on the settings page. */
  settingsLink?: boolean;
}

/** Fills `{name}` placeholders. */
export function fill(template: string, values: Record<string, string | number | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values[key];
    return value === undefined ? match : String(value);
  });
}

const TITLES: Record<AgentErrorCode, keyof Strings> = {
  unreachable: 'errLlmUnreachable',
  timeout: 'errLlmTimeout',
  auth: 'errLlmAuth',
  entra_token: 'errLlmEntraToken',
  model_not_found: 'errLlmModelNotFound',
  rate_limited: 'errLlmRateLimited',
  bad_request: 'errLlmBadRequest',
  server_error: 'errLlmServerError',
  empty_response: 'errLlmEmptyResponse',
  unknown: 'errLlmUnknown',
};

function logsStep(s: Strings): Step {
  return { text: s.stepAgentLogs, command: 'docker compose logs -f agent' };
}

function llmSteps(e: AgentError, s: Strings): Step[] {
  const v = { endpoint: e.endpoint, model: e.model };
  const ollama = e.provider === 'ollama';
  const baseUrl: Step = { text: fill(ollama ? s.stepOllamaBaseUrl : s.stepApiBaseUrl, v) };
  const restart: Step = { text: s.stepRestartAgent };
  switch (e.code) {
    case 'unreachable':
      return ollama
        ? [{ text: s.stepOllamaStart, command: 'ollama serve' }, baseUrl, { text: s.stepOllamaDocker }]
        : [baseUrl, { text: fill(s.stepNetwork, v) }, { text: s.stepTls }];
    case 'timeout':
      return ollama
        ? [{ text: s.stepOllamaWarm }, { text: s.stepTimeout }, { text: s.stepSmallerModel }]
        : [{ text: s.stepTimeout }, { text: fill(s.stepNetwork, v) }];
    case 'auth':
      return [
        ollama ? { text: s.stepOllamaApiKey } : { text: s.stepApiKey },
        ...(ollama ? [] : [{ text: s.stepEntraScope }]),
        restart,
      ];
    case 'entra_token':
      return [{ text: s.stepEntraLogin, command: 'az login' }, { text: s.stepEntraScope }, restart];
    case 'model_not_found':
      return ollama
        ? [{ text: s.stepOllamaPull, command: `ollama pull ${e.model}` }, { text: fill(s.stepOllamaModelName, v) }, baseUrl]
        : [{ text: fill(s.stepApiModel, v) }, baseUrl, restart];
    case 'rate_limited':
      return [{ text: s.stepRateLimited }];
    case 'bad_request':
      return [
        { text: s.stepTemperature, command: 'LLM_TEMPERATURE=omit' },
        { text: s.stepReasoning },
        { text: s.stepCapabilities },
      ];
    case 'server_error':
      return ollama ? [{ text: s.stepOllamaLogs }, { text: s.stepSmallerModel }] : [{ text: s.stepServerError }];
    case 'empty_response':
      return [{ text: s.stepCapabilities }, ...(ollama ? [{ text: s.stepSmallerModel }] : [])];
    case 'unknown':
      return [baseUrl, { text: s.stepCapabilities }];
  }
}

/** Explains an LLM failure reported by the agent. Steps depend on the code and on the provider. */
export function describeAgentError(e: AgentError, s: Strings): Problem {
  const provider = e.provider === 'ollama' ? 'Ollama' : s.errProviderApi;
  const message = [
    fill(s.errLlmMessage, { provider, model: e.model, endpoint: e.endpoint }),
    e.status ? fill(s.errHttpStatus, { status: e.status }) : '',
    e.recoverable ? s.errRecoverable : '',
  ].filter(Boolean).join(' ');
  return {
    title: s[TITLES[e.code]],
    message,
    steps: [...llmSteps(e, s), logsStep(s)],
    detail: e.detail,
    settingsLink: true,
  };
}

/** `ConnectionErrorReason` from livekit-client, by value; duck-typed so this module stays pure. */
const ConnectionReason = {
  NotAllowed: 0,
  ServerUnreachable: 1,
  InternalError: 2,
  Cancelled: 3,
  LeaveRequest: 4,
  Timeout: 5,
  WebSocket: 6,
  ServiceNotFound: 7,
} as const;

const TOKEN_ERROR = /Error generating token from endpoint [^:]*: received (\d+) \/ ([\s\S]*)$/;

function tokenReason(text: string): string | undefined {
  try {
    const body = JSON.parse(text) as { error?: unknown };
    if (typeof body.error === 'string') return body.error;
  } catch {
    // Not JSON: e.g. an HTML error page.
  }
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || undefined;
}

function livekitSteps(url: string, s: Strings): Step[] {
  return [
    { text: s.stepLivekitStart, command: 'livekit-server --dev' },
    { text: s.stepLivekitDocker, command: 'docker compose up -d livekit' },
    { text: s.stepLivekitPorts },
    { text: fill(s.stepLivekitUrl, { url }) },
  ];
}

/** Explains why connecting to the conversation failed (token endpoint, LiveKit server, credentials). */
export function describeConnectionError(err: unknown, livekitUrl: string | undefined, s: Strings): Problem {
  const url = livekitUrl ?? 'LIVEKIT_URL';
  const message = err instanceof Error ? err.message : String(err);
  const { reason, status, context } = (err ?? {}) as { reason?: unknown; status?: unknown; context?: unknown };

  const token = TOKEN_ERROR.exec(message);
  if (token || (/failed to fetch|networkerror|load failed/i.test(message) && !('reason' in Object(err)))) {
    const why = token ? tokenReason(token[2]!) : undefined;
    return {
      title: s.errTokenTitle,
      message: fill(s.errTokenMessage, { reason: why ?? message, status: token?.[1] }),
      steps: [
        { text: s.stepFrontendLogs, command: 'docker compose logs -f frontend' },
        { text: s.stepWikiSources },
        { text: s.stepLivekitKeys },
      ],
      detail: message,
    };
  }

  const notAllowed = reason === ConnectionReason.NotAllowed;
  if ((notAllowed && (status === 401 || status === 403)) || /invalid (api )?key|invalid token|unauthorized|signature/i.test(message)) {
    return {
      title: s.errLivekitAuthTitle,
      message: fill(s.errLivekitAuthMessage, { url }),
      steps: [{ text: s.stepLivekitKeys }, { text: s.stepRestartAll }],
      detail: message,
    };
  }

  if (reason === ConnectionReason.LeaveRequest) {
    return describeDisconnect(typeof context === 'number' ? context : undefined, s);
  }

  if (
    notAllowed ||
    reason === ConnectionReason.ServerUnreachable ||
    reason === ConnectionReason.Timeout ||
    reason === ConnectionReason.WebSocket ||
    reason === ConnectionReason.InternalError ||
    reason === ConnectionReason.ServiceNotFound ||
    /could not establish (signal|pc) connection|websocket|timed? ?out/i.test(message)
  ) {
    return {
      title: s.errLivekitUnreachableTitle,
      message: fill(s.errLivekitUnreachableMessage, { url }),
      steps: livekitSteps(url, s),
      detail: message,
    };
  }

  return {
    title: s.errConnectTitle,
    message: s.errConnectMessage,
    steps: [...livekitSteps(url, s).slice(0, 1), { text: s.stepFrontendLogs, command: 'docker compose logs -f frontend' }],
    detail: message,
  };
}

/** `DisconnectReason` from @livekit/protocol, by value. */
export const DISCONNECT_REASONS: Record<number, string> = {
  0: 'UNKNOWN_REASON',
  1: 'CLIENT_INITIATED',
  2: 'DUPLICATE_IDENTITY',
  3: 'SERVER_SHUTDOWN',
  4: 'PARTICIPANT_REMOVED',
  5: 'ROOM_DELETED',
  6: 'STATE_MISMATCH',
  7: 'JOIN_FAILURE',
  8: 'MIGRATION',
  9: 'SIGNAL_CLOSE',
  10: 'ROOM_CLOSED',
  11: 'USER_UNAVAILABLE',
  12: 'USER_REJECTED',
  13: 'SIP_TRUNK_FAILURE',
  14: 'CONNECTION_TIMEOUT',
  15: 'MEDIA_FAILURE',
};

/** The user ended the conversation; anything else is an unexpected disconnect. */
export function isUnexpectedDisconnect(reason: number | undefined): boolean {
  return reason !== 1;
}

/** Explains a dropped LiveKit connection. */
export function describeDisconnect(reason: number | undefined, s: Strings): Problem {
  const name = reason === undefined ? 'UNKNOWN_REASON' : DISCONNECT_REASONS[reason] ?? `#${reason}`;
  return {
    title: s.errConnectionLostTitle,
    message: fill(s.errConnectionLostMessage, { reason: name }),
    steps: [
      { text: s.stepLivekitRunning, command: 'docker compose ps livekit' },
      { text: s.stepNetworkBrowser },
      { text: s.stepStartAgain },
    ],
  };
}

/** Explains the SDK's agent failure reasons ("did not join", "left unexpectedly", ...). */
export function describeAgentAbsence(reasons: readonly string[], s: Strings): Problem {
  const text = reasons.join(' ');
  const left = /left the room/i.test(text);
  const initializing = /did not complete initializing/i.test(text);
  const title = left ? s.errAgentLeftTitle : initializing ? s.errAgentInitTitle : s.errAgentAbsentTitle;
  const message = left ? s.errAgentLeftMessage : initializing ? s.errAgentInitMessage : s.errAgentAbsentMessage;
  const start: Step[] = left ? [] : [
    { text: s.stepAgentStart, command: 'npm run dev -w agent' },
    { text: s.stepAgentDocker, command: 'docker compose up -d agent' },
    { text: s.stepAgentConfig },
  ];
  return {
    title,
    message,
    steps: [...start, logsStep(s), ...(left ? [{ text: s.stepStartAgain }] : [])],
    detail: text || undefined,
    settingsLink: left,
  };
}
