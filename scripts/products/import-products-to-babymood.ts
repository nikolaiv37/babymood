import { chunkArray, getBooleanArg, getNumberArg, getStringArg, latestJsonFile, parseArgs, readJsonFile } from '../utils/files.js'
import { createLogger } from '../utils/logger.js'
import { createShopifyAdminClient } from '../utils/shopify-admin.js'
import type { BabyMoodProduct, BabyMoodTransformFile } from './types.js'

interface ProductLookupResponse {
  products: {
    nodes: Array<{ id: string; handle: string; variants: { nodes: Array<{ sku: string | null }> } }>
  }
}

interface ProductCreateResponse {
  productCreate: {
    product: { id: string; handle: string } | null
    userErrors: Array<{ field: string[] | null; message: string }>
  }
}

interface ProductVariantsBulkCreateResponse {
  productVariantsBulkCreate: {
    product: { id: string } | null
    productVariants: Array<{ id: string; title: string }>
    userErrors: Array<{ field: string[] | null; message: string }>
  }
}

interface ProductUpdateResponse {
  productUpdate: {
    product: { id: string; handle: string } | null
    userErrors: Array<{ field: string[] | null; message: string }>
  }
}

interface MetafieldsSetResponse {
  metafieldsSet: {
    metafields: Array<{ id: string; namespace: string; key: string }>
    userErrors: Array<{ field: string[] | null; message: string }>
  }
}

async function main() {
  const args = parseArgs()
  if (args.help) {
    printHelp()
    return
  }

  const logger = createLogger('import-products')
  const apply = getBooleanArg(args, 'apply')
  const allowUpdate = getBooleanArg(args, 'allow-update')
  const sourceFile = getStringArg(args, 'source-file') ?? latestJsonFile('data/transformed')
  const limit = getNumberArg(args, 'limit')
  const file = readJsonFile<BabyMoodTransformFile>(sourceFile)
  const products = file.products.slice(0, limit ?? file.products.length)

  logger.info('Starting Baby Mood import', {
    apply,
    allowUpdate,
    sourceFile,
    productCount: products.length
  })

  const client = createShopifyAdminClient('babymood', logger)

  if (!apply) {
    for (const product of products) {
      const existing = await findExistingProduct(client, product)
      if (existing && !allowUpdate) {
        logger.dryRun('Would skip existing product', {
          ...summarizeProduct(product),
          existingProductId: existing.id,
          existingHandle: existing.handle,
          reason: '--allow-update was not passed'
        })
        continue
      }

      if (existing && allowUpdate) {
        logger.dryRun('Would update existing product', {
          ...summarizeProduct(product),
          existingProductId: existing.id,
          existingHandle: existing.handle
        })
        continue
      }

      logger.dryRun('Would create product', summarizeProduct(product))
    }
    logger.success('Dry run finished. No Shopify writes were made.', { logFile: logger.filePath })
    return
  }

  for (const product of products) {
    const existing = await findExistingProduct(client, product)
    if (existing && !allowUpdate) {
      logger.warn('Existing product skipped because --allow-update was not passed', {
        productId: existing.id,
        handle: product.handle,
        sku: firstSku(product)
      })
      continue
    }

    const productId = existing ? await updateProduct(client, product, existing.id) : await createProduct(client, product)

    try {
      await setProductMetafields(client, productId, product)
      if (existing) {
        logger.warn('Existing product media and variants were not changed automatically', {
          productId,
          handle: product.handle,
          reason: 'Avoiding duplicate variants/media during update. Review manually or add a dedicated variant sync step.'
        })
      } else {
        await createVariants(client, productId, product)
      }
    } catch (error) {
      logger.error(existing ? 'Existing product update failed after core product update' : 'Partial product created before import step failed', {
        productId,
        handle: product.handle,
        step: existing ? 'metafields' : 'metafields_or_variants',
        error: error instanceof Error ? error.message : String(error),
        rerunSafety: existing
          ? 'Rerun requires --allow-update to continue updating this existing product.'
          : 'Rerun will detect this product by handle/SKU and skip it unless --allow-update is passed.'
      })
      throw error
    }

    logger.success(existing ? 'Product updated' : 'Product created', {
      productId,
      handle: product.handle,
      imageCount: product.images.length,
      variantCount: product.variants.length,
      metafieldCount: product.metafields.length
    })
  }

  logger.success('Baby Mood import finished', { logFile: logger.filePath })
}

async function findExistingProduct(
  client: ReturnType<typeof createShopifyAdminClient>,
  product: BabyMoodProduct
): Promise<{ id: string; handle: string } | undefined> {
  const query = `#graphql
    query ProductLookup($query: String!) {
      products(first: 10, query: $query) {
        nodes {
          id
          handle
          variants(first: 50) { nodes { sku } }
        }
      }
    }
  `
  const sku = firstSku(product)
  const search = sku ? `(handle:${product.handle}) OR (sku:${sku})` : `handle:${product.handle}`
  const data = await client.graphql<ProductLookupResponse>(query, { query: search })
  return data.products.nodes.find((node) => node.handle === product.handle || node.variants.nodes.some((variant) => variant.sku === sku))
}

