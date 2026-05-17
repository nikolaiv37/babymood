import { latestJsonFile, getNumberArg, getStringArg, parseArgs, readJsonFile, writeJsonFile } from '../utils/files.js'
import { createLogger, timestampForFile } from '../utils/logger.js'
import type { BabyMoodMetafield, BabyMoodProduct, BabyMoodTransformFile, SourceExportFile, SourceProduct } from './types.js'

const COLLECTION_RULES: Array<{ handle: string; terms: string[] }> = [
  { handle: 'montessori-legla', terms: ['montessori', 'монтесори', 'floor bed', 'подово'] },
  { handle: 'detski-legla', terms: ['bed', 'легло', 'children bed', 'kids bed'] },
  { handle: 'detski-mebeli', terms: ['furniture', 'мебел', 'шкаф', 'скрин', 'етажер', 'детска стая'] },
  { handle: 'detski-lampi', terms: ['lamp', 'лампа', 'лампи', 'таванни лампи', 'осветление'] }
]

const TEMPLATE_RULES: Array<{ sourceTag: string; templateSuffix: string }> = [
  { sourceTag: 'Легла Монтесори', templateSuffix: 'montesori-product-temp' },
  { sourceTag: 'Детска стая', templateSuffix: 'kids-room-product-temp' },
  { sourceTag: 'Детски таванни лампи', templateSuffix: 'kids-lamps-product-temp' },
  { sourceTag: 'Настолни лампи', templateSuffix: 'kids-lamps-product-temp' }
]

const SOURCE_TAG_COLLECTIONS: Record<string, string[]> = {
  [normalizeCategoryValue('Детска стая')]: ['detski-mebeli'],
  [normalizeCategoryValue('Детски таванни лампи')]: ['detski-lampi'],
  [normalizeCategoryValue('Настолни лампи')]: ['detski-lampi']
}

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
  const filteredProducts = filterSourceProductsForTransform(source.products, source.source.tag)
  const products = filteredProducts
    .slice(0, limit ?? source.products.length)
    .map((product) => transformProduct(product, source.source.tag))

  const transformed: BabyMoodTransformFile = {
    transformedAt: new Date().toISOString(),
    sourceFile,
    products
  }

  const path = writeJsonFile(outputFile, transformed)
  logger.success('Products transformed for Baby Mood', {
    sourceFile,
    path,
    productCount: products.length,
    skippedProductCount: source.products.length - filteredProducts.length,
    sourceSelector: source.source,
    categorySummary: summarizeTemplateAssignments(source, products, source.products.length - filteredProducts.length)
  })
}

function transformProduct(product: SourceProduct, sourceTag?: string): BabyMoodProduct {
  const title = makeBulgarianTitle(product)
  const descriptionText = stripHtml(product.descriptionHtml)
  const fullText = `${product.title} ${descriptionText}`
  const isLampCategory = isLampSourceTag(sourceTag)
  const collections = inferCollections(product, sourceTag)
  const tags = mapTags(product, collections, sourceTag)
  const mattressSize = shouldEmitMattressSize(product, sourceTag, fullText, title) ? inferMattressSize(fullText) : undefined
  const dimensions = inferDimensions(fullText)
  const material = inferMaterial(fullText)
  const color = inferColor(fullText)
  const isMontessori = isMontessoriBed(product, title)
  const templateSuffix = inferTemplateSuffix(product, sourceTag) ?? (isMontessori ? 'montesori-product-temp' : undefined)
  const content = productContentForCategory(product, title, descriptionText, sourceTag)

  return {
    sourceProductId: product.id,
    sourceHandle: product.handle,
    title,
    handle: product.handle,
    descriptionHtml: cleanDescriptionHtml(product, title),
    vendor: 'Baby Mood',
    productType: normalizeProductType(product),
    status: isMontessori ? 'ACTIVE' : 'DRAFT',
    ...(templateSuffix ? { templateSuffix } : {}),
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
      requiresShipping: variant.inventoryItem?.requiresShipping ?? true,
      selectedOptions: variant.selectedOptions
    })),
    metafields: compactMetafields([
      textMetafield('suitable_age', content.suitableAge),
      textMetafield('mattress_size', mattressSize),
      textMetafield('material', material),
      textMetafield('color', color),
      textMetafield('dimensions', dimensions),
      longMetafield('whats_included', content.whatsIncluded),
      longMetafield('parent_benefit', content.parentBenefit),
      longMetafield('safety_note', content.safetyNote),
      longMetafield('delivery_note', 'Доставката се уточнява според наличност, адрес и размер на продукта.'),
      longMetafield('care_instructions', 'Почиствайте с мека суха или леко влажна кърпа. Избягвайте агресивни препарати.'),
      textMetafield('room_style', content.roomStyle),
      listMetafield('product_highlights', content.productHighlights),
      textMetafield('faq_1_question', content.faq1Question),
      longMetafield('faq_1_answer', content.faq1Answer),
      textMetafield('faq_2_question', content.faq2Question),
      longMetafield('faq_2_answer', content.faq2Answer),
      textMetafield('faq_3_question', content.faq3Question),
      longMetafield('faq_3_answer', content.faq3Answer)
    ])
  }
}

