// ─── Client config ────────────────────────────────────────────────────────────

/**
 * Configuration du client Scorimmo. L'un des deux modes d'authentification est requis :
 *  - `email` + `password` : authentification complète (obtient access + refresh tokens)
 *  - `refreshToken`       : session persistée (échange le refresh contre un nouvel access token)
 */
export interface ScorimmoClientConfig {
  /** URL de base de l'instance Scorimmo. Défaut : `https://pro.scorimmo.com` */
  baseUrl?: string
  /** Email du compte API v2 (identifiant) */
  email?: string
  /** Mot de passe du compte API v2 */
  password?: string
  /** Refresh token issu d'une session précédente (rotation à chaque échange) */
  refreshToken?: string
  /** Timeout HTTP en millisecondes. Défaut : 25 000. */
  timeoutMs?: number
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: 'Bearer'
  expires_in: number
  /**
   * Date d'expiration de l'access token. Peut être renvoyée par l'API sous forme
   * de timestamp Unix (secondes, `number`) ou de chaîne ISO 8601 (`string`).
   * Absente sur certaines réponses — dans ce cas, `expires_in` est utilisé comme repli.
   */
  expires_at?: string | number
  refresh_expires_in?: number
  refresh_expires_at?: string | number
}

export interface TokenValidateResponse {
  version: string
  status: string
  authenticated: boolean
  scopes: string[]
  stores_id: number[]
  interests: string[]
}

// ─── Pagination ───────────────────────────────────────────────────────────────

export interface PaginationMeta {
  total_items: number
  current_page: number
  limit: number
  total_pages: number
  previous_page: number | null
  next_page: number | null
}

export interface PaginatedResponse<T> {
  data: T[]
  meta: PaginationMeta
}

// ─── Common query base ────────────────────────────────────────────────────────

export interface BaseListQuery {
  page?: number
  /** 1–100 ; défaut : 10. */
  limit?: number
  /** Format `field:asc` ou `field:desc`. */
  sort?: string
}

// ─── Leads ────────────────────────────────────────────────────────────────────

export type LeadInterest = 'TRANSACTION' | 'LOCATION' | 'GESTION' | 'ADMINISTRATIF' | (string & {})
export type LeadContactType = 'physical' | 'phone' | 'digital' | (string & {})
export type LeadPurpose =
  | 'Achat' | 'Location' | 'Bailleur' | 'Vente' | 'Recherche' | 'Locataire' | 'Non renseigné'
  | (string & {})

export type LeadInclude =
  | 'customer' | 'seller' | 'appointments' | 'reminders' | 'requests' | 'comments'

export interface LeadCustomer {
  id?: number
  title?: string
  first_name?: string
  last_name?: string
  email?: string
  phone?: string
  other_phone?: string
  zip_code?: string
  city?: string
  pro?: boolean
  legal_name?: string
  former?: boolean
}

export interface LeadSeller {
  id?: number
  first_name?: string
  last_name?: string
  email?: string
  is_virtual?: boolean
}

export interface Lead {
  id: number
  status?: string
  sub_status?: string
  interest: LeadInterest
  origin?: string
  store_id: number
  seller_id?: number
  contact_type?: LeadContactType
  seller_present_on_creation?: boolean
  transfered?: boolean
  external_lead_id?: string
  external_customer_id?: number
  created_at: string
  updated_at?: string
  closed_date?: string | null
  seller_assigned_date?: string | null
  seller_first_action_date?: string | null
  anonymized_at?: string | null
  relaunch?: boolean
  reassigned?: boolean
  nb_recall?: number

  customer_id?: number
  customer?: LeadCustomer

  request_ids?: number[]
  requests?: LeadRequest[]

  reminder_ids?: number[]
  reminders?: LeadReminder[]

  appointment_ids?: number[]
  appointments?: LeadAppointment[]

  comment_ids?: number[]
  comments?: LeadComment[]

  additional_fields?: Record<string, unknown>
}

/**
 * Filtres et paramètres acceptés par `GET /api/v2/leads`.
 * Les filtres de date supportent les opérateurs bracket `[gte]`, `[lte]`, `[eq]`.
 */
export interface LeadsListQuery extends BaseListQuery {
  include?: string
  ids?: string
  seller_id?: number
  store_id?: number
  status?: string
  substatus?: string
  interest?: string
  origin?: string
  contact_type?: LeadContactType
  purpose?: LeadPurpose
  customer_first_name?: string
  customer_last_name?: string
  'customer.email'?: string
  'customer.phone'?: string
  external_lead_id?: string
  requests_reference?: string
  'created_at[eq]'?: string
  'created_at[gte]'?: string
  'created_at[lte]'?: string
  'updated_at[eq]'?: string
  'updated_at[gte]'?: string
  'updated_at[lte]'?: string
}

