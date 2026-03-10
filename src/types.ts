// ─── Lead ────────────────────────────────────────────────────────────────────

export interface LeadProperty {
  id: number
  type: string
  price?: number
  area?: number
  reference?: string
  address?: string
  link?: string
}

export interface LeadCustomField {
  question: string
  answer: string
}

export interface LeadComment {
  id: number
  content: string
  created_at: string
  breadcrumb: boolean
}

export interface LeadCustomer {
  title?: 'M.' | 'Mme'
  first_name?: string
  last_name?: string
  email?: string
  phone?: string
  other_phone?: string
  zip_code?: string
  city?: string
}

export interface LeadSeller {
  id?: number
  first_name?: string
  last_name?: string
  email?: string
}

export type LeadInterest =
  | 'TRANSACTION'
  | 'LOCATION'
  | 'GESTION'
  | 'ADMINISTRATIF'
  | string

export type LeadContactType = 'physical' | 'phone' | 'digital' | string

export interface Lead {
  id: number
  store_id: number
  created_at: string
  updated_at?: string
  status?: string
  origin?: string
  interest: LeadInterest
  purpose?: string
  contact_type?: LeadContactType
  seller_present_on_creation?: boolean
  transfered?: boolean
  external_lead_id?: string
  external_customer_id?: number
  close_reason?: string

  // Optional lead flags
  residence_type?: string
  funding_type?: string
  have_residence_to_sell?: boolean
  has_lot?: boolean
  work_service?: boolean
  accounting?: boolean
  diverse?: boolean

  // Administrative specific
  request?: string
  other_request?: string

  customer?: LeadCustomer
  seller?: LeadSeller
  properties?: LeadProperty[]
  custom_fields?: LeadCustomField[]
  comments?: LeadComment[]
}

// ─── Webhook events ───────────────────────────────────────────────────────────

export interface WebhookNewLead extends Lead {
  event: 'new_lead'
}

export interface WebhookUpdateLead {
  event: 'update_lead'
  id: number
  updated_at: string
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
  detail?: string
  comment?: string
  external_lead_id?: string
}

export interface WebhookNewReminder {
  event: 'new_reminder'
  lead_id: number
  created_at: string
  start_time: string
  detail?: string
  comment?: string
  external_lead_id?: string
}

export interface WebhookClosureLead {
  event: 'closure_lead'
  lead_id: number
  status: string
  close_reason?: string
  external_lead_id?: string
}

export type WebhookEvent =
  | WebhookNewLead
  | WebhookUpdateLead
  | WebhookNewComment
  | WebhookNewRdv
  | WebhookNewReminder
  | WebhookClosureLead

// ─── API ──────────────────────────────────────────────────────────────────────

export interface LeadsListResult {
  results: Lead[]
  total: number
  page: number
  limit: number
}

export type LeadSearchKey =
  | 'id'
  | 'customer_firstname'
  | 'customer_lastname'
  | 'email'
  | 'phone'
  | 'origin'
  | 'interest'
  | 'seller_firstname'
  | 'seller_lastname'
  | 'seller_id'
  | 'created_at'
  | 'status'
  | 'closed_date'
  | 'updated_at'
  | 'external_lead_id'
  | 'external_customer_id'
  | 'reference'

export interface LeadsQuery {
  /** Global search across all fields */
  search?: string | Partial<Record<LeadSearchKey, string>>
  order?: 'asc' | 'desc'
  orderby?: LeadSearchKey
  limit?: number
  page?: number
}

// ─── Config ───────────────────────────────────────────────────────────────────

export interface ScorimmoClientConfig {
  /** Base URL of the Scorimmo instance, e.g. "https://app.scorimmo.com" */
  baseUrl: string
  username: string
  password: string
}

export interface ScorimmoWebhookConfig {
  /**
   * The custom header key configured on your Point of Sale in Scorimmo.
   * Example: "X-Api-Key"
   */
  headerKey: string
  /**
   * The expected header value (secret).
   */
  headerValue: string
}