function productContentForCategory(product: SourceProduct, title: string, descriptionText: string, sourceTag?: string) {
  if (isSameCategory(sourceTag ?? '', 'Настолни лампи')) {
    return {
      suitableAge: 'Подходящо за бюро, нощно шкафче или кът за четене в детска стая.',
      whatsIncluded: inferLampWhatsIncluded(descriptionText),
      parentBenefit: 'Помага да създадете удобна светлина за четене, учене или спокойна вечерна рутина.',
      safetyNote: 'Използвайте продукта според инструкциите на производителя и с подходяща крушка според указаната мощност.',
      roomStyle: 'осветление за детска стая',
      productHighlights: [
        'Подходящо за детска стая',
        'Мек декоративен акцент',
        'Практично осветление'
      ],
      faq1Question: 'Включена ли е крушка?',
      faq1Answer: 'Крушката не е включена, освен ако не е изрично посочено в описанието.',
      faq2Question: 'Какъв тип крушка е подходящ?',
      faq2Answer: 'Използвайте съвместима крушка според фасунгата и препоръките на производителя.',
      faq3Question: 'Подходяща ли е за детска стая?',
      faq3Answer: 'Да, моделът е подбран за уютна детска стая. Монтажът трябва да се извърши според инструкциите.'
    }
  }

  if (isSameCategory(sourceTag ?? '', 'Детски таванни лампи')) {
    return {
      suitableAge: 'Подходящо за уютно осветление в детска стая, кът за игра или зона за четене.',
      whatsIncluded: inferLampWhatsIncluded(descriptionText),
      parentBenefit: 'Помага да създадете по-уютна и спокойна атмосфера в детската стая.',
      safetyNote: 'Монтажът трябва да се извърши според инструкциите на производителя. Използвайте подходяща крушка според указаната мощност.',
      roomStyle: 'осветление за детска стая',
      productHighlights: [
        'Подходящо за детска стая',
        'Мек декоративен акцент',
        'Практично осветление'
      ],
      faq1Question: 'Включена ли е крушка?',
      faq1Answer: 'Крушката не е включена, освен ако не е изрично посочено в описанието.',
      faq2Question: 'Какъв тип крушка е подходящ?',
      faq2Answer: 'Използвайте съвместима крушка според фасунгата и препоръките на производителя.',
      faq3Question: 'Подходяща ли е за детска стая?',
      faq3Answer: 'Да, моделът е подбран за уютна детска стая. Монтажът трябва да се извърши според инструкциите.'
    }
  }

  if (isSameCategory(sourceTag ?? '', 'Детска стая')) {
    return {
      suitableAge: 'Подходящо за обзавеждане на детска стая, според размера, нуждите и употребата на продукта.',
      whatsIncluded: inferKidsRoomWhatsIncluded(product, descriptionText),
      parentBenefit: 'Помага да създадете по-подредена, уютна и функционална детска стая.',
      safetyNote: 'Използвайте продукта според инструкциите на производителя. При мебели за деца препоръчваме стабилен монтаж и употреба под подходящ надзор.',
      roomStyle: 'уютна детска стая',
      productHighlights: [
        'Практично решение за детска стая',
        'Подходящо за ежедневна употреба',
        'Лесно за комбиниране'
      ],
      faq1Question: 'Подходящ ли е продуктът за детска стая?',
      faq1Answer: 'Да, продуктът е подбран за обзавеждане на детска стая. Винаги съобразявайте размерите и употребата с възрастта и нуждите на детето.',
      faq2Question: 'Какво е включено в комплекта?',
      faq2Answer: 'Включени са основните елементи за сглобяване според описанието на производителя. Аксесоари и декорация са включени само ако са изрично посочени.',
      faq3Question: 'Има ли нужда от сглобяване?',
      faq3Answer: 'Повечето мебели се доставят разглобени и се сглобяват според инструкциите на производителя.'
    }
  }

  return {
    suitableAge: inferAge(product),
    whatsIncluded: inferWhatsIncluded(descriptionText),
    parentBenefit: 'Създаден за по-спокойна детска стая, лесна ежедневна употреба и уютна среда за сън и игра.',
    safetyNote: 'Използвайте продукта според инструкциите на производителя и под надзор, съобразен с възрастта на детето.',
    roomStyle: inferRoomStyle(product),
    productHighlights: inferProductHighlights(product, title),
    faq1Question: 'Подходящ ли е продуктът за малко дете?',
    faq1Answer: 'Проверете препоръчаната възраст, размерите и инструкциите за безопасност преди покупка.',
    faq2Question: 'Включен ли е матрак?',
    faq2Answer: 'Матрак е включен само ако това е изрично посочено в описанието на продукта.',
    faq3Question: 'Как се поддържа продуктът?',
    faq3Answer: 'Препоръчва се нежно почистване с мека кърпа и спазване на указанията на производителя.'
  }
}

