import { existsSync, readFileSync } from 'node:fs'

import { XMLParser } from 'fast-xml-parser'

import { chunkArray, getBooleanArg, getNumberArg, getStringArg, parseArgs, writeJsonFile } from '../utils/files.js'
import { createLogger, timestampForFile } from '../utils/logger.js'
import { collectPaginated, createShopifyAdminClient, loadEnv } from '../utils/shopify-admin.js'

type SupplierKey = 'b2bmarkt' | 'megapap' | 'symetron'
type SupplierArg = SupplierKey | 'all'
type PlannedAction =
  | 'update_weight'
  | 'skip_no_weight'
  | 'skip_same_weight'
  | 'skip_unmatched'
  | 'skip_invalid_weight'
  | 'would_update_inventory'
  | 'skip_same_stock'
  | 'skip_no_stock'
  | 'skip_missing_location'

interface SupplierConfig {
  key: SupplierKey
  envVar: string
  productTag: string
  skuTag: string
  stockTag: string
  weightTag: string
  weightUnit: 'kg'
}

interface SupplierItem {
  supplier: SupplierKey
  sku: string
  stockQty?: number
  weightKg?: number
  raw: Record<string, string>
}

interface BabyMoodVariant {
  id: string
  title: string
  sku: string
  inventoryQuantity: number
  product: { id: string; title: string; handle: string }
  inventoryItem: {
    id: string
    tracked: boolean
    measurement?: { weight?: { value: number; unit: string } | null } | null
  }
}

interface ProductVariantsResponse {
  productVariants: {
    edges: Array<{ cursor: string; node: BabyMoodVariant | null }>
    pageInfo: { hasNextPage: boolean; endCursor: string | null }
  }
}

interface LocationsResponse {
  locations: {
    nodes: Array<{ id: string; name: string; isActive: boolean; fulfillsOnlineOrders: boolean }>
  }
}

interface ProductVariantsBulkUpdateResponse {
  productVariantsBulkUpdate: {
    productVariants: Array<{ id: string }>
    userErrors: Array<{ field: string[] | null; message: string }>
  }
}

interface RunRow {
  sku: string
  productTitle?: string
  variantId?: string
  productId?: string
  inventoryItemId?: string
  supplier?: SupplierKey
  currentShopifyWeight?: string | null
  supplierWeightKg?: number
  currentShopifyInventory?: number
  supplierStock?: number
  action: PlannedAction
  reason?: string
}

const SUPPLIERS: Record<SupplierKey, SupplierConfig> = {
  b2bmarkt: {
    key: 'b2bmarkt',
    envVar: 'B2BMARKT_MAIN_URL',
    productTag: 'Product',
    skuTag: 'ProductCode',
    stockTag: 'Stock',
    weightTag: 'Weight',
    weightUnit: 'kg'
  },
  symetron: {
    key: 'symetron',
    envVar: 'B2BMARKT_SYMETRON_URL',
    productTag: 'Product',
    skuTag: 'ProductCode',
    stockTag: 'Stock',
    weightTag: 'Weight',
    weightUnit: 'kg'
  },
  megapap: {
    key: 'megapap',
    envVar: 'MEGAPAP_FEED_URL',
    productTag: 'product',
    skuTag: 'model',
    stockTag: 'quantity',
    weightTag: 'weight_item',
    weightUnit: 'kg'
  }
}

