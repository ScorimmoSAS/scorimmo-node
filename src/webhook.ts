import { createHmac, timingSafeEqual } from 'node:crypto'
import type {
  ScorimmoWebhookConfig,
  SemanticWebhookEvent,
  WebhookCampaignClosed,
  WebhookCampaignContactClosed,
  WebhookCampaignContactUpdated,
  WebhookClosureLead,
  WebhookEvent,
  WebhookNewComment,
  WebhookNewLead,
  WebhookNewRdv,
  WebhookNewReminder,
  WebhookUpdateLead,
} from './types.js'

export type { WebhookEvent, SemanticWebhookEvent }

// ─── Event handler map ────────────────────────────────────────────────────────

/**
 * Handlers optionnels indexés par nom d'événement. Le handler `onUnknown` capture les
 * événements futurs non encore modélisés (X-Scorimmo-Event: `webhook.<name>`).
 */
export interface WebhookHandlers {
  onNewLead?: (payload: WebhookNewLead) => void | Promise<void>
  onUpdateLead?: (payload: WebhookUpdateLead) => void | Promise<void>
  onNewComment?: (payload: WebhookNewComment) => void | Promise<void>
  onNewRdv?: (payload: WebhookNewRdv) => void | Promise<void>
  onNewReminder?: (payload: WebhookNewReminder) => void | Promise<void>
  onClosureLead?: (payload: WebhookClosureLead) => void | Promise<void>
  onCampaignContactUpdated?: (payload: WebhookCampaignContactUpdated) => void | Promise<void>
  onCampaignContactClosed?: (payload: WebhookCampaignContactClosed) => void | Promise<void>
  onCampaignClosed?: (payload: WebhookCampaignClosed) => void | Promise<void>
  onUnknown?: (payload: WebhookEvent) => void | Promise<void>
}

type Headers = Record<string, string | string[] | undefined>

// ─── ScorimmoWebhook ──────────────────────────────────────────────────────────

/**
 * Réception et validation des webhooks Scorimmo (API v2).
 *
 * En V2, l'authentification des webhooks est **optionnelle** — la sécurisation de l'endpoint
 * est à la charge de l'intégrateur. Trois mécanismes sont couramment utilisés
 * (isolés ou combinés) :
 *
 *  1. Signature HMAC-SHA256 (fortement recommandé) — Scorimmo signe le corps brut avec
 *     un secret partagé et envoie la signature dans un header dédié (défaut :
 *     `X-Signature-256`, valeur `sha256=<hex>`). Le SDK la vérifie en temps constant
 *     via `crypto.timingSafeEqual`.
 *
 *  2. HTTP Basic auth via URL — l'endpoint est enregistré comme
 *     `https://user:pass@host/path`. L'authentification est déléguée au serveur/framework.
 *
 *  3. Restriction réseau (IP whitelist, VPN, mTLS…) — hors périmètre du SDK.
 *
 * Ce SDK gère uniquement le mécanisme 1. Pour l'activer, passez `signatureSecret` au
 * constructeur ; sinon aucune vérification n'est effectuée et le payload est simplement parsé.
 *
 * Headers envoyés par Scorimmo :
 *  - `{signatureHeader}`  — signature HMAC, présent si vous avez configuré un secret
 *  - `X-Scorimmo-Event`   — nom sémantique (`lead.created`, `webhook.<name>`, …)
 *  - `X-Scorimmo-Version` — date de version d'API (`2026-04-20` — pas un semver)
 *  - `User-Agent`         — `Scorimmo/<app_version>`
 *
 * Événements émis (mapping `event` payload ↔ header) :
 *  new_lead → lead.created, update_lead → lead.updated, closure_lead → lead.closed,
 *  new_comment → lead.comment_added, new_rdv → lead.appointment_created,
 *  new_reminder → lead.reminder_created. Webhooks v2 uniquement :
 *  campaign_contact_updated → campaign.contact_updated,
 *  campaign_contact_closed → campaign.contact_closed, campaign_closed → campaign.closed.
 *  Événements futurs : `webhook.<name>` (routés vers `onUnknown`).
 *
 * Idempotence : livraison at-least-once (jusqu'à 6 tentatives, backoff exponentiel
 * jusqu'à 60 s). Le corps et la signature sont identiques à chaque retry — dédupliquez
 * côté récepteur par `(event, lead_id, created_at/updated_at)`, ou pour les campagnes par
 * `(event, contact_id, updated_at/closed_at)` et `(event, campaign_id, closed_at)`.
 *
 * ATTENTION : si vous activez la signature, le corps BRUT (avant JSON.parse) doit être
 * lu et transmis à `parse()`. Voir l'exemple `express-webhook.ts`.
 */
