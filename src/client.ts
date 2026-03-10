import type {
  ScorimmoClientConfig,
  Lead,
  LeadsListResult,
  LeadsQuery,
  CreateLeadPayload,
  UpdateLeadPayload,
} from './types.js'

interface TokenCache {
  token: string
  expiresAt: Date
}

export class ScorimmoClient {
  private readonly baseUrl: string
  private readonly username: string
  private readonly password: string
  private tokenCache: TokenCache | null = null

  readonly leads: LeadsResource

  constructor(config: ScorimmoClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
    this.username = config.username
    this.password = config.password
    this.leads = new LeadsResource(this)
  }

  /**
   * Returns a valid JWT token, fetching a new one if expired or not yet set.
   */
  async getToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > new Date()) {
      return this.tokenCache.token
    }

    const res = await fetch(`${this.baseUrl}/api/login_check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: this.username, password: this.password }),
    })

    if (!res.ok) {
      throw new ScorimmoAuthError(`Authentication failed: ${res.status} ${res.statusText}`)
    }

    const data = (await res.json()) as {
      token: string
      token_duration: number
      token_expirate_at: string
    }

    this.tokenCache = {
      token: data.token,
      // Expire 60 seconds early to avoid edge cases
      expiresAt: new Date(new Date(data.token_expirate_at).getTime() - 60_000),
    }

    return this.tokenCache.token
  }

  /**
   * Low-level authenticated request. Handles token injection and error parsing.
   */
  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = await this.getToken()

    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { code?: number; message?: string }
      throw new ScorimmoApiError(
        body.message ?? res.statusText,
        res.status,
        body.code,
      )
    }

    return res.json() as Promise<T>
  }
}

// ─── Leads resource ───────────────────────────────────────────────────────────

class LeadsResource {
  constructor(private readonly client: ScorimmoClient) {}

  /**
   * Fetch a single lead by ID.
   */
  async get(id: number): Promise<Lead> {
    return this.client.request<Lead>(`/api/lead/${id}`)
  }

  /**
   * List leads with optional filtering, sorting and pagination.
   */
  async list(query: LeadsQuery = {}): Promise<LeadsListResult> {
    const params = buildQueryString(query)
    return this.client.request<LeadsListResult>(`/api/leads${params ? `?${params}` : ''}`)
  }

  /**
   * Fetch all leads created or updated after a given date.
   * Automatically handles pagination and returns a flat array.
   *
   * @example
   * const leads = await client.leads.since('2024-06-01T00:00:00')
   */
  async since(date: string | Date, field: 'created_at' | 'updated_at' = 'created_at'): Promise<Lead[]> {
    const iso = date instanceof Date ? date.toISOString().slice(0, 19).replace('T', ' ') : date
    const allLeads: Lead[] = []
    let page = 1

    while (true) {
      const result = await this.list({
        search: { [field]: `>${iso}` } as Record<string, string>,
        order: 'asc',
        orderby: field,
        limit: 50,
        page,
      })

      allLeads.push(...result.results)

      if (allLeads.length >= result.total || result.results.length === 0) {
        break
      }

      page++
    }

    return allLeads
  }

  /**
   * List leads for a specific store.
   */
  async listByStore(storeId: number, query: LeadsQuery = {}): Promise<LeadsListResult> {
    const params = buildQueryString(query)
    return this.client.request<LeadsListResult>(
      `/api/stores/${storeId}/leads${params ? `?${params}` : ''}`,
    )
  }

  /**
   * Create a new lead.
   */
  async create(payload: CreateLeadPayload): Promise<Lead> {
    return this.client.request<Lead>('/api/lead', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }

  /**
   * Update an existing lead.
   */
  async update(id: number, payload: UpdateLeadPayload): Promise<Lead> {
    return this.client.request<Lead>(`/api/lead/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildQueryString(query: LeadsQuery): string {
  const parts: string[] = []

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue

    if (key === 'search' && typeof value === 'object') {
      for (const [searchKey, searchValue] of Object.entries(value)) {
        parts.push(`search[${encodeURIComponent(searchKey)}]=${encodeURIComponent(String(searchValue))}`)
      }
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    }
  }

  return parts.join('&')
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class ScorimmoApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly apiCode?: number,
  ) {
    super(message)
    this.name = 'ScorimmoApiError'
  }
}

export class ScorimmoAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScorimmoAuthError'
  }
}
