export interface SourceProduct {
  id: string
  title: string
  handle: string
  descriptionHtml: string
  vendor: string
  productType: string
  tags: string[]
  status: string
  seo?: { title?: string | null; description?: string | null } | null
  images: { id: string; url: string; altText?: string | null }[]
  media: SourceMedia[]
  collections: SourceCollection[]
  options: { id: string; name: string; values: string[] }[]
  variants: SourceVariant[]
  metafields: SourceMetafield[]
}

export interface SourceMedia {
  id: string
  alt?: string | null
  mediaContentType: string
  preview?: { image?: { url: string; altText?: string | null } | null } | null
}

export interface SourceCollection {
  id: string
  handle: string
  title: string
}

export interface SourceVariant {
  id: string
  title: string
  sku?: string | null
  barcode?: string | null
  price: string
  compareAtPrice?: string | null
  inventoryPolicy: 'DENY' | 'CONTINUE'
  inventoryQuantity?: number | null
  inventoryItem?: {
    id: string
    sku?: string | null
    tracked: boolean
    requiresShipping: boolean
  } | null
  taxable: boolean
  selectedOptions: { name: string; value: string }[]
}

export interface SourceMetafield {
  namespace: string
  key: string
  type: string
  value: string
}

export interface SourceExportFile {
  exportedAt: string
  source: {
    collectionHandle?: string
    tag?: string
    productType?: string
    limit: number
  }
  products: SourceProduct[]
}

export interface BabyMoodProduct {
  sourceProductId: string
  sourceHandle: string
  title: string
  handle: string
  descriptionHtml: string
  vendor: 'Baby Mood'
  productType: string
  status: 'DRAFT' | 'ACTIVE'
  tags: string[]
  seo: { title: string; description: string }
  collections: string[]
  images: { url: string; altText?: string | null }[]
  options: { name: string; values: string[] }[]
  variants: BabyMoodVariant[]
  metafields: BabyMoodMetafield[]
}

export interface BabyMoodVariant {
  title: string
  sku?: string | null
  barcode?: string | null
  price: string
  compareAtPrice?: string | null
  inventoryPolicy: 'DENY'
  taxable: boolean
  requiresShipping: boolean
  selectedOptions: { name: string; value: string }[]
}

export interface BabyMoodMetafield {
  namespace: 'custom'
  key: string
  type: 'single_line_text_field' | 'multi_line_text_field' | 'list.single_line_text_field'
  value: string
}

export interface BabyMoodTransformFile {
  transformedAt: string
  sourceFile: string
  products: BabyMoodProduct[]
}