function filterSourceProductsForTransform(products: SourceProduct[], sourceTag?: string): SourceProduct[] {
  if (isSameCategory(sourceTag ?? '', 'Настолни лампи')) {
    return products.filter(isChildTableLampProduct)
  }

  return products
}

function isChildTableLampProduct(product: SourceProduct): boolean {
  const title = normalizeCategoryValue(product.title)
  return /детска\s+(?:led\s+|лед\s+)?настолна\s+лампа/u.test(title)
}

function isLampSourceTag(sourceTag?: string): boolean {
  return isSameCategory(sourceTag ?? '', 'Детски таванни лампи') || isSameCategory(sourceTag ?? '', 'Настолни лампи')
}

function inferTemplateSuffix(product: SourceProduct, sourceTag?: string): string | undefined {
  const sourceRule = sourceTag ? TEMPLATE_RULES.find((rule) => isSameCategory(rule.sourceTag, sourceTag)) : undefined
  if (sourceRule) return sourceRule.templateSuffix

  const tags = product.tags.map(normalizeCategoryValue)
  return TEMPLATE_RULES.find((rule) => tags.includes(normalizeCategoryValue(rule.sourceTag)))?.templateSuffix
}

function normalizeCategoryValue(value: string): string {
  return value.trim().toLocaleLowerCase('bg-BG')
}

function isSameCategory(left: string, right: string): boolean {
  return normalizeCategoryValue(left) === normalizeCategoryValue(right)
}

function summarizeTemplateAssignments(source: SourceExportFile, products: BabyMoodProduct[], skippedProductCount = 0) {
  const templateCounts: Record<string, number> = {}
  const collectionCounts: Record<string, number> = {}
  for (const product of products) {
    const suffix = product.templateSuffix ?? 'none'
    templateCounts[suffix] = (templateCounts[suffix] ?? 0) + 1
    for (const collection of product.collections) {
      collectionCounts[collection] = (collectionCounts[collection] ?? 0) + 1
    }
  }

  return {
    detectedSourceTag: source.source.tag ?? null,
    skippedProductCount,
    assignedTemplateSuffixes: templateCounts,
    assignedCollections: collectionCounts
  }
}

