import { getBooleanArg, parseArgs } from '../utils/files.js'
import { createLogger } from '../utils/logger.js'
import { createShopifyAdminClient } from '../utils/shopify-admin.js'

const DEFINITIONS = [
  ['suitable_age', 'Suitable age', 'single_line_text_field'],
  ['mattress_size', 'Mattress size', 'single_line_text_field'],
  ['material', 'Material', 'single_line_text_field'],
  ['color', 'Color', 'single_line_text_field'],
  ['dimensions', 'Dimensions', 'single_line_text_field'],
  ['whats_included', 'What is included', 'multi_line_text_field'],
  ['parent_benefit', 'Parent benefit', 'multi_line_text_field'],
  ['safety_note', 'Safety note', 'multi_line_text_field'],
  ['delivery_note', 'Delivery note', 'multi_line_text_field'],
  ['care_instructions', 'Care instructions', 'multi_line_text_field'],
  ['room_style', 'Room style', 'single_line_text_field'],
  ['product_highlights', 'Product highlights', 'list.single_line_text_field'],
  ['faq_1_question', 'FAQ 1 question', 'single_line_text_field'],
  ['faq_1_answer', 'FAQ 1 answer', 'multi_line_text_field'],
  ['faq_2_question', 'FAQ 2 question', 'single_line_text_field'],
  ['faq_2_answer', 'FAQ 2 answer', 'multi_line_text_field'],
  ['faq_3_question', 'FAQ 3 question', 'single_line_text_field'],
  ['faq_3_answer', 'FAQ 3 answer', 'multi_line_text_field']
] as const

interface DefinitionCreateResponse {
  metafieldDefinitionCreate: {
    createdDefinition: { id: string; namespace: string; key: string } | null
    userErrors: Array<{ field: string[] | null; message: string; code?: string }>
  }
}

async function main() {
  const args = parseArgs()
  if (args.help) {
    printHelp()
    return
  }

  const apply = getBooleanArg(args, 'apply')
  const logger = createLogger('create-metafield-definitions')

  if (!apply) {
    for (const [key, name, type] of DEFINITIONS) {
      logger.dryRun('Would create product metafield definition', { namespace: 'custom', key, name, type })
    }
    logger.success('Dry run finished. No metafield definitions were created.', { logFile: logger.filePath })
    return
  }

  const client = createShopifyAdminClient('babymood', logger)
  const mutation = `#graphql
    mutation MetafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
      metafieldDefinitionCreate(definition: $definition) {
        createdDefinition { id namespace key }
        userErrors { field message code }
      }
    }
  `

  for (const [key, name, type] of DEFINITIONS) {
    const data = await client.graphql<DefinitionCreateResponse>(mutation, {
      definition: {
        namespace: 'custom',
        key,
        name,
        type,
        ownerType: 'PRODUCT'
      }
    })

    const errors = data.metafieldDefinitionCreate.userErrors
    if (errors.length > 0) {
      logger.warn('Metafield definition was not created', { key, errors })
      continue
    }

    logger.success('Metafield definition created', data.metafieldDefinitionCreate.createdDefinition ?? { key })
  }

  logger.success('Metafield definition setup finished', { logFile: logger.filePath })
}

function printHelp() {
  console.log(`
Create Baby Mood product metafield definitions.

Usage:
  npm run metafields:create:dry
  npm run metafields:create:apply
`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
