import { createLogger } from './utils/logger.js'
import { createShopifyAdminClient, type StoreKey } from './utils/shopify-admin.js'

interface ShopQueryResponse {
  shop: {
    name: string
    myshopifyDomain: string
  }
}

async function main() {
  const logger = createLogger('auth-test')
  logger.info('Starting read-only Shopify authentication test')

  await testStore('source', logger)
  await testStore('babymood', logger)

  logger.success('Read-only Shopify authentication test finished', { logFile: logger.filePath })
}

async function testStore(store: StoreKey, logger: ReturnType<typeof createLogger>) {
  const client = createShopifyAdminClient(store, logger)
  const data = await client.graphql<ShopQueryResponse>(`#graphql
    query AuthTestShop {
      shop {
        name
        myshopifyDomain
      }
    }
  `)

  logger.success('Shopify authentication succeeded', {
    store,
    shopDomain: client.shopDomain,
    apiVersion: client.apiVersion,
    returnedDomain: data.shop.myshopifyDomain,
    shopName: data.shop.name
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
