import { latestJsonFile, getNumberArg, getStringArg, parseArgs, readJsonFile, writeJsonFile } from '../utils/files.js'
import { createLogger, timestampForFile } from '../utils/logger.js'
import type { BabyMoodMetafield, BabyMoodProduct, BabyMoodTransformFile, SourceExportFile, SourceProduct } from './types.js'

const COLLECTION_RULES: Array<{ handle: string; terms: string[] }> = [
  { handle: 'montessori-legla', terms: ['montessori', 'монтесори', 'floor bed', 'подово'] },
  { handle: 'detski-legla', terms: ['bed', 'легло', 'children bed', 'kids bed'] },
  { handle: 'detski-mebeli', terms: ['furniture', 'мебел', 'шкаф', 'скрин', 'етажер'] },
  { handle: 'detski-lampi', terms: ['lamp', 'лампа', 'осветление'] }
]

async function main() {
  const args = parseArgs()
  if (args.help) {
    printHelp()
    return
  }

  const logger = createLogger('transform-products')
  const sourceFile = getStringArg(args, 'source-file') ?? latestJsonFile('data/source')
  const outputFile = getStringArg(args, 'output-file') ?? `data/transformed/${timestampForFile()}-babymood-products.json`
  const limit = getNumberArg(args, 'limit')
  const source = readJsonFile<SourceExportFile>(sourceFile)
  const products = source.products.slice(0, limit ?? source.products.length).map(transformProduct)

  const transformed: BabyMoodTransformFile = {
    transformedAt: new Date().toISOString(),
    sourceFile,
    products
  }

  const path = writeJsonFile(outputFile, transformed)
  logger.success('Products transformed for Baby Mood', { sourceFile, path, productCount: products.length })
}

function transformProduct(product: SourceProduct): BabyMoodProduct {
  const title = makeBulgarianTitle(product)
  const descriptionText = stripHtml(product.descriptionHtml)
  const collections = inferCollections(product)
  const tags = mapTags(product, collections)
  const mattressSize = inferMattressSize(`${product.title} ${descriptionText}`)
  const dimensions = inferDimensions(`${product.title} ${descriptionText}`)
  const material = inferMaterial(descriptionText)
  const color = inferColor(`${product.title} ${descriptionText}`)

  return {
    sourceProductId: product.id,
    sourceHandle: product.handle,
    title,
    handle: product.handle,
    descriptionHtml: cleanDescriptionHtml(product, title),
    vendor: 'Baby Mood',
    productType: normalizeProductType(product),
    status: 'DRAFT',
    tags,
    seo: {
      title: truncate(`${title} | Baby Mood`, 70),
      description: truncate(
        `${title} за детска стая от Baby Mood. Подходящ избор за уютно, практично и безопасно обзавеждане.`,
        155
      )
    },
    collections,
    images: product.images.map((image) => ({
      url: image.url,
      altText: image.altText ?? title
    })),
    options: product.options.map(({ name, values }) => ({ name, values })),
    variants: product.variants.map((variant) => ({
      title: variant.title,
      sku: variant.sku,
      barcode: variant.barcode,
      price: variant.price,
      compareAtPrice: variant.compareAtPrice,
      inventoryPolicy: 'DENY',
      taxable: variant.taxable,
      requiresShipping: variant.requiresShipping,
      selectedOptions: variant.selectedOptions
    })),
    metafields: compactMetafields([
      textMetafield('suitable_age', inferAge(product)),
      textMetafield('mattress_size', mattressSize),
      textMetafield('material', material),
      textMetafield('color', color),
      textMetafield('dimensions', dimensions),
      longMetafield('whats_included', 'Продуктът включва описаните от производителя основни елементи. Матрак и декорация се добавят само ако са изрично посочени.'),
      longMetafield('parent_benefit', 'Създаден за по-спокойна детска стая, лесна ежедневна употреба и уютна среда за сън и игра.'),
      longMetafield('safety_note', 'Използвайте продукта според инструкциите на производителя и под надзор, съобразен с възрастта на детето.'),
      longMetafield('delivery_note', 'Доставката се уточнява според наличност, адрес и размер на продукта.'),
      longMetafield('care_instructions', 'Почиствайте с мека суха или леко влажна кърпа. Избягвайте агресивни препарати.'),
      textMetafield('room_style', inferRoomStyle(product)),
      listMetafield('product_highlights', [
        'Подходящо за детска стая',
        'Практичен избор за ежедневна употреба',
        'Запазени оригинални варианти и изображения'
      ]),
      textMetafield('faq_1_question', 'Подходящ ли е продуктът за малко дете?'),
      longMetafield('faq_1_answer', 'Проверете препоръчаната възраст, размерите и инструкциите за безопасност преди покупка.'),
      textMetafield('faq_2_question', 'Включен ли е матрак?'),
      longMetafield('faq_2_answer', 'Матрак е включен само ако това е изрично посочено в описанието на продукта.'),
      textMetafield('faq_3_question', 'Как се поддържа продуктът?'),
      longMetafield('faq_3_answer', 'Препоръчва се нежно почистване с мека кърпа и спазване на указанията на производителя.')
    ])
  }
}

