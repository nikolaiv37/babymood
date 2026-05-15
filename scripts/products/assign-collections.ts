import { getBooleanArg, getNumberArg, getStringArg, latestJsonFile, parseArgs, readJsonFile } from '../utils/files.js'
import { createLogger } from '../utils/logger.js'
import { createShopifyAdminClient } from '../utils/shopify-admin.js'
import type { BabyMoodProduct, BabyMoodTransformFile } from './types.js'

interface LookupResponse {
  products: { nodes: Array<{ id: string; handle: string }> }
  collectionByHandle: { id: string; handle: string } | null
}

interface AddToCollectionResponse {
  collectionAddProducts: {
    collection: { id: string } | null
    userErrors: Array<{ field: string[] | null; message: string }>
  }
}

async function main() {
  const args = parseArgs()
  if (args.help) {
    printHelp()
    return
  }

  const apply = getBooleanArg(args, 'apply')
  const sourceFile = getStringArg(args, 'source-file') ?? latestJsonFile('data/transformed')
  const limit = getNumberArg(args, 'limit')
  const logger = createLogger('assign-collections')
  const file = readJsonFile<BabyMoodTransformFile>(sourceFile)
  const products = file.products.slice(0, limit ?? file.products.length)

  if (!apply) {
    for (const product of products) {
      logger.dryRun('Would assign product to collections', {
        handle: product.handle,
        collections: product.collections
      })
    }
    logger.success('Dry run finished. No collection assignments were made.', { logFile: logger.filePath })
    return
  }

  const client = createShopifyAdminClient('babymood', logger)
  for (const product of products) {
    await assignProductCollections(client, product, logger)
  }

  logger.success('Collection assignment finished', { logFile: logger.filePath })
}

async function assignProductCollections(
  client: ReturnType<typeof createShopifyAdminClient>,
  product: BabyMoodProduct,
  logger: ReturnType<typeof createLogger>
): Promise<void> {
  for (const collectionHandle of product.collections) {
    const lookup = await client.graphql<LookupResponse>(
      `#graphql
        query Lookup($productQuery: String!, $collectionHandle: String!) {
          products(first: 1, query: $productQuery) { nodes { id handle } }
          collectionByHandle(handle: $collectionHandle) { id handle }
        }
      `,
      {
        productQuery: `handle:${product.handle}`,
        collectionHandle
      }
    )

    const productId = lookup.products.nodes[0]?.id
    const collectionId = lookup.collectionByHandle?.id

    if (!productId || !collectionId) {
      logger.warn('Skipping collection assignment because product or collection was not found', {
        productHandle: product.handle,
        collectionHandle,
        productFound: Boolean(productId),
        collectionFound: Boolean(collectionId)
      })
      continue
    }

    const data = await client.graphql<AddToCollectionResponse>(
      `#graphql
        mutation CollectionAddProducts($id: ID!, $productIds: [ID!]!) {
          collectionAddProducts(id: $id, productIds: $productIds) {
            collection { id }
            userErrors { field message }
          }
        }
      `,
      { id: collectionId, productIds: [productId] }
    )

    if (data.collectionAddProducts.userErrors.length > 0) {
      logger.warn('Collection assignment returned user errors', {
        productHandle: product.handle,
        collectionHandle,
        errors: data.collectionAddProducts.userErrors
      })
      continue
    }

    logger.success('Product assigned to collection', { productHandle: product.handle, collectionHandle })
  }
}

function printHelp() {
  console.log(`
Assign imported Baby Mood products to collections.

Usage:
  npm run collections:assign -- --source-file=data/transformed/sample.json --limit=5
  npm run collections:assign -- --source-file=data/transformed/sample.json --limit=5 --apply
`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
