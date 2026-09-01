import type {
  AppointmentsListQuery,
  BaseListQuery,
  CommentsListQuery,
  Customer,
  CustomersListQuery,
  FieldSet,
  FieldsListQuery,
  FormSubmitPayload,
  FormSubmitResponse,
  Lead,
  LeadAppointment,
  LeadComment,
  LeadInclude,
  LeadReminder,
  LeadRequest,
  LeadUpdatePayload,
  LeadsListQuery,
  Origin,
  OriginTrackingChannel,
  OriginsListQuery,
  PaginatedResponse,
  RemindersListQuery,
  RequestsListQuery,
  ScorimmoClientConfig,
  StatusEntry,
  StatusListQuery,
  Store,
  TokenResponse,
  TokenValidateResponse,
  User,
  UserRole,
  UsersListQuery,
  WebCallbackLaunchResponse,
} from './types.js'

// ─── Errors ───────────────────────────────────────────────────────────────────

/**
 * Levée lorsque l'API renvoie une réponse HTTP non-2xx, ou lorsqu'une erreur réseau
 * empêche d'atteindre l'API. `statusCode` vaut 0 pour une erreur réseau.
 * `apiCode` reflète l'identifiant d'erreur applicatif éventuellement présent dans le body.
 */
export class ScorimmoApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly apiCode?: string | number,
  ) {
    super(message)
    this.name = 'ScorimmoApiError'
  }
}

/**
 * Levée lorsqu'une authentification échoue : credentials rejetés, refresh token invalide
 * ou révoqué, ou 401 sur un endpoint non authentifié.
 */
export class ScorimmoAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScorimmoAuthError'
  }
}

// ─── Query string helper ─────────────────────────────────────────────────────

/**
 * Encode un objet clé-valeur en query string.
 * - Ignore les valeurs `undefined`/`null`.
 * - Conserve la notation bracket (ex. `created_at[gte]`) non encodée pour que l'API la parse.
 * - Convertit les booléens en `true`/`false`.
 */
function buildQueryString(query: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    const encodedKey = encodeURIComponent(key).replace(/%5B/g, '[').replace(/%5D/g, ']')
    const encodedValue = encodeURIComponent(
      typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value),
    )
    parts.push(`${encodedKey}=${encodedValue}`)
  }
  return parts.join('&')
}

function assertPagination(query: BaseListQuery): void {
  if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100)) {
    throw new Error(`"limit" must be an integer between 1 and 100, got: ${JSON.stringify(query.limit)}`)
  }
  if (query.page !== undefined && (!Number.isInteger(query.page) || query.page < 1)) {
    throw new Error(`"page" must be a positive integer (>= 1), got: ${JSON.stringify(query.page)}`)
  }
}

function assertSort(sort: string, validFields: readonly string[]): void {
  const parts = sort.split(':')
  if (parts.length !== 2) {
    throw new Error(`"sort" must be in format "field:direction", got: "${sort}"`)
  }
  const [field, direction] = parts
  if (!validFields.includes(field)) {
    throw new Error(`"sort" field must be one of: ${validFields.join(', ')}. Got: "${field}"`)
  }
  if (direction !== 'asc' && direction !== 'desc') {
    throw new Error(`"sort" direction must be "asc" or "desc", got: "${direction}"`)
  }
}

// ─── Base resource ────────────────────────────────────────────────────────────

abstract class AbstractResource<T, ListQuery extends BaseListQuery> {
  constructor(protected readonly client: ScorimmoClient) {}
  protected abstract basePath(): string
  protected sortFields(): readonly string[] { return ['id'] }

  async get(id: number, query: Record<string, unknown> = {}): Promise<T> {
    const qs = buildQueryString(query)
    return this.client.request<T>('GET', `${this.basePath()}/${id}${qs ? `?${qs}` : ''}`)
  }

  async list(query: ListQuery = {} as ListQuery): Promise<PaginatedResponse<T>> {
    assertPagination(query)
    if (query.sort) assertSort(query.sort, this.sortFields())
    const qs = buildQueryString(query as Record<string, unknown>)
    return this.client.request<PaginatedResponse<T>>('GET', `${this.basePath()}${qs ? `?${qs}` : ''}`)
  }
}