function makeBulgarianTitle(product: SourceProduct): string {
  const base = product.title
    .replace(/\bMontessori\b/gi, 'Монтесори')
    .replace(/\bKids?\b/gi, 'Детско')
    .replace(/\bChildren'?s?\b/gi, 'Детско')
    .replace(/\bBed\b/gi, 'легло')
    .replace(/\bLamp\b/gi, 'лампа')
    .replace(/\s+/g, ' ')
    .trim()

  if (/[а-яА-Я]/.test(base)) return base
  return `${normalizeProductType(product)} ${base}`.trim()
}

function cleanDescriptionHtml(product: SourceProduct, title: string): string {
  const text = stripHtml(product.descriptionHtml)
  const intro = `<p><strong>${escapeHtml(title)}</strong> е подбран продукт за уютна и функционална детска стая от Baby Mood.</p>`
  const source = text ? `<p>${escapeHtml(text)}</p>` : ''
  return `${intro}${source}`.replace(/\s+/g, ' ').trim()
}

function inferCollections(product: SourceProduct): string[] {
  const haystack = `${product.title} ${product.productType} ${product.tags.join(' ')}`.toLowerCase()
  const matches = COLLECTION_RULES.filter((rule) => rule.terms.some((term) => haystack.includes(term))).map((rule) => rule.handle)
  return Array.from(new Set(matches.length > 0 ? matches : ['detski-mebeli']))
}

function mapTags(product: SourceProduct, collections: string[]): string[] {
  const mapped = product.tags
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .map((tag) => tag.replace(/^mebelcenter[:\s-]*/i, ''))

  return Array.from(new Set(['baby-mood', 'import-mebelcenter', ...collections, ...mapped]))
}

function normalizeProductType(product: SourceProduct): string {
  const haystack = `${product.title} ${product.productType}`.toLowerCase()
  if (haystack.includes('lamp') || haystack.includes('лампа')) return 'Детска лампа'
  if (haystack.includes('montessori') || haystack.includes('монтесори')) return 'Монтесори легло'
  if (haystack.includes('bed') || haystack.includes('легло')) return 'Детско легло'
  return 'Детска мебел'
}

function inferAge(product: SourceProduct): string {
  const haystack = `${product.title} ${product.descriptionHtml}`.toLowerCase()
  if (haystack.includes('baby') || haystack.includes('беб')) return 'За бебета и малки деца според указанията на производителя'
  return 'За деца, съобразено с размерите и инструкциите за безопасност'
}

function inferMattressSize(value: string): string | undefined {
  return value.match(/\b\d{2,3}\s*x\s*\d{2,3}\b/i)?.[0]?.replace(/\s+/g, '')
}

function inferDimensions(value: string): string | undefined {
  return value.match(/\b\d{2,3}\s*x\s*\d{2,3}(?:\s*x\s*\d{2,3})?\s*(?:cm|см)?\b/i)?.[0]
}

function inferMaterial(value: string): string | undefined {
  const lower = value.toLowerCase()
  if (lower.includes('mdf')) return 'MDF'
  if (lower.includes('wood') || lower.includes('дърво') || lower.includes('масив')) return 'Дърво'
  if (lower.includes('metal') || lower.includes('метал')) return 'Метал'
  return undefined
}

function inferColor(value: string): string | undefined {
  const lower = value.toLowerCase()
  const colors: Array<[string, string]> = [
    ['white', 'Бяло'],
    ['бял', 'Бяло'],
    ['pink', 'Розово'],
    ['роз', 'Розово'],
    ['grey', 'Сиво'],
    ['gray', 'Сиво'],
    ['сив', 'Сиво'],
    ['natural', 'Натурално'],
    ['натурал', 'Натурално']
  ]
  return colors.find(([term]) => lower.includes(term))?.[1]
}

function inferRoomStyle(product: SourceProduct): string {
  const haystack = `${product.title} ${product.tags.join(' ')}`.toLowerCase()
  if (haystack.includes('montessori') || haystack.includes('монтесори')) return 'Монтесори'
  return 'Уютна детска стая'
}

function textMetafield(key: string, value?: string): BabyMoodMetafield | undefined {
  return value ? { namespace: 'custom', key, type: 'single_line_text_field', value } : undefined
}

function longMetafield(key: string, value?: string): BabyMoodMetafield | undefined {
  return value ? { namespace: 'custom', key, type: 'multi_line_text_field', value } : undefined
}

function listMetafield(key: string, value: string[]): BabyMoodMetafield {
  return { namespace: 'custom', key, type: 'list.single_line_text_field', value: JSON.stringify(value) }
}

function compactMetafields(values: Array<BabyMoodMetafield | undefined>): BabyMoodMetafield[] {
  return values.filter((value): value is BabyMoodMetafield => Boolean(value))
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trim()}`
}

function printHelp() {
  console.log(`
Transform source products into Baby Mood import format.

Usage:
  npm run transform:products -- --source-file=data/source/sample.json --limit=5
  npm run transform:products -- --output-file=data/transformed/sample.json
`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