async function main() {
  const args = parseArgs()
  if (args.help) {
    printHelp()
    return
  }

  loadEnv()

  const logger = createLogger('supplier-sync')
  const apply = getBooleanArg(args, 'apply')
  const weightsOnly = getBooleanArg(args, 'weights-only')
  const inventoryOnly = getBooleanArg(args, 'inventory-only')
  const supplierArg = (getStringArg(args, 'supplier') ?? 'all').toLowerCase() as SupplierArg
  const limit = getNumberArg(args, 'limit')
  const sku = getStringArg(args, 'sku')
  const outputFile = getStringArg(args, 'output-file')
  const supplierEnvFile = getStringArg(args, 'supplier-env-file')
  const includeWeights = inventoryOnly ? false : true
  const includeInventory = weightsOnly ? false : true

  if (weightsOnly && inventoryOnly) {
    throw new Error('Use only one of --weights-only or --inventory-only')
  }

  if (!includeWeights && !includeInventory) {
    throw new Error('Nothing to do. Enable weights or inventory mode.')
  }

  const supplierKeys = selectedSuppliers(supplierArg)
  if (supplierEnvFile) {
    loadSupplierEnvFile(supplierEnvFile)
  }

  logger.info('Starting Baby Mood supplier data sync', {
    apply,
    supplier: supplierArg,
    suppliers: supplierKeys,
    weightsOnly,
    inventoryOnly,
    limit,
    sku,
    supplierEnvFile: supplierEnvFile ? '[provided]' : undefined
  })

  if (apply && includeInventory) {
    throw new Error('Inventory apply is intentionally not enabled yet. Run inventory dry-runs first and add an explicit reviewed apply step later.')
  }

  const supplierItems = await loadSupplierItems(supplierKeys, logger)
  const supplierBySku = collapseSupplierItemsBySku(supplierItems)
  logger.info('Supplier maps loaded', {
    supplierCount: supplierKeys.length,
    supplierSkuCount: supplierBySku.size,
    supplierCounts: countSupplierItems(supplierItems)
  })

  const client = createShopifyAdminClient('babymood', logger)
  const variants = await fetchBabyMoodVariants(client, { sku, limit })
  const locationId = includeInventory ? await getInventoryLocationId(client, logger) : undefined
  const rows = buildPlanRows(variants, supplierBySku, {
    includeWeights,
    includeInventory,
    locationId
  })

  if (includeWeights && apply) {
    const weightRows = rows.filter((row) => row.action === 'update_weight' && row.productId && row.variantId && row.supplierWeightKg)
    await applyWeightUpdates(client, weightRows, logger)
  } else {
    logger.success('Dry run finished. No Shopify writes were made.', { logFile: logger.filePath })
  }

  const summary = summarizeRows(rows, {
    apply,
    suppliers: supplierKeys,
    includeWeights,
    includeInventory,
    supplierSkuCount: supplierBySku.size,
    locationId,
    logFile: logger.filePath
  })
  const summaryPath = writeJsonFile(outputFile ?? `logs/supplier-sync-summary-${timestampForFile()}.json`, {
    ...summary,
    rows
  })

  logger.success('Supplier sync summary written', { summaryPath })
  printSummary(summary, rows, summaryPath)
}

async function loadSupplierItems(suppliers: SupplierKey[], logger: ReturnType<typeof createLogger>): Promise<SupplierItem[]> {
  const items: SupplierItem[] = []
  for (const supplierKey of suppliers) {
    const config = SUPPLIERS[supplierKey]
    const feedUrl = process.env[config.envVar]
    if (!feedUrl) {
      logger.warn('Supplier feed URL missing; supplier skipped', {
        supplier: supplierKey,
        requiredEnv: config.envVar
      })
      continue
    }

    logger.info('Fetching supplier XML feed', {
      supplier: supplierKey,
      envVar: config.envVar
    })
    const xml = await fetchXml(feedUrl)
    const parsedItems = parseSupplierFeed(xml, config)
    logger.info('Supplier XML parsed', {
      supplier: supplierKey,
      productTag: config.productTag,
      skuTag: config.skuTag,
      stockTag: config.stockTag,
      weightTag: config.weightTag,
      itemCount: parsedItems.length,
      withWeight: parsedItems.filter((item) => item.weightKg !== undefined).length,
      withStock: parsedItems.filter((item) => item.stockQty !== undefined).length
    })
    items.push(...parsedItems)
  }

  return items
}

async function fetchXml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'babymood-supplier-sync/0.1' }
  })
  if (!response.ok) {
    throw new Error(`Supplier XML fetch failed: HTTP ${response.status}`)
  }
  return response.text()
}

function parseSupplierFeed(xml: string, config: SupplierConfig): SupplierItem[] {
  const parser = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
    trimValues: true
  })
  const parsed = parser.parse(xml)
  const products = findProductArray(parsed, config.productTag)
  if (!products) {
    throw new Error(`Could not find <${config.productTag}> elements for ${config.key}`)
  }

  return products.flatMap((product) => {
    const record = product && typeof product === 'object' ? product as Record<string, unknown> : {}
    const sku = normalizeSku(extractText(record[config.skuTag]))
    if (!sku) return []

    const stockQty = parseStock(extractText(record[config.stockTag]))
    const weightKg = parseWeightKg(extractText(record[config.weightTag]))
    return [
      {
        supplier: config.key,
        sku,
        stockQty,
        weightKg,
        raw: {
          [config.skuTag]: extractText(record[config.skuTag]),
          [config.stockTag]: extractText(record[config.stockTag]),
          [config.weightTag]: extractText(record[config.weightTag])
        }
      }
    ]
  })
}