// ─── Leads ────────────────────────────────────────────────────────────────────

const LEADS_SORT_FIELDS = ['id', 'created_at', 'updated_at', 'status'] as const
const DATE_FIELDS = ['created_at', 'updated_at'] as const

/**
 * Ressource Leads — lecture et mise à jour partielle des demandes de contact.
 *
 * Endpoints couverts :
 *  - GET   /api/v2/leads
 *  - GET   /api/v2/leads/{id}
 *  - PATCH /api/v2/leads/{id}
 *
 * La **création** de leads n'est volontairement pas exposée — utilisez l'UI Scorimmo,
 * les formulaires publics (`client.form`) ou les imports.
 *
 * @scope ROLE_API_LEAD_READ (lead:read) pour `get()` / `list()` / `since()`
 * @scope ROLE_API_LEAD_WRITE (lead:write) pour `update()`
 */
export class LeadsResource extends AbstractResource<Lead, LeadsListQuery> {
  protected basePath(): string { return '/api/v2/leads' }
  protected override sortFields(): readonly string[] { return LEADS_SORT_FIELDS }

  /**
   * Récupère un lead par son identifiant.
   *
   * @param includeOrQuery Relations à charger — tableau de valeurs parmi `'customer'`,
   *                       `'seller'`, `'appointments'`, `'reminders'`, `'requests'`,
   *                       `'comments'`. Un `Record<string, unknown>` est également accepté
   *                       (pass-through au parent) pour compat avec la signature de base.
   */
  override async get(
    id: number,
    includeOrQuery: LeadInclude[] | Record<string, unknown> = [],
  ): Promise<Lead> {
    const query: Record<string, unknown> = Array.isArray(includeOrQuery)
      ? (includeOrQuery.length > 0 ? { include: includeOrQuery.join(',') } : {})
      : includeOrQuery
    return super.get(id, query)
  }

  /**
   * Mise à jour partielle d'un lead — seuls les champs transmis sont modifiés.
   * Champs acceptés : `seller_id`, `origin`, `external_lead_id`, `external_customer_id`,
   * `additional_fields` (remplacement complet du bloc).
   *
   * @scope ROLE_API_LEAD_WRITE (lead:write)
   */
  async update(id: number, data: LeadUpdatePayload): Promise<Lead> {
    if (!data || Object.keys(data).length === 0) {
      throw new Error('update() requires at least one field to modify')
    }
    return this.client.request<Lead>('PATCH', `${this.basePath()}/${id}`, data)
  }

  /**
   * Récupère tous les leads créés/modifiés après une date donnée. Gère la pagination et
   * dédoublonne par id (un lead peut apparaître sur deux pages consécutives si la liste
   * se décale pendant la pagination).
   *
   * @param date        `Date` ou chaîne `Y-m-d`, `Y-m-d H:i:s`, ou ISO 8601
   * @param field       `created_at` (défaut) ou `updated_at`
   * @param maxPages    Plafond de pages (défaut 100 ≈ 10 000 leads)
   * @param storeId     Restreindre à un point de vente
   * @param include     Relations à charger
   * @param onProgress  Callback appelé après chaque page
   */
  async since(
    date: string | Date,
    field: 'created_at' | 'updated_at' = 'created_at',
    maxPages = 100,
    storeId?: number,
    include: LeadInclude[] = [],
    onProgress?: (page: number, count: number, total: number, meta: Record<string, unknown>) => void,
  ): Promise<Lead[]> {
    if (!DATE_FIELDS.includes(field)) {
      throw new Error(`"field" must be one of: ${DATE_FIELDS.join(', ')}. Got: "${field}"`)
    }
    if (maxPages < 1) {
      throw new Error(`"maxPages" must be >= 1, got: ${maxPages}`)
    }

    let iso: string
    if (date instanceof Date) {
      iso = date.toISOString().slice(0, 19).replace('T', ' ')
    } else {
      if (!/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?([+-]\d{2}:?\d{2}|Z)?)?$/.test(date)) {
        throw new Error(
          `"date" string must be Y-m-d, Y-m-d H:i:s, or ISO 8601 (e.g. "2026-05-01", ` +
          `"2026-05-01 12:00:00", "2026-05-01T12:00:00+02:00"), got: "${date}".`,
        )
      }
      iso = date
    }