function makeBulgarianTitle(product: SourceProduct): string {
  const normalized = product.title
    .replace(/\bMontessori\b/gi, 'Монтесори')
    .replace(/\bKids?\b/gi, 'Детско')
    .replace(/\bChildren'?s?\b/gi, 'Детско')
    .replace(/\bBed\b/gi, 'легло')
    .replace(/\bLamp\b/gi, 'лампа')
    .replace(/\s+/g, ' ')
    .replace(/[.。]+$/g, '')
    .trim()

  if (isBedProduct(product)) {
    return buildBedTitle(product, normalized)
  }

  const base = normalized
    .replace(/\s+/g, ' ')
    .trim()

  if (/[а-яА-Я]/.test(base)) return base
  return `${normalizeProductType(product)} ${base}`.trim()
}

function buildBedTitle(product: SourceProduct, title: string): string {
  const model = extractBedModel(title)
  const material = extractPremiumMaterial(title) ?? inferMaterial(title)
  const color = inferColor(title)
  const size = normalizeMattressSize(title)
  const prefix = isMontessoriBed(product, title) ? 'Монтесори легло' : inferBedTitlePrefix(title)
  const titleStart = [prefix, model].filter(Boolean).join(' ')
  const shouldShowMaterial = material ? !titleStart.toLowerCase().includes(material.toLowerCase()) : false
  const titleWithMaterial = shouldShowMaterial && material ? `${titleStart} от ${material.toLowerCase()}` : titleStart
  const details = [color ? color.toLowerCase() : undefined, size].filter(Boolean)

  return truncate([titleWithMaterial, ...details].join(', ').replace(/\s+/g, ' ').trim(), 105)
}

function isBedProduct(product: SourceProduct): boolean {
  const haystack = `${product.title} ${product.productType} ${product.tags.join(' ')}`.toLowerCase()
  return haystack.includes('легло') || haystack.includes('bed')
}

function shouldEmitMattressSize(product: SourceProduct, sourceTag: string | undefined, fullText: string, transformedTitle: string): boolean {
  if (isLampSourceTag(sourceTag)) return false

  if (isSameCategory(sourceTag ?? '', 'Детска стая')) {
    return isKidsRoomBedProduct(product, transformedTitle) && inferMattressSize(fullText) !== undefined
  }

  return isBedProduct(product) && inferMattressSize(fullText) !== undefined
}

function isKidsRoomBedProduct(product: SourceProduct, transformedTitle: string): boolean {
  const title = `${product.title} ${transformedTitle}`.toLocaleLowerCase('bg-BG')
  const nonBedTerms = [
    'количка',
    'етажер',
    'рафт',
    'библиотек',
    'бюро',
    'стол',
    'столче',
    'маса',
    'масичка',
    'шкаф',
    'скрин',
    'гардероб',
    'пейка',
    'кутия',
    'закачалка',
    'кула',
    'пирамида',
    'органайзер'
  ]

  if (nonBedTerms.some((term) => title.includes(term))) return false
  return /(^|[^а-яa-z])(?:детско\s+)?(?:двуетажно\s+|метално\s+)?легло(?=$|[^а-яa-z])/u.test(title)
}

function isMontessoriBed(product: SourceProduct, title: string): boolean {
  const haystack = [
    title,
    product.productType,
    product.tags.join(' '),
    product.collections.map((collection) => `${collection.handle} ${collection.title}`).join(' ')
  ]
    .join(' ')
    .toLowerCase()

  return (haystack.includes('монтесори') || haystack.includes('montessori')) && !haystack.includes('двуетаж')
}

function inferBedTitlePrefix(title: string): string {
  const lower = title.toLowerCase()
  if (lower.includes('двуетаж')) {
    return lower.includes('метал') ? 'Двуетажно метално легло' : 'Двуетажно легло'
  }
  return 'Детско легло'
}

function extractBedModel(title: string): string | undefined {
  const cleaned = title
    .replace(/т\.?\s*Монтесори/giu, ' ')
    .replace(/Монтесори/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const match = cleaned.match(/(?:^|\s)(?:Детско\s+)?легло\s+(.+?)(?=\s+(?:т\.?|масивна|метално|метална|дървесина|в\s|за\s+матрак|-|\d{2,3}\s*x\s*\d{2,3}|$))/iu)
  const model = match?.[1]
    ?.replace(/\bот\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

  return model && /^[А-ЯA-Z]/.test(model) && !inferColor(model) ? model : undefined
}

function extractPremiumMaterial(value: string): string | undefined {
  const lower = value.toLowerCase()
  if (lower.includes('масивна борова дървесина')) return 'масивна борова дървесина'
  if (lower.includes('борова дървесина')) return 'борова дървесина'
  if (lower.includes('масивно дърво')) return 'масивно дърво'
  if (lower.includes('метално') || lower.includes('метална') || lower.includes('метал')) return 'метал'
  return undefined
}

function normalizeMattressSize(value: string): string | undefined {
  const match = value.match(/\b(\d{2,3})\s*x\s*(\d{2,3})\s*(?:cm|см)?\b/i)
  if (!match) return undefined

  const first = Number(match[1])
  const second = Number(match[2])
  if (!Number.isFinite(first) || !Number.isFinite(second)) return undefined

  const width = Math.min(first, second)
  const length = Math.max(first, second)
  return `${width}x${length} см`
}

function cleanDescriptionHtml(product: SourceProduct, title: string): string {
  const text = normalizeDescriptionText(product.descriptionHtml)
  const intro = `<p><strong>${escapeHtml(title)}</strong> е подбран продукт за уютна и функционална детска стая от Baby Mood.</p>`
  const source = text
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join('')

  return `${intro}${source}`.replace(/>\s+</g, '><').trim()
}

function inferCollections(product: SourceProduct, sourceTag?: string): string[] {
  const sourceCollections = sourceTag ? SOURCE_TAG_COLLECTIONS[normalizeCategoryValue(sourceTag)] : undefined
  if (sourceCollections) {
    return Array.from(new Set([...sourceCollections, ...inferSupplementalCollections(product, sourceTag ?? '')]))
  }

  const haystack = `${product.title} ${product.productType} ${product.tags.join(' ')}`.toLowerCase()
  const matches = COLLECTION_RULES.filter((rule) => rule.terms.some((term) => haystack.includes(term))).map((rule) => rule.handle)
  return Array.from(new Set(matches.length > 0 ? matches : ['detski-mebeli']))
}

function inferSupplementalCollections(product: SourceProduct, sourceTag: string): string[] {
  if (isSameCategory(sourceTag, 'Детска стая')) {
    return isBedProduct(product) ? ['detski-legla'] : []
  }

  return []
}

function mapTags(product: SourceProduct, collections: string[], sourceTag?: string): string[] {
  const mapped = product.tags
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .map((tag) => tag.replace(/^mebelcenter[:\s-]*/i, ''))

  const categoryTags = isSameCategory(sourceTag ?? '', 'Настолни лампи') ? ['детски настолни лампи', 'осветление'] : []

  return Array.from(new Set(['baby-mood', 'import-mebelcenter', ...collections, ...categoryTags, ...mapped]))
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
  return 'Подходящо за деца, които вече спят самостоятелно, при употреба според инструкциите за безопасност'
}

function inferMattressSize(value: string): string | undefined {
  return normalizeMattressSize(value)
}

function inferDimensions(value: string): string | undefined {
  const dimensionMatch = value.match(/\b(\d{2,3}(?:[.,]\d+)?)\s*x\s*(\d{2,3}(?:[.,]\d+)?)(?:\s*x\s*(\d{2,3}(?:[.,]\d+)?))?\s*(?:h)?\s*(?:cm|см)?\b/i)
  if (!dimensionMatch) return normalizeMattressSize(value)

  const parts = [dimensionMatch[1], dimensionMatch[2], dimensionMatch[3]]
    .filter((part): part is string => Boolean(part))
    .map(formatDimensionNumber)

  if (parts.length < 2) return undefined
  if (parts.length === 2) return `${normalizeTwoPartSize(parts[0], parts[1])} см`
  return `${parts.join('x')} см`
}

function inferMaterial(value: string): string | undefined {
  const lower = value.toLowerCase()
  if (lower.includes('mdf')) return 'MDF'
  if (lower.includes('metal') || lower.includes('метал')) return 'Метал'
  if (lower.includes('pine') || lower.includes('бор') || lower.includes('борова дървесина')) return 'Масивна борова дървесина'
  if (lower.includes('wood') || lower.includes('дърво') || lower.includes('масив')) return 'Дърво'
  return undefined
}

function inferColor(value: string): string | undefined {
  const lower = value.toLowerCase()
  const colors: Array<[RegExp, string]> = [
    [/(^|[^a-zа-я])white($|[^a-zа-я])/u, 'Бяло'],
    [/(^|[^a-zа-я])бял(?:о|а)?($|[^a-zа-я])/u, 'Бяло'],
    [/(^|[^a-zа-я])pink($|[^a-zа-я])/u, 'Розово'],
    [/(^|[^a-zа-я])розов(?:о|а)?($|[^a-zа-я])/u, 'Розово'],
    [/(^|[^a-zа-я])natural($|[^a-zа-я])/u, 'Натурално'],
    [/(^|[^a-zа-я])натурален($|[^a-zа-я])|(^|[^a-zа-я])натурално($|[^a-zа-я])/u, 'Натурално'],
    [/(^|[^a-zа-я])grey($|[^a-zа-я])|(^|[^a-zа-я])gray($|[^a-zа-я])/u, 'Сиво'],
    [/(^|[^a-zа-я])сив(?:о|а)?($|[^a-zа-я])/u, 'Сиво']
  ]
  return colors.find(([pattern]) => pattern.test(lower))?.[1]
}

function inferRoomStyle(product: SourceProduct): string {
  const haystack = `${product.title} ${product.tags.join(' ')}`.toLowerCase()
  if (haystack.includes('montessori') || haystack.includes('монтесори')) return 'Монтесори'
  return 'Уютна детска стая'
}

function inferProductHighlights(product: SourceProduct, title: string): string[] {
  if (isMontessoriBed(product, title)) {
    return [
      'Нисък профил за повече самостоятелност',
      'Подходящо за спокойна вечерна рутина',
      'Изчистен дизайн за уютна детска стая'
    ]
  }

  if (isBedProduct(product)) {
    return [
      'Практичен избор за детска стая',
      'Удобен размер за ежедневна употреба',
      'Топъл дизайн за уютно детско пространство'
    ]
  }

  return [
    'Подходящо за уютна детска стая',
    'Практичен избор за ежедневна употреба',
    'Лесно комбиниране с детско обзавеждане'
  ]
}

function inferWhatsIncluded(descriptionText: string): string {
  const lower = descriptionText.toLowerCase()
  const mattressNotIncluded =
    lower.includes('матраците се продават отделно') ||
    lower.includes('матракът се продава отделно') ||
    lower.includes('матрак не е включен') ||
    lower.includes('матракът не е включен') ||
    lower.includes('без матрак')

  if (mattressNotIncluded) {
    return 'Матракът не е включен в цената. Включени са основните елементи за сглобяване според описанието на производителя.'
  }

  return 'Включени са основните елементи за сглобяване според описанието на производителя. Матрак и декорация са включени само ако са изрично посочени.'
}

function inferKidsRoomWhatsIncluded(product: SourceProduct, descriptionText: string): string {
  if (isBedProduct(product) && mentionsMattress(descriptionText)) {
    return inferWhatsIncluded(descriptionText)
  }

  return 'Включени са основните елементи за сглобяване според описанието на производителя. Декорация и допълнителни аксесоари са включени само ако са изрично посочени.'
}

function mentionsMattress(value: string): boolean {
  return value.toLowerCase().includes('матрак')
}

function inferLampWhatsIncluded(descriptionText: string): string {
  const details = [
    'Включено е осветителното тяло.',
    'Крушка не е включена, освен ако не е изрично посочено.'
  ]
  const socket = inferBulbSocket(descriptionText)
  const wattage = inferMaxWattage(descriptionText)

  if (socket) details.push(`Фасунга: ${socket}.`)
  if (wattage) details.push(`Максимална мощност: ${wattage}.`)

  return details.join(' ')
}

function inferBulbSocket(value: string): string | undefined {
  const match = value.match(/\bE\s*27\b/i) ?? value.match(/\bЕ\s*27\b/i)
  return match ? 'E27' : undefined
}

function inferMaxWattage(value: string): string | undefined {
  const match = value.match(/(?:максим(?:ум|ална)?|max\.?)\s*(\d{1,3})\s*W/iu)
  return match ? `${match[1]}W` : undefined
}

function normalizeDescriptionText(html: string): string {
  return html
    .replace(/\*{2,}/g, ' ')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6])>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map(cleanCatalogLabelLine)
    .map(normalizeLooseSizes)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function cleanCatalogLabelLine(line: string): string {
  const withoutMarkers = line.replace(/\*{2,}/g, '').trim()
  const labelMatch = withoutMarkers.match(/^([А-ЯA-Z\s/.-]{3,}):$/u)
  if (!labelMatch) return withoutMarkers

  return titleCaseBulgarianLabel(labelMatch[1])
}

function titleCaseBulgarianLabel(value: string): string {
  const lower = value.toLocaleLowerCase('bg-BG')
  return lower.charAt(0).toLocaleUpperCase('bg-BG') + lower.slice(1)
}

function normalizeLooseSizes(value: string): string {
  return value.replace(
    /\b(\d{2,3}(?:[.,]\d+)?)\s*x\s*(\d{2,3}(?:[.,]\d+)?)(?![.,]\d)(?!\s*x)(?!\s*(?:cm|см))\b/gi,
    (_match, first: string, second: string) => `${normalizeTwoPartSize(first, second)} см`
  )
}

function formatDimensionNumber(value: string): string {
  const normalized = value.replace(',', '.')
  const number = Number(normalized)
  if (!Number.isFinite(number)) return value
  return Number.isInteger(number) ? String(number) : String(number).replace(/\.0+$/g, '')
}

function normalizeTwoPartSize(firstValue: string, secondValue: string): string {
  const first = Number(firstValue)
  const second = Number(secondValue)
  if (!Number.isFinite(first) || !Number.isFinite(second)) return `${firstValue}x${secondValue}`

  const width = Math.min(first, second)
  const length = Math.max(first, second)
  return `${formatDimensionNumber(String(width))}x${formatDimensionNumber(String(length))}`
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