function findProductArray(node: unknown, productTag: string): unknown[] | null {
  if (!node || typeof node !== 'object') return null
  const record = node as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (key === productTag) {
      const value = record[key]
      return Array.isArray(value) ? value : [value]
    }
    const found = findProductArray(record[key], productTag)
    if (found) return found
  }
  return null
}

function extractText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return extractText(value[0])
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return extractText(record['#text'] ?? record.__cdata ?? '')
  }
  return String(value).trim()
}

function collapseSupplierItemsBySku(items: SupplierItem[]): Map<string, SupplierItem> {
  const map = new Map<string, SupplierItem>()
  for (const item of items) {
    if (!map.has(item.sku)) {
      map.set(item.sku, item)
    }
  }
  return map
}

async function fetchBabyMoodVariants(
  client: ReturnType<typeof createShopifyAdminClient>,
  options: { sku?: string; limit?: number }
): Promise<BabyMoodVariant[]> {
  const query = `#graphql
    query BabyMoodVariants($cursor: String, $query: String) {
      productVariants(first: 100, after: $cursor, query: $query) {
        edges {
          cursor
          node {
            id
            title
            sku
            inventoryQuantity
            product { id title handle }
            inventoryItem {
              id
              tracked
              measurement { weight { value unit } }
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `

  const search = options.sku ? `sku:${options.sku}` : undefined
  const variants = await collectPaginated<BabyMoodVariant | null>(
    async (after) => {
      const data = await client.graphql<ProductVariantsResponse>(query, { cursor: after, query: search })
      return data.productVariants
    },
    options.limit
  )

  return variants
    .filter((variant): variant is BabyMoodVariant => Boolean(variant?.sku))
    .map((variant) => ({
      ...variant,
      sku: normalizeSku(variant.sku)
    }))
}

async function getInventoryLocationId(client: ReturnType<typeof createShopifyAdminClient>, logger: ReturnType<typeof createLogger>): Promise<string | undefined> {
  const configured = process.env.BABYMOOD_SHOPIFY_LOCATION_ID || process.env.SHOPIFY_LOCATION_ID
  if (configured) return configured

  const query = `#graphql
    query LocationsForInventoryDryRun {
      locations(first: 20) {
        nodes { id name isActive fulfillsOnlineOrders }
      }
    }
  `
  const data = await client.graphql<LocationsResponse>(query)
  const active = data.locations.nodes.filter((location) => location.isActive)
  const primary = active.find((location) => location.fulfillsOnlineOrders) ?? active[0]
  if (!primary) {
    logger.warn('No active Shopify location found for inventory comparison')
    return undefined
  }

  logger.info('Using Shopify location for inventory comparison', {
    locationId: primary.id,
    locationName: primary.name
  })
  return primary.id
}

function buildPlanRows(
  variants: BabyMoodVariant[],
  supplierBySku: Map<string, SupplierItem>,
  options: { includeWeights: boolean; includeInventory: boolean; locationId?: string }
): RunRow[] {
  const rows: RunRow[] = []

  for (const variant of variants) {
    const supplierItem = supplierBySku.get(variant.sku)
    if (!supplierItem) {
      rows.push({
        sku: variant.sku,
        productTitle: variant.product.title,
        variantId: variant.id,
        productId: variant.product.id,
        inventoryItemId: variant.inventoryItem.id,
        currentShopifyWeight: formatWeight(variant.inventoryItem.measurement?.weight),
        currentShopifyInventory: variant.inventoryQuantity,
        action: 'skip_unmatched',
        reason: 'SKU not found in selected supplier feeds'
      })
      continue
    }

    if (options.includeWeights) {
      rows.push(buildWeightRow(variant, supplierItem))
    }

    if (options.includeInventory) {
      rows.push(buildInventoryRow(variant, supplierItem, options.locationId))
    }
  }

  return rows
}

