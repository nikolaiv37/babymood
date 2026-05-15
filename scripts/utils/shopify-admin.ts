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
  BABYMOOD_SHOPIFY_STORE_DOMAIN?: string
  BABYMOOD_SHOPIFY_ADMIN_TOKEN?: string
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
    BABYMOOD_SHOPIFY_STORE_DOMAIN: process.env.BABYMOOD_SHOPIFY_STORE_DOMAIN,
    BABYMOOD_SHOPIFY_ADMIN_TOKEN: process.env.BABYMOOD_SHOPIFY_ADMIN_TOKEN,
    API_VERSION: process.env.API_VERSION ?? '2026-01'
  }
}

export function createShopifyAdminClient(store: StoreKey, logger: Logger): ShopifyAdminClient {
  const env = loadEnv()
  const shopDomain = store === 'source' ? env.SOURCE_SHOPIFY_STORE_DOMAIN : env.BABYMOOD_SHOPIFY_STORE_DOMAIN
  const token = store === 'source' ? env.SOURCE_SHOPIFY_ADMIN_TOKEN : env.BABYMOOD_SHOPIFY_ADMIN_TOKEN
  const apiVersion = env.API_VERSION ?? '2026-01'

  if (!shopDomain || !token) {
    const prefix = store === 'source' ? 'SOURCE' : 'BABYMOOD'
    throw new Error(`Missing ${prefix}_SHOPIFY_STORE_DOMAIN or ${prefix}_SHOPIFY_ADMIN_TOKEN in .env`)
  }

  const normalizedDomain = shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '')

  return {
    shopDomain: normalizedDomain,
    apiVersion,
    graphql: async <T>(query: string, variables: Record<string, unknown> = {}) => {
      logger.info('Shopify GraphQL request', {
        store,
        shopDomain: normalizedDomain,
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

function operationName(query: string): string {
  return query.match(/\b(query|mutation)\s+([A-Za-z0-9_]+)/)?.[2] ?? 'anonymous'
}

function redactVariables(variables: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(variables).map(([key, value]) => [
      key,
      key.toLowerCase().includes('token') ? '[redacted]' : value
    ])
  )
}
