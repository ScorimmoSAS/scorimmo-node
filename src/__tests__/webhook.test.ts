import { describe, it, expect, jest } from '@jest/globals'
import { createHmac } from 'node:crypto'
import { ScorimmoWebhook, WebhookAuthError, WebhookValidationError } from '../webhook.js'

const SECRET = 'shared-secret-abc'

const newLeadPayload = {
  event: 'new_lead',
  id: 42,
  store_id: 1,
  created_at: '2026-06-01 10:00:00',
  interest: 'TRANSACTION',
  customer: { first_name: 'Jean', last_name: 'Dupont' },
}
const newLeadRaw = JSON.stringify(newLeadPayload)

function sign(body: string, secret = SECRET): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
}

// ─── Construction ─────────────────────────────────────────────────────────────

describe('ScorimmoWebhook — construction', () => {
  it('accepts no secret (verification disabled)', () => {
    const w = new ScorimmoWebhook()
    expect(w.verifiesSignature()).toBe(false)
  })

  it('accepts a HMAC secret', () => {
    const w = new ScorimmoWebhook({ signatureSecret: SECRET })
    expect(w.verifiesSignature()).toBe(true)
  })

  it('treats empty-string secret as unverified', () => {
    const w = new ScorimmoWebhook({ signatureSecret: '' })
    expect(w.verifiesSignature()).toBe(false)
  })
})

// ─── No-secret mode ───────────────────────────────────────────────────────────

describe('ScorimmoWebhook — no secret', () => {
  const w = new ScorimmoWebhook()

  it('parses without checking signature', () => {
    const event = w.parse({}, newLeadRaw)
    expect(event.event).toBe('new_lead')
    expect((event as typeof newLeadPayload).id).toBe(42)
  })

  it('accepts a pre-parsed object body', () => {
    const event = w.parse({}, newLeadPayload)
    expect(event.event).toBe('new_lead')
  })

  it('still validates JSON structure', () => {
    expect(() => w.parse({}, 'not-json')).toThrow(WebhookValidationError)
  })

  it('still requires the event field', () => {
    expect(() => w.parse({}, JSON.stringify({ id: 1 }))).toThrow(WebhookValidationError)
  })
})

// ─── HMAC mode ────────────────────────────────────────────────────────────────

describe('ScorimmoWebhook — HMAC', () => {
  const w = new ScorimmoWebhook({ signatureSecret: SECRET })

  it('parses a valid HMAC-signed payload', () => {
    const event = w.parse({ 'x-signature-256': sign(newLeadRaw) }, newLeadRaw)
    expect(event.event).toBe('new_lead')
  })

  it('rejects invalid signature', () => {
    expect(() =>
      w.parse({ 'x-signature-256': 'sha256=deadbeef' }, newLeadRaw),
    ).toThrow(WebhookAuthError)
  })

  it('rejects missing signature header', () => {
    expect(() => w.parse({}, newLeadRaw)).toThrow(WebhookAuthError)
  })

  it('rejects a pre-parsed body (signature requires raw string)', () => {
    expect(() =>
      w.parse({ 'x-signature-256': sign(newLeadRaw) }, newLeadPayload),
    ).toThrow(WebhookAuthError)
  })

  it('accepts custom signature header name', () => {
    const custom = new ScorimmoWebhook({ signatureSecret: SECRET, signatureHeader: 'X-Custom-Sig' })
    const event = custom.parse({ 'x-custom-sig': sign(newLeadRaw) }, newLeadRaw)
    expect(event.event).toBe('new_lead')
  })

  it('accepts signature without sha256= prefix', () => {
    const raw = createHmac('sha256', SECRET).update(newLeadRaw).digest('hex')
    const event = w.parse({ 'x-signature-256': raw }, newLeadRaw)
    expect(event.event).toBe('new_lead')
  })

  it('is case-insensitive on the header key', () => {
    const event = w.parse({ 'X-SIGNATURE-256': sign(newLeadRaw) }, newLeadRaw)
    expect(event.event).toBe('new_lead')
  })

  it('accepts header value as string[] (Node-style)', () => {
    const event = w.parse({ 'x-signature-256': [sign(newLeadRaw)] }, newLeadRaw)
    expect(event.event).toBe('new_lead')
  })
})

// ─── verifySignature helper ───────────────────────────────────────────────────

