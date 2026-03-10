import { describe, it, expect, jest } from '@jest/globals'
import { ScorimmoWebhook, WebhookAuthError, WebhookValidationError } from '../webhook.js'

const config = { headerKey: 'X-Api-Key', headerValue: 'super-secret' }
const webhook = new ScorimmoWebhook(config)

const validHeaders = { 'x-api-key': 'super-secret' }

const newLeadPayload = {
  event: 'new_lead',
  id: 42,
  store_id: 1,
  created_at: '2024-06-01 10:00:00',
  interest: 'TRANSACTION',
  customer: { first_name: 'Jean', last_name: 'Dupont', phone: '0600000000' },
  properties: [{ id: 1, type: 'Maison', price: 350000 }],
}

describe('ScorimmoWebhook.parse()', () => {
  it('parses a valid new_lead payload', () => {
    const event = webhook.parse(validHeaders, newLeadPayload)
    expect(event.event).toBe('new_lead')
    expect((event as typeof newLeadPayload).id).toBe(42)
  })

  it('throws WebhookAuthError on wrong header value', () => {
    expect(() =>
      webhook.parse({ 'x-api-key': 'wrong' }, newLeadPayload),
    ).toThrow(WebhookAuthError)
  })

  it('throws WebhookAuthError on missing header', () => {
    expect(() => webhook.parse({}, newLeadPayload)).toThrow(WebhookAuthError)
  })

  it('throws WebhookValidationError on missing event field', () => {
    expect(() =>
      webhook.parse(validHeaders, { id: 1 }),
    ).toThrow(WebhookValidationError)
  })

  it('throws WebhookValidationError on non-object body', () => {
    expect(() => webhook.parse(validHeaders, 'bad')).toThrow(WebhookValidationError)
  })

  it('is case-insensitive on header key', () => {
    const upperHeaders = { 'X-API-KEY': 'super-secret' }
    const event = webhook.parse(upperHeaders, newLeadPayload)
    expect(event.event).toBe('new_lead')
  })
})

describe('ScorimmoWebhook.dispatch()', () => {
  it('calls onNewLead handler', async () => {
    const handler = jest.fn<() => void>()
    const event = webhook.parse(validHeaders, newLeadPayload)
    await webhook.dispatch(event, { onNewLead: handler })
    expect(handler).toHaveBeenCalledWith(event)
  })

  it('calls onClosureLead handler', async () => {
    const handler = jest.fn<() => void>()
    const payload = { event: 'closure_lead', lead_id: 5, status: 'Fermé', close_reason: 'Vente' }
    const event = webhook.parse(validHeaders, payload)
    await webhook.dispatch(event, { onClosureLead: handler })
    expect(handler).toHaveBeenCalledWith(event)
  })

  it('calls onUnknown for unrecognised events', async () => {
    const handler = jest.fn<() => void>()
    const payload = { event: 'future_event', lead_id: 1 }
    const event = webhook.parse(validHeaders, payload)
    await webhook.dispatch(event, { onUnknown: handler })
    expect(handler).toHaveBeenCalledWith(event)
  })

  it('does not throw if no handler is registered for an event', async () => {
    const event = webhook.parse(validHeaders, newLeadPayload)
    await expect(webhook.dispatch(event, {})).resolves.toBeUndefined()
  })
})
