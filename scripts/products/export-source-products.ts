import { getNumberArg, getStringArg, parseArgs, writeJsonFile } from '../utils/files.js'
import { createLogger, timestampForFile } from '../utils/logger.js'
import { collectPaginated, createShopifyAdminClient } from '../utils/shopify-admin.js'
import type { SourceExportFile, SourceProduct } from './types.js'

const PRODUCT_FIELDS = `#graphql
  fragment ProductFields on Product {
    id
    title
    handle
    descriptionHtml
    vendor
    productType
    tags
    status
    seo { title description }
    images(first: 50) { nodes { id url altText } }
    options { id name values }
    variants(first: 100) {
      nodes {
        id
        title
        sku
        barcode
        price
        compareAtPrice
        inventoryPolicy
        taxable
        requiresShipping
        selectedOptions { name value }
      }
    }
    metafields(first: 50) {
      nodes { namespace key type value }
    }
  }
`

interface ProductsResponse {
  products: {
    edges: Array<{ cursor: string; node: ShopifyProductNode }>
    pageInfo: { hasNextPage: boolean; endCursor: string | null }
  }
}

interface CollectionProductsResponse {
  collectionByHandle: null | {
    products: ProductsResponse['products']
  }
}

type ShopifyProductNode = Omit<SourceProduct, 'images' | 'variants' | 'metafields'> & {
  images: { nodes: SourceProduct['images'] }
  variants: { nodes: SourceProduct['variants'] }
  metafields: { nodes: SourceProduct['metafields'] }
}

async function main() {
  const args = parseArgs()
  if (args.help) {
    printHelp()
    return
  }

  const logger = createLogger('export-source-products')
  const client = createShopifyAdminClient('source', logger)
  const collectionHandle = getStringArg(args, 'collection-handle')
  const tag = getStringArg(args, 'tag')
  const productType = getStringArg(args, 'product-type')
  const limit = getNumberArg(args, 'limit') ?? 50
  const outputFile = getStringArg(args, 'output-file') ?? `data/source/${timestampForFile()}-source-products.json`

  if (!collectionHandle && !tag && !productType) {
    throw new Error('Pass at least one selector: --collection-handle=, --tag=, or --product-type=')
  }

  logger.info('Starting source product export', { collectionHandle, tag, productType, limit })
  const products = collectionHandle
    ? await exportByCollection(client, collectionHandle, limit)
    : await exportByProductQuery(client, buildProductQuery({ tag, productType }), limit)

  const file: SourceExportFile = {
    exportedAt: new Date().toISOString(),
    source: { collectionHandle, tag, productType, limit },
    products
  }

  const path = writeJsonFile(outputFile, file)
  logger.success('Source product export saved', { path, productCount: products.length, logFile: logger.filePath })
}

async function exportByCollection(
  client: ReturnType<typeof createShopifyAdminClient>,
  handle: string,
  limit: number
): Promise<SourceProduct[]> {
  const query = `#graphql
    ${PRODUCT_FIELDS}
    query ProductsByCollection($handle: String!, $first: Int!, $after: String) {
      collectionByHandle(handle: $handle) {
        products(first: $first, after: $after) {
          edges { cursor node { ...ProductFields } }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  `

  const nodes = await collectPaginated<ShopifyProductNode>(async (after) => {
    const data = await client.graphql<CollectionProductsResponse>(query, {
      handle,
      first: Math.min(50, limit),
      after
    })
    if (!data.collectionByHandle) {
      throw new Error(`Collection handle not found in source store: ${handle}`)
    }
    return data.collectionByHandle.products
  }, limit)

  return nodes.map(normalizeProduct)
}

async function exportByProductQuery(
  client: ReturnType<typeof createShopifyAdminClient>,
  productQuery: string,
  limit: number
): Promise<SourceProduct[]> {
  const query = `#graphql
    ${PRODUCT_FIELDS}
    query ProductsByQuery($query: String!, $first: Int!, $after: String) {
      products(query: $query, first: $first, after: $after) {
        edges { cursor node { ...ProductFields } }
        pageInfo { hasNextPage endCursor }
      }
    }
  `

  const nodes = await collectPaginated<ShopifyProductNode>(async (after) => {
    const data = await client.graphql<ProductsResponse>(query, {
      query: productQuery,
      first: Math.min(50, limit),
      after
    })
    return data.products
  }, limit)

  return nodes.map(normalizeProduct)
}

function buildProductQuery(filters: { tag?: string; productType?: string }): string {
  return [
    filters.tag ? `tag:${quoteSearchValue(filters.tag)}` : undefined,
    filters.productType ? `product_type:${quoteSearchValue(filters.productType)}` : undefined
  ]
    .filter(Boolean)
    .join(' AND ')
}

function quoteSearchValue(value: string): string {
  return value.includes(' ') ? `"${value.replace(/"/g, '\\"')}"` : value
}

function normalizeProduct(product: ShopifyProductNode): SourceProduct {
  return {
    ...product,
    images: product.images.nodes,
    variants: product.variants.nodes,
    metafields: product.metafields.nodes
  }
}

function printHelp() {
  console.log(`
Export selected products from MebelCenter.

Usage:
  npm run export:source -- --collection-handle=montessori-beds --limit=5
  npm run export:source -- --tag=montessori --limit=5
  npm run export:source -- --product-type="Children bed" --output-file=data/source/sample.json
`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