    const all: Lead[] = []
    let page = 1
    let result: PaginatedResponse<Lead>

    do {
      const query: LeadsListQuery = {
        [`${field}[gte]`]: iso,
        sort: `${field}:asc`,
        limit: 100,
        page,
      }
      if (storeId !== undefined) query.store_id = storeId
      if (include.length > 0) query.include = include.join(',')

      result = await this.list(query)
      const pageResults = result.data ?? []
      all.push(...pageResults)

      onProgress?.(page, pageResults.length, all.length, (result.meta ?? {}) as unknown as Record<string, unknown>)
      page++

      if (pageResults.length === 0 || result.meta?.next_page == null || page > maxPages) break
    } while (true)

    return [...new Map(all.map(l => [l.id, l])).values()]
  }
}

// ─── Appointments / Comments / Reminders / Requests (lecture seule) ──────────

/**
 * Ressource Appointments — lecture seule des rendez-vous.
 * @scope ROLE_API_LEAD_READ (lead:read)
 */
export class AppointmentsResource extends AbstractResource<LeadAppointment, AppointmentsListQuery> {
  protected basePath(): string { return '/api/v2/appointments' }
  protected override sortFields(): readonly string[] {
    return ['id', 'created_at', 'updated_at', 'start_time']
  }
}

/**
 * Ressource Comments — lecture seule des commentaires.
 * @scope ROLE_API_LEAD_READ (lead:read)
 */
export class CommentsResource extends AbstractResource<LeadComment, CommentsListQuery> {
  protected basePath(): string { return '/api/v2/comments' }
  protected override sortFields(): readonly string[] { return ['id', 'created_at'] }
}

/**
 * Ressource Reminders — lecture seule des rappels.
 * @scope ROLE_API_LEAD_READ (lead:read)
 */
export class RemindersResource extends AbstractResource<LeadReminder, RemindersListQuery> {
  protected basePath(): string { return '/api/v2/reminders' }
  protected override sortFields(): readonly string[] {
    return ['id', 'created_at', 'updated_at', 'start_time']
  }
}

/**
 * Ressource Requests — lecture seule des demandes/biens rattachés aux leads.
 * @scope ROLE_API_LEAD_READ (lead:read)
 */
export class RequestsResource extends AbstractResource<LeadRequest, RequestsListQuery> {
  protected basePath(): string { return '/api/v2/requests' }
  protected override sortFields(): readonly string[] { return ['id', 'created_at', 'updated_at'] }
}

// ─── Referentials ─────────────────────────────────────────────────────────────

/**
 * Ressource Stores — points de vente accessibles au compte.
 * Endpoints : `GET /api/v2/stores`, `GET /api/v2/stores/{id}`.
 * @scope ROLE_API_REF_READ (ref:read)
 */
export class StoresResource extends AbstractResource<Store, BaseListQuery> {
  protected basePath(): string { return '/api/v2/stores' }
}

const USER_ROLES: readonly UserRole[] = ['admin', 'manager', 'agent', 'virtual']

/**
 * Ressource Users — conseillers et managers.
 * @scope ROLE_API_REF_READ (ref:read)
 */
export class UsersResource extends AbstractResource<User, UsersListQuery> {
  protected basePath(): string { return '/api/v2/users' }
  protected override sortFields(): readonly string[] { return ['id', 'last_name', 'created_at'] }

  override async list(query: UsersListQuery = {}): Promise<PaginatedResponse<User>> {
    if (query.role && !USER_ROLES.includes(query.role)) {
      throw new Error(`"role" must be one of: ${USER_ROLES.join(', ')}. Got: "${query.role}"`)
    }
    return super.list(query)
  }
}

