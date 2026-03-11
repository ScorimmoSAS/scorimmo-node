import type {
  ScorimmoClientConfig,
  Lead,
  LeadsListResult,
  LeadsQuery,
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
    this.baseUrl = (config.baseUrl ?? 'https://pro.scorimmo.com').replace(/\/$/, '')
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
      token_expirate_at: number | string
    }

    // The API returns token_expirate_at as a Unix timestamp (seconds).
    // Multiply by 1000 to convert to milliseconds for the Date constructor.
    const expiresMs = typeof data.token_expirate_at === 'number'
      ? data.token_expirate_at * 1000
      : new Date(data.token_expirate_at).getTime()

    this.tokenCache = {
      token: data.token,
      // Expire 60 seconds early to avoid edge cases
      expiresAt: new Date(expiresMs - 60_000),
    }

    return this.tokenCache.token
  }

  /**
   * Authenticated JSON request.
   * On a 401 the token cache is cleared and the request is retried once with a fresh token.
   */
  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    try {
      return await this._rawRequest<T>(path, options)
    } catch (e) {
      if (e instanceof ScorimmoApiError && e.statusCode === 401) {
        // Token expired server-side: invalidate cache and retry once with a fresh token
        this.tokenCache = null
        return this._rawRequest<T>(path, options)
      }
      throw e
    }
  }

  private async _rawRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
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
   * Automatically handles pagination and returns a flat deduplicated array.
   *
   * @param storeId  Restrict to a specific store (/api/stores/{id}/leads); undefined = global
   * @param maxPages Safety cap on API pages fetched (default 100 → 5 000 leads)
   *
   * @example
   * const leads = await client.leads.since('2024-06-01T00:00:00')
   * const leads = await client.leads.since(new Date(), 'created_at', 100, 776)
   */
  async since(
    date: string | Date,
    field: 'created_at' | 'updated_at' = 'created_at',
    maxPages = 100,
    storeId?: number,
  ): Promise<Lead[]> {
    const iso = date instanceof Date ? date.toISOString().slice(0, 19).replace('T', ' ') : date
    const allLeads: Lead[] = []
    let page = 1

    while (true) {
      const query = {
        search: { [field]: `>${iso}` } as Record<string, string>,
        order: 'asc' as const,
        orderby: field,
        limit: 50,
        page,
      }

      const result = storeId !== undefined
        ? await this.listByStore(storeId, query)
        : await this.list(query)

      const results: Lead[] = result.results ?? []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const totalItems: number = (result as any).informations?.[0]?.informations?.total_items ?? 0

      allLeads.push(...results)
      page++

      if (allLeads.length >= totalItems || results.length === 0 || page > maxPages) break
    }

    // Deduplicate by id — a lead can appear on two consecutive pages if it is
    // created or updated while pagination is in progress (boundary shift).
    return [...new Map(allLeads.map(l => [l.id, l])).values()]
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