function buildWeightRow(variant: BabyMoodVariant, supplierItem: SupplierItem): RunRow {
  const base = baseRow(variant, supplierItem)
  if (supplierItem.weightKg === undefined) {
    return { ...base, action: 'skip_no_weight', reason: 'Supplier feed has no weight value' }
  }
  if (!isValidPositiveNumber(supplierItem.weightKg)) {
    return { ...base, action: 'skip_invalid_weight', reason: 'Supplier weight is not a valid positive kg value' }
  }

  const currentWeight = variant.inventoryItem.measurement?.weight
  if (currentWeight && currentWeight.unit === 'KILOGRAMS' && almostSame(currentWeight.value, supplierItem.weightKg)) {
    return { ...base, action: 'skip_same_weight' }
  }

  return { ...base, action: 'update_weight' }
}

function buildInventoryRow(variant: BabyMoodVariant, supplierItem: SupplierItem, locationId?: string): RunRow {
  const base = baseRow(variant, supplierItem)
  if (!locationId) return { ...base, action: 'skip_missing_location', reason: 'No active Shopify location available' }
  if (supplierItem.stockQty === undefined) return { ...base, action: 'skip_no_stock', reason: 'Supplier feed has no stock value' }
  if (variant.inventoryQuantity === supplierItem.stockQty) return { ...base, action: 'skip_same_stock' }
  return { ...base, action: 'would_update_inventory' }
}

function baseRow(variant: BabyMoodVariant, supplierItem: SupplierItem): RunRow {
  return {
    sku: variant.sku,
    productTitle: variant.product.title,
    variantId: variant.id,
    productId: variant.product.id,
    inventoryItemId: variant.inventoryItem.id,
    supplier: supplierItem.supplier,
    currentShopifyWeight: formatWeight(variant.inventoryItem.measurement?.weight),
    supplierWeightKg: supplierItem.weightKg,
    currentShopifyInventory: variant.inventoryQuantity,
    supplierStock: supplierItem.stockQty,
    action: 'skip_unmatched'
  }
}

async function applyWeightUpdates(client: ReturnType<typeof createShopifyAdminClient>, rows: RunRow[], logger: ReturnType<typeof createLogger>) {
  if (rows.length === 0) {
    logger.success('No weight updates to apply')
    return
  }

  const byProduct = new Map<string, RunRow[]>()
  for (const row of rows) {
    if (!row.productId) continue
    byProduct.set(row.productId, [...(byProduct.get(row.productId) ?? []), row])
  }

  const mutation = `#graphql
    mutation ProductVariantsBulkUpdateWeights($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants { id }
        userErrors { field message }
      }
    }
  `

  for (const [productId, productRows] of byProduct.entries()) {
    for (const batch of chunkArray(productRows, 50)) {
      const data = await client.graphql<ProductVariantsBulkUpdateResponse>(mutation, {
        productId,
        variants: batch.map((row) => ({
          id: row.variantId,
          inventoryItem: {
            measurement: {
              weight: {
                value: row.supplierWeightKg,
                unit: 'KILOGRAMS'
              }
            }
          }
        }))
      })
      const errors = data.productVariantsBulkUpdate.userErrors
      if (errors.length > 0) {
        throw new Error(`productVariantsBulkUpdate userErrors: ${JSON.stringify(errors)}`)
      }
      logger.success('Weight batch updated', {
        productId,
        count: batch.length
      })
    }
  }
}

function selectedSuppliers(value: SupplierArg): SupplierKey[] {
  if (value === 'all') return ['b2bmarkt', 'megapap', 'symetron']
  if (value in SUPPLIERS) return [value as SupplierKey]
  throw new Error(`Unknown supplier "${value}". Use b2bmarkt, megapap, symetron, or all.`)
}