export class ScorimmoWebhook {
  /** Préfixe conventionnel de la valeur de signature envoyée par Scorimmo. */
  static readonly SIGNATURE_PREFIX = 'sha256='

  /** Nom de header par défaut portant la signature HMAC. */
  static readonly DEFAULT_SIGNATURE_HEADER = 'X-Signature-256'

  private readonly signatureSecret: string | null
  private readonly signatureHeader: string // lower-case
  private readonly logger: { warn: (message: string, context?: unknown) => void } | null

  constructor(config: ScorimmoWebhookConfig = {}) {
    // Chaîne vide == aucun secret : évite un hash_equals silencieusement faux si l'env var
    // n'est pas renseignée.
    const secret = config.signatureSecret
    this.signatureSecret = secret && secret.length > 0 ? secret : null
    this.signatureHeader = (config.signatureHeader ?? ScorimmoWebhook.DEFAULT_SIGNATURE_HEADER).toLowerCase()
    this.logger = config.logger ?? null
  }

  /**
   * Valide (si un secret est configuré) et parse une requête webhook entrante.
   *
   * @param headers Headers HTTP (insensible à la casse). Accepte les formats
   *                `getallheaders()`-like (string) et Node/Express (string | string[]).
   * @param rawBody Corps de la requête. **Doit être une chaîne brute** si la signature
   *                est activée (le SDK re-calcule le HMAC dessus). Sinon un objet parsé
   *                est également accepté.
   */
  parse(headers: Headers, rawBody: string | object): WebhookEvent {
    if (this.signatureSecret !== null) {
      if (typeof rawBody !== 'string') {
        throw new WebhookAuthError(
          'Signature verification requires the RAW request body as a string, not a parsed object.',
        )
      }
      this.assertSignature(headers, rawBody)
    }

    let payload: unknown
    if (typeof rawBody === 'string') {
      try {
        payload = JSON.parse(rawBody)
      } catch {
        throw new WebhookValidationError('Payload must be valid JSON')
      }
    } else {
      payload = rawBody
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new WebhookValidationError('Payload must be a JSON object')
    }
    const record = payload as Record<string, unknown>
    if (typeof record['event'] !== 'string' || record['event'].length === 0) {
      throw new WebhookValidationError('Missing or invalid "event" field in payload')
    }

    return record as unknown as WebhookEvent
  }

  /**
   * Dispatche un événement parsé vers le handler correspondant. Les événements non
   * reconnus (`webhook.<name>` futur, ou nom inattendu) tombent sur `onUnknown` s'il
   * est fourni ; sinon ils sont silencieusement ignorés — ou tracés via le `logger`
   * optionnel passé au constructeur (`logger.warn(msg, { event })`).
   */
  async dispatch(event: WebhookEvent, handlers: WebhookHandlers): Promise<void> {
    const named = this.pickNamedHandler(event, handlers)
    if (named !== null) {
      await named()
      return
    }
    if (handlers.onUnknown) {
      await handlers.onUnknown(event)
      return
    }
    this.logger?.warn('scorimmo webhook: no handler for event', { event: event.event })
  }