describe('ScorimmoWebhook.verifySignature()', () => {
  const w = new ScorimmoWebhook({ signatureSecret: SECRET })

  it('returns true for a matching signature', () => {
    expect(w.verifySignature(newLeadRaw, sign(newLeadRaw), SECRET)).toBe(true)
  })

  it('returns true for a matching signature without prefix', () => {
    const raw = createHmac('sha256', SECRET).update(newLeadRaw).digest('hex')
    expect(w.verifySignature(newLeadRaw, raw, SECRET)).toBe(true)
  })

  it('returns false for a wrong signature', () => {
    expect(w.verifySignature(newLeadRaw, 'sha256=nope', SECRET)).toBe(false)
  })

  it('returns false for a tampered body', () => {
    expect(w.verifySignature(newLeadRaw + 'x', sign(newLeadRaw), SECRET)).toBe(false)
  })

  it('returns false on length mismatch (avoids timingSafeEqual throw)', () => {
    expect(w.verifySignature(newLeadRaw, 'sha256=', SECRET)).toBe(false)
  })
})

// ─── Dispatch ─────────────────────────────────────────────────────────────────

describe('ScorimmoWebhook.dispatch()', () => {
  const w = new ScorimmoWebhook({ signatureSecret: SECRET })

  it('calls the matching handler', async () => {
    const handler = jest.fn<() => void>()
    const event = w.parse({ 'x-signature-256': sign(newLeadRaw) }, newLeadRaw)
    await w.dispatch(event, { onNewLead: handler })
    expect(handler).toHaveBeenCalledWith(event)
  })

  it('calls onUnknown for future events', async () => {
    const handler = jest.fn<() => void>()
    const body = JSON.stringify({ event: 'future_event', lead_id: 1 })
    const event = w.parse({ 'x-signature-256': sign(body) }, body)
    await w.dispatch(event, { onUnknown: handler })
    expect(handler).toHaveBeenCalledWith(event)
  })

  it('does not throw when no handler matches', async () => {
    const event = w.parse({ 'x-signature-256': sign(newLeadRaw) }, newLeadRaw)
    await expect(w.dispatch(event, {})).resolves.toBeUndefined()
  })

  it('calls logger.warn when no handler nor onUnknown is registered', async () => {
    const warn = jest.fn<(msg: string, ctx?: unknown) => void>()
    const withLogger = new ScorimmoWebhook({ signatureSecret: SECRET, logger: { warn } })
    const body = JSON.stringify({ event: 'future_event', lead_id: 1 })
    const event = withLogger.parse({ 'x-signature-256': sign(body) }, body)
    await withLogger.dispatch(event, {})
    expect(warn).toHaveBeenCalledWith('scorimmo webhook: no handler for event', { event: 'future_event' })
  })

  it('does not call logger.warn when onUnknown catches the event', async () => {
    const warn = jest.fn<(msg: string, ctx?: unknown) => void>()
    const onUnknown = jest.fn<() => void>()
    const withLogger = new ScorimmoWebhook({ signatureSecret: SECRET, logger: { warn } })
    const body = JSON.stringify({ event: 'future_event', lead_id: 1 })
    const event = withLogger.parse({ 'x-signature-256': sign(body) }, body)
    await withLogger.dispatch(event, { onUnknown })
    expect(onUnknown).toHaveBeenCalledTimes(1)
    expect(warn).not.toHaveBeenCalled()
  })

  it('handle() parses and dispatches in one call', async () => {
    const handler = jest.fn<() => void>()
    await w.handle({ 'x-signature-256': sign(newLeadRaw) }, newLeadRaw, { onNewLead: handler })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('handle() propagates WebhookAuthError on bad signature (no handler called)', async () => {
    const handler = jest.fn<() => void>()
    await expect(
      w.handle({ 'x-signature-256': 'sha256=deadbeef' }, newLeadRaw, { onNewLead: handler }),
    ).rejects.toThrow(WebhookAuthError)
    expect(handler).not.toHaveBeenCalled()
  })
})

// ─── Header helpers ───────────────────────────────────────────────────────────

describe('ScorimmoWebhook — header helpers', () => {
  const w = new ScorimmoWebhook()

  it('reads X-Scorimmo-Event case-insensitively', () => {
    expect(w.getSemanticEvent({ 'X-Scorimmo-Event': 'lead.created' })).toBe('lead.created')
    expect(w.getSemanticEvent({ 'x-scorimmo-event': 'webhook.some_future' })).toBe('webhook.some_future')
    expect(w.getSemanticEvent({})).toBeNull()
  })

  it('reads X-Scorimmo-Version (date format)', () => {
    expect(w.getApiVersion({ 'X-Scorimmo-Version': '2026-04-20' })).toBe('2026-04-20')
    expect(w.getApiVersion({})).toBeNull()
  })

  it('treats empty header value as null', () => {
    expect(w.getSemanticEvent({ 'x-scorimmo-event': '' })).toBeNull()
    expect(w.getApiVersion({ 'x-scorimmo-version': '' })).toBeNull()
  })
})