/**
 * Ressource Customers — contacts/prospects rattachés aux leads.
 * Le filtre `phone` s'applique en OR sur `phone` et `other_phone` côté API.
 * @scope ROLE_API_REF_READ (ref:read)
 */
export class CustomersResource extends AbstractResource<Customer, CustomersListQuery> {
  protected basePath(): string { return '/api/v2/customers' }
}

/**
 * Ressource Status — référentiel des statuts et sous-statuts.
 * Les filtres `interest` et `store_id` acceptent une liste CSV.
 * @scope ROLE_API_REF_READ (ref:read)
 */
export class StatusResource extends AbstractResource<StatusEntry, StatusListQuery> {
  protected basePath(): string { return '/api/v2/status' }
}

const TRACKING_CHANNELS: readonly OriginTrackingChannel[] = ['phone', 'email']

/**
 * Ressource Origins — origines configurées sur le compte.
 * @scope ROLE_API_REF_READ (ref:read)
 */
export class OriginsResource extends AbstractResource<Origin, OriginsListQuery> {
  protected basePath(): string { return '/api/v2/origins' }

  override async list(query: OriginsListQuery = {}): Promise<PaginatedResponse<Origin>> {
    if (query.tracking_channel && !TRACKING_CHANNELS.includes(query.tracking_channel)) {
      throw new Error(
        `"tracking_channel" must be one of: ${TRACKING_CHANNELS.join(', ')}. Got: "${query.tracking_channel}"`,
      )
    }
    return super.list(query)
  }
}

/**
 * Ressource AdditionalFields — champs additionnels par agence/intérêt.
 * @scope ROLE_API_REF_READ (ref:read)
 */
export class AdditionalFieldsResource extends AbstractResource<FieldSet, FieldsListQuery> {
  protected basePath(): string { return '/api/v2/additional_fields' }
}

/**
 * Ressource RequestFields — champs de demande par agence/intérêt.
 * @scope ROLE_API_REF_READ (ref:read)
 */
export class RequestFieldsResource extends AbstractResource<FieldSet, FieldsListQuery> {
  protected basePath(): string { return '/api/v2/requests/fields' }
}

// ─── Form (POST /api/v2/form) ────────────────────────────────────────────────

/**
 * Ressource Form — soumission de formulaires publics (POST /api/v2/form).
 * Crée un lead et envoie l'email au(x) destinataire(s).
 * @scope ROLE_API_FORM_WRITE (pas de scope JWT court)
 */
export class FormResource {
  constructor(private readonly client: ScorimmoClient) {}

  async submit(data: FormSubmitPayload): Promise<FormSubmitResponse> {
    for (const required of ['store_id', 'libelle_id', 'to_email', 'origin', 'message'] as const) {
      if (data[required] === undefined || data[required] === null) {
        throw new Error(`submit() requires "${required}" in payload`)
      }
    }
    return this.client.request<FormSubmitResponse>('POST', '/api/v2/form', data)
  }
}

// ─── WebCallbacks (POST /api/v2/webcallbacks) ────────────────────────────────

/**
 * Ressource WebCallbacks — déclenche un appel sortant via l'API webcallback.
 * ATTENTION : n'utilise pas l'authentification Bearer — passe une clé WCB dans le body.
 * @scope aucun (clé WCB en body)
 */
export class WebCallbacksResource {
  constructor(private readonly client: ScorimmoClient) {}

  async launch(key: string, numberToCall: string): Promise<WebCallbackLaunchResponse> {
    if (!key || !numberToCall) {
      throw new Error('launch() requires both "key" and "numberToCall" to be non-empty')
    }
    return this.client.requestUnauthenticated<WebCallbackLaunchResponse>(
      'POST',
      '/api/v2/webcallbacks',
      { key, number_to_call: numberToCall },
    )
  }
}

// ─── Client ───────────────────────────────────────────────────────────────────

interface TokenCache {
  accessToken: string
  expiresAt: Date
}