async function createProduct(client: ReturnType<typeof createShopifyAdminClient>, product: BabyMoodProduct): Promise<string> {
  const mutation = `#graphql
    mutation ProductCreate($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
      productCreate(product: $product, media: $media) {
        product { id handle }
        userErrors { field message }
      }
    }
  `
  const data = await client.graphql<ProductCreateResponse>(mutation, {
    product: productCreateInput(product),
    media: product.images.map((image) => ({
      originalSource: image.url,
      alt: image.altText ?? product.title,
      mediaContentType: 'IMAGE'
    }))
  })
  throwOnUserErrors('productCreate', data.productCreate.userErrors)
  if (!data.productCreate.product) throw new Error(`Product create returned no product for ${product.handle}`)
  return data.productCreate.product.id
}

async function updateProduct(
  client: ReturnType<typeof createShopifyAdminClient>,
  product: BabyMoodProduct,
  id: string
): Promise<string> {
  const mutation = `#graphql
    mutation ProductUpdate($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product { id handle }
        userErrors { field message }
      }
    }
  `
  const data = await client.graphql<ProductUpdateResponse>(mutation, {
    product: productUpdateInput(product, id)
  })
  throwOnUserErrors('productUpdate', data.productUpdate.userErrors)
  if (!data.productUpdate.product) throw new Error(`Product update returned no product for ${product.handle}`)
  return data.productUpdate.product.id
}

async function setProductMetafields(
  client: ReturnType<typeof createShopifyAdminClient>,
  productId: string,
  product: BabyMoodProduct
): Promise<void> {
  const mutation = `#graphql
    mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id namespace key }
        userErrors { field message }
      }
    }
  `

  for (const chunk of chunkArray(product.metafields, 25)) {
    const data = await client.graphql<MetafieldsSetResponse>(mutation, {
      metafields: chunk.map((metafield) => ({
        ownerId: productId,
        namespace: metafield.namespace,
        key: metafield.key,
        type: metafield.type,
        value: metafield.value
      }))
    })
    throwOnUserErrors('metafieldsSet', data.metafieldsSet.userErrors)
  }
}

async function createVariants(
  client: ReturnType<typeof createShopifyAdminClient>,
  productId: string,
  product: BabyMoodProduct
): Promise<void> {
  if (product.variants.length === 0) return

  const mutation = `#graphql
    mutation ProductVariantsBulkCreate(
      $productId: ID!
      $variants: [ProductVariantsBulkInput!]!
      $strategy: ProductVariantsBulkCreateStrategy
    ) {
      productVariantsBulkCreate(productId: $productId, variants: $variants, strategy: $strategy) {
        product { id }
        productVariants { id title }
        userErrors { field message }
      }
    }
  `

  for (const variants of chunkArray(product.variants, 50)) {
    const data = await client.graphql<ProductVariantsBulkCreateResponse>(mutation, {
      productId,
      strategy: 'REMOVE_STANDALONE_VARIANT',
      variants: variants.map((variant) => ({
        barcode: variant.barcode,
        compareAtPrice: variant.compareAtPrice,
        inventoryPolicy: variant.inventoryPolicy,
        inventoryItem: {
          sku: variant.sku,
          tracked: false
        },
        optionValues: normalizeVariantOptions(variant.selectedOptions),
        price: variant.price,
        taxable: variant.taxable
      }))
    })
    throwOnUserErrors('productVariantsBulkCreate', data.productVariantsBulkCreate.userErrors)
  }
}

function productCoreInput(product: BabyMoodProduct) {
  return {
    title: product.title,
    handle: product.handle,
    descriptionHtml: product.descriptionHtml,
    vendor: product.vendor,
    productType: product.productType,
    tags: product.tags,
    status: product.status,
    seo: product.seo
  }
}

function productCreateInput(product: BabyMoodProduct) {
  return {
    ...productCoreInput(product),
    productOptions: normalizeProductOptions(product)
  }
}

function productUpdateInput(product: BabyMoodProduct, id: string) {
  return {
    id,
    ...productCoreInput(product)
  }
}

function normalizeProductOptions(product: BabyMoodProduct) {
  if (product.options.length > 0) {
    return product.options.slice(0, 3).map((option, index) => ({
      name: option.name,
      position: index + 1,
      values: option.values.map((value) => ({ name: value }))
    }))
  }

  return [
    {
      name: 'Title',
      position: 1,
      values: [{ name: 'Default Title' }]
    }
  ]
}

function normalizeVariantOptions(selectedOptions: Array<{ name: string; value: string }>) {
  if (selectedOptions.length > 0) {
    return selectedOptions.slice(0, 3).map((option) => ({
      optionName: option.name,
      name: option.value
    }))
  }

  return [{ optionName: 'Title', name: 'Default Title' }]
}

function firstSku(product: BabyMoodProduct): string | undefined {
  return product.variants.find((variant) => variant.sku)?.sku ?? undefined
}

function summarizeProduct(product: BabyMoodProduct) {
  return {
    title: product.title,
    handle: product.handle,
    sku: firstSku(product),
    collections: product.collections,
    tags: product.tags,
    imageCount: product.images.length,
    variantCount: product.variants.length,
    metafieldCount: product.metafields.length
  }
}

function throwOnUserErrors(operation: string, userErrors: Array<{ field: string[] | null; message: string }>) {
  if (userErrors.length > 0) {
    throw new Error(`${operation} user errors: ${JSON.stringify(userErrors)}`)
  }
}

function printHelp() {
  console.log(`
Import transformed products into Baby Mood.

Dry-run is the default and makes no Shopify writes.

Usage:
  npm run import:products:dry -- --source-file=data/transformed/sample.json --limit=5
  npm run import:products:apply -- --source-file=data/transformed/sample.json --limit=5
  npm run import:products:apply -- --source-file=data/transformed/sample.json --allow-update
`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