export interface LeadUpdatePayload {
  seller_id?: number
  origin?: string
  external_lead_id?: string
  external_customer_id?: number
  additional_fields?: Record<string, unknown>
}

// ─── Appointments ─────────────────────────────────────────────────────────────

export type AppointmentDetail = 'Estimation' | 'Découverte' | 'Visite' | 'Suivi' | 'Proposition' | 'Signature'

export interface LeadAppointment {
  id: number
  lead_id: number
  created_at: string
  updated_at?: string
  start_time: string
  type?: string
  location?: string
  canceled?: boolean
  comment?: string
}

export interface AppointmentsListQuery extends BaseListQuery {
  ids?: string
  lead_id?: number
  'created_at[eq]'?: string
  'created_at[gte]'?: string
  'created_at[lte]'?: string
  'updated_at[gte]'?: string
  'updated_at[lte]'?: string
  'start_time[eq]'?: string
  'start_time[gte]'?: string
  'start_time[lte]'?: string
}

// ─── Comments ─────────────────────────────────────────────────────────────────

export interface LeadComment {
  id: number
  lead_id: number
  content: string
  created_at: string
}

export interface CommentsListQuery extends BaseListQuery {
  ids?: string
  lead_id?: number
  'created_at[eq]'?: string
  'created_at[gte]'?: string
  'created_at[lte]'?: string
}

// ─── Reminders ────────────────────────────────────────────────────────────────

export type ReminderDetail = 'offer' | 'recontact'

export interface LeadReminder {
  id: number
  lead_id: number
  /** Date/heure planifiée du rappel — aligné sur `start_time` côté API et webhook. */
  start_time: string
  detail?: ReminderDetail
  comment?: string
  canceled?: boolean
  created_at: string
  updated_at?: string
}

export interface RemindersListQuery extends BaseListQuery {
  ids?: string
  lead_id?: number
  'created_at[eq]'?: string
  'created_at[gte]'?: string
  'created_at[lte]'?: string
  'updated_at[gte]'?: string
  'updated_at[lte]'?: string
  'start_time[eq]'?: string
  'start_time[gte]'?: string
  'start_time[lte]'?: string
}

// ─── Requests (biens recherchés/proposés) ─────────────────────────────────────

export interface LeadRequest {
  id: number
  lead_id: number
  reference?: string
  [key: string]: unknown
}

export interface RequestsListQuery extends BaseListQuery {
  ids?: string
  lead_id?: number
  reference?: string
  'created_at[eq]'?: string
  'created_at[gte]'?: string
  'created_at[lte]'?: string
  'updated_at[gte]'?: string
  'updated_at[lte]'?: string
}

// ─── Referentials : stores / users / customers / status / origins / fields ────

export interface Store {
  id: number
  name: string
  city?: string
  phone?: string
  email?: string
  account_manager?: string
  interests: string[]
}

export type UserRole = 'admin' | 'manager' | 'agent' | 'virtual'

export interface User {
  id: number
  first_name: string
  last_name: string
  email: string
  interests: string[]
  is_virtual?: boolean
}

export interface UsersListQuery extends BaseListQuery {
  store_id?: number
  interest?: string
  role?: UserRole
}

export interface Customer {
  id: number
  title?: string
  first_name?: string
  last_name?: string
  email?: string
  phone?: string
  other_phone?: string
  zip_code?: string
  city?: string
  pro?: boolean
  legal_name?: string
  former?: boolean
}

export interface CustomersListQuery extends BaseListQuery {
  search?: string
  email?: string
  phone?: string
}

export interface StatusEntry {
  label: string
  sub_status: string[] | null
}

export interface StatusListQuery extends BaseListQuery {
  ids?: string
  /** CSV — ex. `TRANSACTION,LOCATION` */
  interest?: string
  /** CSV — ex. `1,2,3` */
  store_id?: string
}

export type OriginTrackingChannel = 'phone' | 'email'

export interface OriginTracking {
  channel: OriginTrackingChannel
  value: string
}

export interface Origin {
  label: string
  tracking?: OriginTracking[]
}

export interface OriginsListQuery extends BaseListQuery {
  store_id?: number
  has_tracking?: boolean
  tracking_channel?: OriginTrackingChannel
  /** `tracking` pour inclure les traceurs. */
  include?: string
}

export interface FieldDefinition {
  label: string
  type: string
  mandatory: boolean
  description?: string
  choices?: string[]
}

export interface FieldSet {
  store_id: number
  interest: string
  fields: FieldDefinition[]
}

export interface FieldsListQuery extends BaseListQuery {
  store_id?: number
  interest?: string
}