function loadSupplierEnvFile(path: string) {
  if (!existsSync(path)) {
    throw new Error(`Supplier env file not found: ${path}`)
  }

  const allowedKeys = new Set(Object.values(SUPPLIERS).map((supplier) => supplier.envVar))
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const [key, ...valueParts] = trimmed.split('=')
    if (!allowedKeys.has(key) || process.env[key]) continue
    process.env[key] = valueParts.join('=').replace(/^["']|["']$/g, '')
  }
}

function normalizeSku(value: string | undefined | null): string {
  return (value ?? '').trim()
}

function parseStock(value: string): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value.replace(',', '.'), 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function parseWeightKg(value: string): number | undefined {
  if (!value) return undefined
  const normalized = value.replace(',', '.').replace(/[^\d.]/g, '')
  if (!normalized) return undefined
  const parsed = Number.parseFloat(normalized)
  return isValidPositiveNumber(parsed) ? roundKg(parsed) : undefined
}

function isValidPositiveNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function roundKg(value: number): number {
  return Math.round(value * 1000) / 1000
}

function almostSame(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.001
}

function formatWeight(weight: { value: number; unit: string } | null | undefined): string | null {
  return weight ? `${weight.value} ${weight.unit}` : null
}

function countSupplierItems(items: SupplierItem[]): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    counts[item.supplier] = (counts[item.supplier] ?? 0) + 1
    return counts
  }, {})
}

function summarizeRows(
  rows: RunRow[],
  meta: {
    apply: boolean
    suppliers: SupplierKey[]
    includeWeights: boolean
    includeInventory: boolean
    supplierSkuCount: number
    locationId?: string
    logFile: string
  }
) {
  const actions = rows.reduce<Record<string, number>>((counts, row) => {
    counts[row.action] = (counts[row.action] ?? 0) + 1
    return counts
  }, {})

  const matchedSkus = new Set(rows.filter((row) => row.supplier).map((row) => row.sku)).size
  const validWeightSkus = new Set(rows.filter((row) => row.supplierWeightKg !== undefined).map((row) => row.sku)).size

  return {
    startedAt: new Date().toISOString(),
    apply: meta.apply,
    suppliers: meta.suppliers,
    includeWeights: meta.includeWeights,
    includeInventory: meta.includeInventory,
    supplierSkuCount: meta.supplierSkuCount,
    storeVariantRows: new Set(rows.map((row) => row.variantId).filter(Boolean)).size,
    matchedSkus,
    validWeightSkus,
    actions,
    locationId: meta.locationId,
    logFile: meta.logFile
  }
}

function printSummary(summary: ReturnType<typeof summarizeRows>, rows: RunRow[], summaryPath: string) {
  console.log('\n========================================')
  console.log('Baby Mood Supplier Sync Summary')
  console.log('========================================')
  console.log(`Mode: ${summary.apply ? 'apply' : 'dry-run'}`)
  console.log(`Suppliers: ${summary.suppliers.join(', ')}`)
  console.log(`Store variants checked: ${summary.storeVariantRows}`)
  console.log(`Matched SKUs: ${summary.matchedSkus}`)
  console.log(`Valid supplier weights: ${summary.validWeightSkus}`)
  console.log('Actions:')
  for (const [action, count] of Object.entries(summary.actions).sort()) {
    console.log(`  ${action}: ${count}`)
  }

  const preview = rows.slice(0, 20)
  if (preview.length > 0) {
    console.log('\nPreview:')
    for (const row of preview) {
      console.log(
        `  ${row.sku} | ${row.supplier ?? 'unmatched'} | current=${row.currentShopifyWeight ?? '-'} | feed=${row.supplierWeightKg ?? '-'} kg | ${row.action}`
      )
    }
  }

  console.log(`\nLog file: ${summary.logFile}`)
  console.log(`Summary file: ${summaryPath}`)
  console.log('========================================\n')
}

function printHelp() {
  console.log(`Baby Mood supplier data sync/backfill

Dry-run by default. Writes require --apply.

Usage:
  npm run supplier:weights:dry -- --sku=0509849
  npm run supplier:weights:dry -- --limit=10
  npm run supplier:inventory:dry -- --limit=10
  npm run supplier:sync:dry -- --supplier=all --limit=10

Options:
  --apply
  --weights-only
  --inventory-only
  --supplier=b2bmarkt|megapap|symetron|all
  --limit=10
  --sku=0509849
  --output-file=logs/supplier-sync-test.json
  --supplier-env-file=/Users/nikolaiv37/projects/mebelcenter-shopify/.env

Required feed env vars:
  B2BMARKT_MAIN_URL
  B2BMARKT_SYMETRON_URL
  MEGAPAP_FEED_URL

Optional inventory env:
  BABYMOOD_SHOPIFY_LOCATION_ID
`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
