import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { Logger } from './logger.js'

export type StoreKey = 'source' | 'babymood'

export interface ShopifyAdminClient {
  shopDomain: string
  apiVersion: string
  graphql: <T>(query: string, variables?: Record<string, unknown>) => Promise<T>
}

interface EnvConfig {
  SOURCE_SHOPIFY_STORE_DOMAIN?: string
  SOURCE_SHOPIFY_ADMIN_TOKEN?: string
  SOURCE_SHOPIFY_CLIENT_ID?: string
  SOURCE_SHOPIFY_CLIENT_SECRET?: string
  BABYMOOD_SHOPIFY_STORE_DOMAIN?: string
  BABYMOOD_SHOPIFY_ADMIN_TOKEN?: string
  BABYMOOD_SHOPIFY_CLIENT_ID?: string
  BABYMOOD_SHOPIFY_CLIENT_SECRET?: string
  API_VERSION?: string
}

export function loadEnv(): EnvConfig {
  const envPath = resolve('.env')
  if (existsSync(envPath)) {
    const lines = readFileSync(envPath, 'utf8').split(/\r?\n/)
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const [key, ...valueParts] = trimmed.split('=')
      if (!process.env[key]) {
        process.env[key] = valueParts.join('=').replace(/^["']|["']$/g, '')
      }
    }
  }

  return {
    SOURCE_SHOPIFY_STORE_DOMAIN: process.env.SOURCE_SHOPIFY_STORE_DOMAIN,
    SOURCE_SHOPIFY_ADMIN_TOKEN: process.env.SOURCE_SHOPIFY_ADMIN_TOKEN,
    SOURCE_SHOPIFY_CLIENT_ID: process.env.SOURCE_SHOPIFY_CLIENT_ID,
    SOURCE_SHOPIFY_CLIENT_SECRET: process.env.SOURCE_SHOPIFY_CLIENT_SECRET,
    BABYMOOD_SHOPIFY_STORE_DOMAIN: process.env.BABYMOOD_SHOPIFY_STORE_DOMAIN,
    BABYMOOD_SHOPIFY_ADMIN_TOKEN: process.env.BABYMOOD_SHOPIFY_ADMIN_TOKEN,
    BABYMOOD_SHOPIFY_CLIENT_ID: process.env.BABYMOOD_SHOPIFY_CLIENT_ID,
    BABYMOOD_SHOPIFY_CLIENT_SECRET: process.env.BABYMOOD_SHOPIFY_CLIENT_SECRET,
    API_VERSION: process.env.API_VERSION ?? '2026-04'
  }
}

export function createShopifyAdminClient(store: StoreKey, logger: Logger): ShopifyAdminClient {
  const env = loadEnv()
  const prefix = store === 'source' ? 'SOURCE' : 'BABYMOOD'
  const shopDomain = store === 'source' ? env.SOURCE_SHOPIFY_STORE_DOMAIN : env.BABYMOOD_SHOPIFY_STORE_DOMAIN
  const staticToken = store === 'source' ? env.SOURCE_SHOPIFY_ADMIN_TOKEN : env.BABYMOOD_SHOPIFY_ADMIN_TOKEN
  const clientId = store === 'source' ? env.SOURCE_SHOPIFY_CLIENT_ID : env.BABYMOOD_SHOPIFY_CLIENT_ID
  const clientSecret = store === 'source' ? env.SOURCE_SHOPIFY_CLIENT_SECRET : env.BABYMOOD_SHOPIFY_CLIENT_SECRET
  const apiVersion = env.API_VERSION ?? '2026-04'

  if (!shopDomain) {
    throw new Error(`Missing ${prefix}_SHOPIFY_STORE_DOMAIN in .env`)
  }

  if (!hasEnvValue(staticToken) && (!hasEnvValue(clientId) || !hasEnvValue(clientSecret))) {
    throw new Error(
      `Missing Shopify credentials for ${prefix}. Set ${prefix}_SHOPIFY_ADMIN_TOKEN or both ${prefix}_SHOPIFY_CLIENT_ID and ${prefix}_SHOPIFY_CLIENT_SECRET in .env`
    )
  }

  const normalizedDomain = shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '')
  let runtimeAccessToken: string | null = null

  const getAccessToken = async (): Promise<string> => {
    if (hasEnvValue(staticToken)) {
      return staticToken
    }

    if (runtimeAccessToken) {
      return runtimeAccessToken
    }

    logger.info('Requesting Shopify Admin API runtime access token', {
      store,
      shopDomain: normalizedDomain,
      authMode: 'client_credentials'
    })

    const tokenUrl = `https://${normalizedDomain}/admin/oauth/access_token`
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId as string,
        client_secret: clientSecret as string
      })
    })

    const text = await response.text()
    if (!response.ok) {
      logger.error('Shopify runtime access token request failed', {
        store,
        shopDomain: normalizedDomain,
        status: response.status
      })
      throw new Error(`Shopify runtime access token request failed for ${normalizedDomain}`)
    }

    const payload = parseJson<{ access_token?: string }>(text, 'access token response')
    if (!payload.access_token) {
      throw new Error(`Shopify runtime access token response missing access_token for ${normalizedDomain}`)
    }

    runtimeAccessToken = payload.access_token
    logger.success('Shopify Admin API runtime access token acquired', {
      store,
      shopDomain: normalizedDomain,
      authMode: 'client_credentials'
    })
    return runtimeAccessToken
  }

  return {
    shopDomain: normalizedDomain,
    apiVersion,
    graphql: async <T>(query: string, variables: Record<string, unknown> = {}) => {
      const token = await getAccessToken()
      logger.info('Shopify GraphQL request', {
        store,
        shopDomain: normalizedDomain,
        authMode: hasEnvValue(staticToken) ? 'static_token' : 'client_credentials',
        operation: operationName(query),
        variables: redactVariables(variables)
      })

      const response = await fetch(`https://${normalizedDomain}/admin/api/${apiVersion}/graphql.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': token
        },
        body: JSON.stringify({ query, variables })
      })

      const payload = (await response.json()) as {
        data?: T
        errors?: Array<{ message: string }>
      }

      if (!response.ok || payload.errors?.length) {
        logger.error('Shopify GraphQL request failed', {
          store,
          status: response.status,
          errors: payload.errors
        })
        throw new Error(`Shopify GraphQL failed for ${normalizedDomain}`)
      }

      return payload.data as T
    }
  }
}

export async function collectPaginated<TNode>(
  fetchPage: (after: string | null) => Promise<{
    edges: Array<{ cursor: string; node: TNode }>
    pageInfo: { hasNextPage: boolean; endCursor: string | null }
  }>,
  limit = 50
): Promise<TNode[]> {
  const items: TNode[] = []
  let after: string | null = null

  while (items.length < limit) {
    const page = await fetchPage(after)
    for (const edge of page.edges) {
      items.push(edge.node)
      if (items.length >= limit) break
    }

    if (!page.pageInfo.hasNextPage || !page.pageInfo.endCursor) break
    after = page.pageInfo.endCursor
  }

  return items
}

function hasEnvValue(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function parseJson<T>(text: string, label: string): T {
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`Shopify ${label} was not valid JSON`)
  }
}

function operationName(query: string): string {
  return query.match(/\b(query|mutation)\s+([A-Za-z0-9_]+)/)?.[2] ?? 'anonymous'
}

function redactVariables(variables: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(variables).map(([key, value]) => [
      key,
      /(token|secret|password|clientSecret|client_secret)/i.test(key) ? '[redacted]' : value
    ])
  )
}
