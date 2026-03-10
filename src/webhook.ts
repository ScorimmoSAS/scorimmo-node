import type {
  ScorimmoWebhookConfig,
  WebhookEvent,
  WebhookNewLead,
  WebhookUpdateLead,
  WebhookNewComment,
  WebhookNewRdv,
  WebhookNewReminder,
  WebhookClosureLead,
} from './types.js'

export type { WebhookEvent }

// ─── Event handler map ────────────────────────────────────────────────────────

export interface WebhookHandlers {
  onNewLead?: (payload: WebhookNewLead) => void | Promise<void>
  onUpdateLead?: (payload: WebhookUpdateLead) => void | Promise<void>
  onNewComment?: (payload: WebhookNewComment) => void | Promise<void>
  onNewRdv?: (payload: WebhookNewRdv) => void | Promise<void>
  onNewReminder?: (payload: WebhookNewReminder) => void | Promise<void>
  onClosureLead?: (payload: WebhookClosureLead) => void | Promise<void>
  /** Catch-all for unknown or future events */
  onUnknown?: (payload: WebhookEvent) => void | Promise<void>
}

// ─── Core class ───────────────────────────────────────────────────────────────

export class ScorimmoWebhook {
  private readonly headerKey: string
  private readonly headerValue: string

  constructor(config: ScorimmoWebhookConfig) {
    this.headerKey = config.headerKey.toLowerCase()
    this.headerValue = config.headerValue
  }

  /**
   * Validates an incoming webhook request.
   * Returns the parsed event payload or throws a WebhookError.
   */
  parse(headers: Record<string, string | string[] | undefined>, body: unknown): WebhookEvent {
    this.assertAuth(headers)

    if (!body || typeof body !== 'object') {
      throw new WebhookValidationError('Payload must be a JSON object')
    }

    const payload = body as Record<string, unknown>

    if (!payload['event'] || typeof payload['event'] !== 'string') {
      throw new WebhookValidationError('Missing or invalid "event" field in payload')
    }

    return payload as unknown as WebhookEvent
  }

  /**
   * Dispatches a parsed webhook event to the appropriate handler.
   *
   * @example
   * const event = webhook.parse(req.headers, req.body)
   * await webhook.dispatch(event, {
   *   onNewLead: async (lead) => { await crm.create(lead) },
   *   onClosureLead: async ({ lead_id }) => { await crm.archive(lead_id) },
   * })
   */
  async dispatch(event: WebhookEvent, handlers: WebhookHandlers): Promise<void> {
    switch (event.event) {
      case 'new_lead':
        await handlers.onNewLead?.(event as WebhookNewLead)
        break
      case 'update_lead':
        await handlers.onUpdateLead?.(event as WebhookUpdateLead)
        break
      case 'new_comment':
        await handlers.onNewComment?.(event as WebhookNewComment)
        break
      case 'new_rdv':
        await handlers.onNewRdv?.(event as WebhookNewRdv)
        break
      case 'new_reminder':
        await handlers.onNewReminder?.(event as WebhookNewReminder)
        break
      case 'closure_lead':
        await handlers.onClosureLead?.(event as WebhookClosureLead)
        break
      default:
        await handlers.onUnknown?.(event)
    }
  }

  /**
   * Returns an Express middleware that validates and parses incoming Scorimmo webhooks.
   * Attaches the parsed event to `req.scorimmo`.
   *
   * @example
   * app.post('/webhook', ...webhook.middleware(), async (req, res) => {
   *   await webhook.dispatch(req.scorimmo, { onNewLead: ... })
   *   res.sendStatus(200)
   * })
   */
  middleware() {
    return [
      expressJsonParser(),
      (req: ExpressRequest, res: ExpressResponse, next: ExpressNext) => {
        try {
          req.scorimmo = this.parse(req.headers as Record<string, string>, req.body)
          next()
        } catch (err) {
          if (err instanceof WebhookAuthError) {
            res.status(401).json({ error: err.message })
          } else if (err instanceof WebhookValidationError) {
            res.status(400).json({ error: err.message })
          } else {
            next(err)
          }
        }
      },
    ]
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private assertAuth(headers: Record<string, string | string[] | undefined>): void {
    // Normalize all incoming headers to lowercase for case-insensitive comparison
    const normalizedHeaders: Record<string, string | string[] | undefined> = {}
    for (const [k, v] of Object.entries(headers)) {
      normalizedHeaders[k.toLowerCase()] = v
    }
    const value = normalizedHeaders[this.headerKey]
    const received = Array.isArray(value) ? value[0] : value

    if (received !== this.headerValue) {
      throw new WebhookAuthError('Invalid or missing webhook authentication header')
    }
  }
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class WebhookAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebhookAuthError'
  }
}

export class WebhookValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebhookValidationError'
  }
}

// ─── Express type shims (no hard dependency) ──────────────────────────────────

interface ExpressRequest {
  headers: Record<string, string | string[] | undefined>
  body: unknown
  scorimmo: WebhookEvent
}

interface ExpressResponse {
  status(code: number): ExpressResponse
  json(body: unknown): void
  sendStatus(code: number): void
}

type ExpressNext = (err?: unknown) => void

function expressJsonParser() {
  // Use express.json() if available at runtime, otherwise return a no-op
  // (body-parser or express.json() must be set up by the consumer)
  return (_req: ExpressRequest, _res: ExpressResponse, next: ExpressNext) => next()
}

// ─── Augment Express Request type ────────────────────────────────────────────

declare global {
  namespace Express {
    interface Request {
      scorimmo: WebhookEvent
    }
  }
}