/**
 * Client HTTP principal de l'API Scorimmo v2.
 *
 * Gère l'authentification JWT (access + refresh token), le renouvellement automatique
 * des tokens expirés et expose toutes les ressources de l'API v2.
 *
 * Authentification par credentials :
 * ```ts
 * const client = new ScorimmoClient({ email: 'api@agence.fr', password: '…' })
 * ```
 *
 * Authentification par refresh token (session persistée, sans identifiants) :
 * ```ts
 * const client = new ScorimmoClient({ refreshToken: persisted })
 * // Après chaque appel, récupérer et re-persister le refresh token courant :
 * const next = client.getRefreshToken()
 * ```
 */
export class ScorimmoClient {
  private readonly baseUrl: string
  private readonly email?: string
  private readonly password?: string
  private refreshToken?: string
  private tokenCache: TokenCache | null = null
  private readonly timeoutMs: number

  readonly leads: LeadsResource
  readonly appointments: AppointmentsResource
  readonly comments: CommentsResource
  readonly reminders: RemindersResource
  readonly requests: RequestsResource
  readonly stores: StoresResource
  readonly users: UsersResource
  readonly customers: CustomersResource
  readonly status: StatusResource
  readonly origins: OriginsResource
  readonly additionalFields: AdditionalFieldsResource
  readonly requestFields: RequestFieldsResource
  readonly form: FormResource
  readonly webCallbacks: WebCallbacksResource

  constructor(config: ScorimmoClientConfig) {
    if (!config.email && !config.refreshToken) {
      throw new Error('ScorimmoClient requires either email+password or a refreshToken.')
    }
    this.baseUrl = (config.baseUrl ?? 'https://pro.scorimmo.com').replace(/\/$/, '')
    this.email = config.email
    this.password = config.password
    this.refreshToken = config.refreshToken
    this.timeoutMs = config.timeoutMs ?? 25_000

    this.leads = new LeadsResource(this)
    this.appointments = new AppointmentsResource(this)
    this.comments = new CommentsResource(this)
    this.reminders = new RemindersResource(this)
    this.requests = new RequestsResource(this)
    this.stores = new StoresResource(this)
    this.users = new UsersResource(this)
    this.customers = new CustomersResource(this)
    this.status = new StatusResource(this)
    this.origins = new OriginsResource(this)
    this.additionalFields = new AdditionalFieldsResource(this)
    this.requestFields = new RequestFieldsResource(this)
    this.form = new FormResource(this)
    this.webCallbacks = new WebCallbacksResource(this)
  }

  // ── Tokens ──────────────────────────────────────────────────────────────────