// ─── Form (soumission formulaire public) ──────────────────────────────────────

export interface FormCustomer {
  civility?: 'M.' | 'Mme'
  first_name?: string
  last_name?: string
  email?: string
  phone?: string
}

export interface FormSubmitPayload {
  store_id: number
  libelle_id: number
  to_email: string | string[]
  origin: string
  message: string
  subject?: string
  customer?: FormCustomer
  requests?: Array<Record<string, unknown>>
  additional_fields?: Array<Record<string, unknown>>
  external_lead_id?: string
}

export interface FormSubmitResponse {
  status: number
  message: string
  id: number
  store_id: number
  libelle_id: number
  origin: string
}

// ─── WebCallbacks ─────────────────────────────────────────────────────────────

export interface WebCallbackLaunchResponse {
  results: string[]
  information: number
}

// ─── Webhook events (payloads envoyés par Scorimmo) ───────────────────────────

/**
 * Statut d'un lead clôturé (libellés retournés dans le payload `closure_lead`).
 */
export type ClosureStatus = 'Succès' | 'Fermé' | "Fermé par l'opérateur"

export interface WebhookNewLead {
  event: 'new_lead'
  id: number
  store_id: number
  interest: string
  origin?: string
  status?: string
  contact_type?: LeadContactType
  seller_present_on_creation?: boolean
  transfered?: boolean
  external_lead_id?: string
  external_customer_id?: number
  created_at: string
  customer?: LeadCustomer
  seller?: LeadSeller
  requests?: Array<Record<string, unknown>>
  additional_fields?: Record<string, unknown>
  comments?: Array<{ content: string; created_at?: string }> | null
  close_reason?: string
}

export interface WebhookUpdateLead {
  event: 'update_lead'
  id: number
  updated_at: string
  store_id?: number
  customer?: Partial<LeadCustomer>
  seller?: Partial<LeadSeller>
  requests?: Array<Record<string, unknown>>
  additional_fields?: Record<string, unknown>
  [key: string]: unknown
}

export interface WebhookNewComment {
  event: 'new_comment'
  lead_id: number
  comment: string
  created_at: string
  external_lead_id?: string
}

export interface WebhookNewRdv {
  event: 'new_rdv'
  lead_id: number
  created_at: string
  start_time: string
  location?: string
  detail?: AppointmentDetail | null
  comment?: string | null
  external_lead_id?: string
}

export interface WebhookNewReminder {
  event: 'new_reminder'
  lead_id: number
  created_at: string
  start_time: string
  detail?: ReminderDetail
  comment?: string | null
  external_lead_id?: string
}

export interface WebhookClosureLead {
  event: 'closure_lead'
  lead_id: number
  status: ClosureStatus | (string & {})
  close_reason?: string
  external_lead_id?: string
}

/**
 * Événements V2 connus + catch-all `webhook.<name>` pour les événements futurs.
 * Le champ `event` du payload garde le nom interne ; le header X-Scorimmo-Event porte
 * la version sémantique (`lead.created`, `webhook.<name>`, etc.).
 */
export type WebhookEvent =
  | WebhookNewLead
  | WebhookUpdateLead
  | WebhookNewComment
  | WebhookNewRdv
  | WebhookNewReminder
  | WebhookClosureLead
  | { event: string;[key: string]: unknown }

/**
 * Correspondance `event` (payload) ↔ `X-Scorimmo-Event` (header sémantique).
 */
export type SemanticWebhookEvent =
  | 'lead.created'
  | 'lead.updated'
  | 'lead.closed'
  | 'lead.comment_added'
  | 'lead.appointment_created'
  | 'lead.reminder_created'
  | `webhook.${string}`

// ─── Webhook config ───────────────────────────────────────────────────────────

/**
 * Configuration du récepteur de webhook Scorimmo.
 *
 * Les deux champs sont optionnels : si `signatureSecret` est absent, aucune vérification
 * HMAC n'est effectuée (l'authentification peut être déportée sur le serveur : HTTP Basic
 * dans l'URL, IP whitelist, mTLS, etc.).
 */
export interface ScorimmoWebhookConfig {
  /** Secret partagé HMAC-SHA256. Absent → aucune vérification par le SDK. */
  signatureSecret?: string
  /** Nom du header portant la signature. Défaut : `X-Signature-256`. */
  signatureHeader?: string
  /**
   * Logger optionnel appelé quand `dispatch()` ne trouve aucun handler nommé ni `onUnknown`.
   * Interface minimale compatible avec `console`, `pino`, `winston`, etc.
   * Absent → silent-drop (comportement historique).
   */
  logger?: {
    warn: (message: string, context?: unknown) => void
  }
}