  private pickNamedHandler(event: WebhookEvent, handlers: WebhookHandlers): (() => void | Promise<void>) | null {
    switch (event.event) {
      case 'new_lead':
        return handlers.onNewLead ? () => handlers.onNewLead!(event as WebhookNewLead) : null
      case 'update_lead':
        return handlers.onUpdateLead ? () => handlers.onUpdateLead!(event as WebhookUpdateLead) : null
      case 'new_comment':
        return handlers.onNewComment ? () => handlers.onNewComment!(event as WebhookNewComment) : null
      case 'new_rdv':
        return handlers.onNewRdv ? () => handlers.onNewRdv!(event as WebhookNewRdv) : null
      case 'new_reminder':
        return handlers.onNewReminder ? () => handlers.onNewReminder!(event as WebhookNewReminder) : null
      case 'closure_lead':
        return handlers.onClosureLead ? () => handlers.onClosureLead!(event as WebhookClosureLead) : null
      case 'campaign_contact_updated':
        return handlers.onCampaignContactUpdated ? () => handlers.onCampaignContactUpdated!(event as WebhookCampaignContactUpdated) : null
      case 'campaign_contact_closed':
        return handlers.onCampaignContactClosed ? () => handlers.onCampaignContactClosed!(event as WebhookCampaignContactClosed) : null
      case 'campaign_closed':
        return handlers.onCampaignClosed ? () => handlers.onCampaignClosed!(event as WebhookCampaignClosed) : null
      default:
        return null
    }
  }

  /**
   * Parse et dispatche un webhook en une seule opération.
   */
  async handle(headers: Headers, rawBody: string | object, handlers: WebhookHandlers): Promise<void> {
    const event = this.parse(headers, rawBody)
    await this.dispatch(event, handlers)
  }

  /**
   * Vérifie une signature HMAC-SHA256 en temps constant. Utilisable indépendamment de
   * `parse()` (par exemple pour logger avant validation).
   *
   * @param rawBody     Corps brut de la requête
   * @param headerValue Valeur du header de signature (avec ou sans préfixe `sha256=`)
   * @param secret      Secret partagé configuré côté Scorimmo
   */
  verifySignature(rawBody: string, headerValue: string, secret: string): boolean {
    const received = headerValue.startsWith(ScorimmoWebhook.SIGNATURE_PREFIX)
      ? headerValue.slice(ScorimmoWebhook.SIGNATURE_PREFIX.length)
      : headerValue

    const expected = createHmac('sha256', secret).update(rawBody).digest('hex')

    // timingSafeEqual exige des buffers de même longueur — sinon signature invalide.
    if (received.length !== expected.length) return false
    try {
      return timingSafeEqual(Buffer.from(received, 'utf8'), Buffer.from(expected, 'utf8'))
    } catch {
      return false
    }
  }

  /**
   * Indique si le webhook vérifie la signature HMAC des requêtes entrantes.
   * `false` = aucun secret configuré, aucune vérification effectuée par le SDK.
   */
  verifiesSignature(): boolean {
    return this.signatureSecret !== null
  }

  /**
   * Extrait le nom sémantique de l'événement depuis `X-Scorimmo-Event`.
   * Utile pour logger ou router avant même de parser le payload.
   */
  getSemanticEvent(headers: Headers): SemanticWebhookEvent | null {
    return this.headerValue(headers, 'x-scorimmo-event') as SemanticWebhookEvent | null
  }

  /**
   * Extrait la version d'API depuis `X-Scorimmo-Version` (format `YYYY-MM-DD`).
   */
  getApiVersion(headers: Headers): string | null {
    return this.headerValue(headers, 'x-scorimmo-version')
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private assertSignature(headers: Headers, rawBody: string): void {
    const received = this.headerValue(headers, this.signatureHeader)
    if (received === null) {
      throw new WebhookAuthError(`Missing webhook signature header "${this.signatureHeader}"`)
    }
    if (!this.verifySignature(rawBody, received, this.signatureSecret!)) {
      throw new WebhookAuthError('Invalid webhook signature')
    }
  }

  /**
   * Lit une valeur de header insensible à la casse, en acceptant les formats
   * `string`, `string[]` (Node/Express) et `undefined`.
   */
  private headerValue(headers: Headers, lowerKey: string): string | null {
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() !== lowerKey) continue
      const raw = Array.isArray(v) ? v[0] : v
      if (raw === undefined || raw === null) return null
      const str = String(raw)
      return str.length > 0 ? str : null
    }
    return null
  }
}

// ─── Errors ───────────────────────────────────────────────────────────────────

/** Levée par `parse()` quand la signature HMAC est manquante ou invalide (401). */
export class WebhookAuthError extends Error {
  constructor(message: string) { super(message); this.name = 'WebhookAuthError' }
}

/** Levée par `parse()` quand le payload n'est pas un JSON valide ou manque `event` (400). */
export class WebhookValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'WebhookValidationError' }
}
