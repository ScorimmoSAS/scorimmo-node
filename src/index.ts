export { ScorimmoClient, ScorimmoApiError, ScorimmoAuthError } from './client.js'
export { ScorimmoWebhook, WebhookAuthError, WebhookValidationError } from './webhook.js'
export type {
  // Config
  ScorimmoClientConfig,
  ScorimmoWebhookConfig,
  // Lead
  Lead,
  LeadCustomer,
  LeadSeller,
  LeadProperty,
  LeadCustomField,
  LeadComment,
  LeadInterest,
  LeadContactType,
  LeadsListResult,
  LeadsQuery,
  CreateLeadPayload,
  UpdateLeadPayload,
  // Webhook events
  WebhookEvent,
  WebhookNewLead,
  WebhookUpdateLead,
  WebhookNewComment,
  WebhookNewRdv,
  WebhookNewReminder,
  WebhookClosureLead,
} from './types.js'
export type { WebhookHandlers } from './webhook.js'