  /**
   * Retourne un access token valide, en obtenant/renouvelant si nécessaire.
   *
   * Ordre de priorité :
   *  1. Token en cache encore valide
   *  2. Refresh token (échange contre un nouvel access token)
   *  3. Credentials email+password
   *
   * Si le refresh échoue et que les credentials sont disponibles, bascule automatiquement.
   */
  async getToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > new Date()) {
      return this.tokenCache.accessToken
    }

    if (this.refreshToken) {
      try {
        await this.exchangeRefreshToken(this.refreshToken)
        return this.tokenCache!.accessToken
      } catch (e) {
        if (!this.email) throw e
        this.refreshToken = undefined
      }
    }

    if (!this.email || !this.password) {
      throw new ScorimmoAuthError(
        'Cannot authenticate: no valid refresh token and no email/password credentials provided.',
      )
    }

    const res = await this.rawRequest<TokenResponse>('POST', '/api/v2/auth/token', {
      email: this.email,
      password: this.password,
    }, false)

    if (!res.access_token) {
      throw new ScorimmoAuthError('Authentication failed: no access_token in response')
    }

    this.applyTokenResponse(res)
    return this.tokenCache!.accessToken
  }

  /**
   * Retourne le refresh token courant (disponible après le premier appel authentifié).
   * Persistez-le pour réhydrater un client au démarrage suivant.
   */
  getRefreshToken(): string | undefined {
    return this.refreshToken
  }

  /**
   * Échange explicitement un refresh token contre une nouvelle paire de tokens.
   * L'état interne est mis à jour ; les requêtes suivantes utilisent le nouveau token.
   */
  async refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
    return this.exchangeRefreshToken(refreshToken)
  }

  /**
   * Révoque un refresh token spécifique, ou tous les refresh tokens du compte si non fourni.
   */
  async revokeToken(refreshToken?: string): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = refreshToken
      ? { refresh_token: refreshToken }
      : { revoke_all: true }
    return this.rawRequest<Record<string, unknown>>('POST', '/api/v2/auth/revoke', body, false)
  }

  /**
   * Valide l'access token courant et retourne ses métadonnées.
   */
  async validateToken(): Promise<TokenValidateResponse> {
    return this.request<TokenValidateResponse>('GET', '/api/v2/auth/validate')
  }

  private async exchangeRefreshToken(refreshToken: string): Promise<TokenResponse> {
    const res = await this.rawRequest<TokenResponse>('POST', '/api/v2/auth/refresh', {
      refresh_token: refreshToken,
    }, false)

    if (!res.access_token) {
      throw new ScorimmoAuthError('Token refresh failed: no access_token in response')
    }

    this.applyTokenResponse(res)
    return res
  }

  private applyTokenResponse(res: TokenResponse): void {
    this.refreshToken = res.refresh_token ?? this.refreshToken
    this.tokenCache = {
      accessToken: res.access_token,
      // 60s de marge pour éviter les courses au bord de l'expiration.
      expiresAt: new Date(this.resolveExpiryMs(res) - 60_000),
    }
  }

  /**
   * Résout la date d'expiration absolue (ms epoch) depuis la réponse token :
   *  - `expires_at` en Unix seconds (`number`) — convention API v2 principale
   *  - `expires_at` en ISO 8601 (`string`) — compat historique
   *  - repli sur `expires_in` (secondes relatives à maintenant) si `expires_at` manque
   *    ou est illisible
   */
  private resolveExpiryMs(res: TokenResponse): number {
    const raw = res.expires_at
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      // Heuristique : < 1e12 → secondes, sinon millisecondes.
      return raw < 1e12 ? raw * 1000 : raw
    }
    if (typeof raw === 'string' && raw.length > 0) {
      const numeric = Number(raw)
      if (Number.isFinite(numeric) && !/[^0-9]/.test(raw)) {
        return numeric < 1e12 ? numeric * 1000 : numeric
      }
      const ms = Date.parse(raw)
      if (Number.isFinite(ms)) return ms
    }
    if (typeof res.expires_in === 'number' && Number.isFinite(res.expires_in)) {
      return Date.now() + res.expires_in * 1000
    }
    // Dernier recours : forcer une expiration immédiate pour forcer un refresh au prochain appel.
    return Date.now()
  }

  // ── HTTP ────────────────────────────────────────────────────────────────────

  /**
   * Requête authentifiée. Sur 401, invalide le cache et retente une fois avec un token frais.
   */
  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    try {
      return await this.rawRequest<T>(method, path, body, true)
    } catch (e) {
      if (e instanceof ScorimmoApiError && e.statusCode === 401) {
        this.tokenCache = null
        return this.rawRequest<T>(method, path, body, true)
      }
      throw e
    }
  }

  /**
   * Requête sans authentification Bearer (endpoints qui portent leur propre auth dans le body,
   * ex. POST /api/v2/webcallbacks avec sa clé WCB).
   */
  async requestUnauthenticated<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.rawRequest<T>(method, path, body, false)
  }

  private async rawRequest<T>(method: string, path: string, body: unknown, authenticate: boolean): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    }
    if (body !== undefined && body !== null) {
      headers['Content-Type'] = 'application/json'
    }
    if (authenticate) {
      headers['Authorization'] = `Bearer ${await this.getToken()}`
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)

    let res: Response
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      throw new ScorimmoApiError(`HTTP error: ${msg}`, 0)
    } finally {
      clearTimeout(timer)
    }

    const data = await res.json().catch(() => ({})) as { message?: string; code?: string | number }

    if (!res.ok) {
      const message = data.message ?? `HTTP ${res.status}`
      if (!authenticate && res.status === 401) {
        throw new ScorimmoAuthError(message)
      }
      throw new ScorimmoApiError(message, res.status, data.code)
    }

    return data as T
  }
}
