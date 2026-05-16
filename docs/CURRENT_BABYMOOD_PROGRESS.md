# Current Baby Mood Progress

Last checked: 2026-05-16, repo `/Users/nikolaiv37/websites/babymood`.

## 1. Project Identity

- Store name: Baby Mood / Babymood.bg
- Shopify theme: Horizon
- Main focus: Montessori beds and children's furniture
- Brand tone: warm, premium, playful, parent-friendly, trustworthy; not cheap, aggressive, or cartoonish.

## 2. Shopify / Theme Details

- Live storefront: `babymood.bg`
- Store domain used in recent CLI work: `a3rtjd-ia.myshopify.com`
- Theme ID used in recent theme commands/context: `196693557595`
- Pushed/pulled theme work should target the pulled theme folder at `theme/`.
- Template JSON files are often modified by Shopify Theme Editor. Pull before editing/pushing template JSON if live editor changes were made.

Common theme commands:

```bash
shopify theme push --store a3rtjd-ia.myshopify.com --theme 196693557595 --path theme --only <file>
shopify theme pull --store a3rtjd-ia.myshopify.com --theme 196693557595 --path theme --only templates/index.json
```

Note: `scripts/theme/pull-theme.ts` still documents a generic `babymood.bg` / `<HORIZON_THEME_ID>` command, so prefer the explicit command above unless intentionally changing targets.

## 3. Git / Repo State

- Current branch: `main`
- Remote origin: `https://github.com/nikolaiv37/babymood.git`
- Latest relevant commits:
  - `4387c02` Polish Baby Mood announcement and product trust copy
  - `4523252` Polish Baby Mood hero and product trust copy
  - `1c8e4dd` Add Baby Mood branded typography layer
  - `d8432f6` Add Baby Mood homepage FAQ section
  - `82f0d36` Add Baby Mood Montessori homepage story section
  - `3f20985` Add Baby Mood homepage category mosaic
  - `4edc3d8` Add Baby Mood homepage trust strip

Current `git status --short` shows untracked `logs/` because `logs/*.log` is ignored but `logs/import-summary-*.json` is not ignored.

## 4. Custom Homepage Sections

Confirmed files in `theme/sections/`:

- `theme/sections/bm-home-hero.liquid`
  - Homepage hero for Baby Mood.
  - Current copy direction: Montessori beds and children's furniture for a cozy children's room.
  - Supports highlighted heading text, CTA buttons, chips/pills, and hero imagery.

- `theme/sections/bm-home-trust-strip.liquid`
  - Compact trust strip for reassurance near the top of the homepage.
  - Copy direction: consultation before ordering, curated children's furniture, calm/parent-friendly reassurance.

- `theme/sections/bm-home-category-mosaic.liquid`
  - Homepage category tiles/mosaic.
  - Default heading: `Разгледай категории`.
  - Copy direction: curated categories for cozy, practical, calm children's rooms.

- `theme/sections/bm-home-montessori-story.liquid`
  - Editorial Montessori education/story section.
  - Default heading: `Защо Монтесори легло?`
  - Explains low-bed independence, calmer evening routine, and practical child-room design.

- `theme/sections/bm-home-faq.liquid`
  - Homepage FAQ section.
  - Covers age suitability, delivery, payment/return questions, and choosing the right product.

## 5. Product Page Custom Blocks / Sections

Main Montessori product template:

- `theme/templates/product.montesori-product-temp.json`

Product information/details area:

- `theme/sections/product-information.liquid`
- `theme/blocks/_product-details.liquid`

Custom blocks inside product information:

- `theme/blocks/bm-free-delivery-notice.liquid`
  - Green delivery notice near price/buy area.
  - Current template copy:
    - `Безплатна доставка`
    - `Безплатна доставка до офис на Еконт за всяка поръчка от Baby Mood.`

- `theme/blocks/bm-cta-reassurance.liquid`
  - Addable inside Product information -> Details.
  - Current template copy:
    1. `14 дни връщане` / `Спокойна и лесна покупка`
    2. `Без предплащане` / `Плащане при получаване`
    3. `Проверка преди изпращане` / `Преглеждаме поръчката преди доставка`
    4. `Потвърждение на поръчката` / `Преди изпращане при нужда`

Lower product page sections confirmed in `theme/sections/`:

- `theme/sections/bm-product-trust-bar.liquid`
  - Lower trust cards.
  - Current template uses:
    - `Безопасни материали`
    - `Консултация преди поръчка`
    - `14 дни право на връщане`
    - Econt delivery block exists but is disabled in the current Montessori template.
  - User-facing direction requested in later copy: lower trust cards should emphasize `Безопасни материали`, `Консултация преди поръчка`, `Спокойна покупка онлайн`.

- `theme/sections/bm-product-specs.liquid`
  - Structured product specs from metafields.
  - Renders mattress size, material, color, dimensions, suitable age, what's included.

- `theme/sections/bm-product-accordion-details.liquid`
  - Native `<details>/<summary>` accordions for longer product information.
  - Intended lower on product page to keep top buying area shorter.
  - Includes product description, delivery, and return/consultation accordions.

- `theme/sections/bm-montessori-benefits.liquid`
  - Editorial section explaining why Montessori beds help children and parents.
  - Supports Theme Editor image picker with SVG fallback.

- `theme/sections/bm-product-highlights.liquid`
  - Renders `product.metafields.custom.product_highlights`.

- `theme/sections/bm-product-cta-reassurance.liquid`
  - Standalone CTA reassurance section still exists, but current direction is to use the block `theme/blocks/bm-cta-reassurance.liquid` inside Product information instead.
  - It is disabled in `theme/templates/product.montesori-product-temp.json`.

## 6. Typography System

- Central snippet: `theme/snippets/bm-custom-heading-font.liquid`
- Rendered from: `theme/layout/theme.liquid`
- Google Fonts:
  - `Kurale` for brand/display/navigation/buttons/product titles/headings.
  - `Manrope` for readable body text/descriptions/prices/helper text.
- Announcement bar clipping fix is in the same snippet via scoped `line-height` and `padding-block` rules.
- Do not edit fonts randomly. Keep typography changes centralized in `theme/snippets/bm-custom-heading-font.liquid`.
- Be careful with `theme/layout/theme.liquid`; it is global.

## 7. Homepage Copy Decisions

Current hero in `theme/templates/index.json`:

- Heading: `Монтесори легла и детски мебели за уютна детска стая`
- Highlighted part: `Монтесори легла`
- Remaining meaning: `и детски мебели за уютна детска стая`
- Pills:
  - `Подбрани модели`
  - `Безопасен избор`
  - `Консултация преди покупка`

Announcement bar in `theme/sections/header-group.json`:

- `Безплатна доставка за всяка поръчка до офис на Еконт`

Short version used in project direction:

- `Безплатна доставка до офис на Еконт`

## 8. Product Import Pipeline

Scripts in `scripts/products/`:

- `scripts/products/export-source-products.ts`
  - Package script: `npm run export:source`
  - Exports selected products from the source store by collection handle, tag, or product type.
  - Uses paginated GraphQL.
  - No `--limit` now means all pages; it no longer defaults to 50.

- `scripts/products/transform-products-for-babymood.ts`
  - Package script: `npm run transform:products`
  - Transforms MebelCenter products into Baby Mood format.
  - Improves Bulgarian titles, SEO, descriptions, collections, tags, metafields, product highlights, material, dimensions, and included-items text.
  - Does not change SKU, handle, price, variants, images, or inventory behavior.

- `scripts/products/import-products-to-babymood.ts`
  - Package scripts:
    - `npm run import:products:dry`
    - `npm run import:products:apply`
  - Dry-run still performs read-only lookup.
  - Apply requires `--apply`; updates require `--allow-update`.
  - Writes import summaries to `logs/import-summary-*.json`.
  - Prints import summary.
  - Assigns `templateSuffix: montesori-product-temp` automatically where applicable.
  - Update payload does not send `productOptions` on API `2026-04`.

- `scripts/products/create-metafield-definitions.ts`
  - Creates Baby Mood product metafield definitions.
  - `visibleToStorefrontApi` was removed because it is invalid for Admin GraphQL `2026-04`.

- `scripts/products/assign-collections.ts`
  - Collection assignment helper.

Confirmed import state from local files:

- Source export: `data/source/2026-05-15T14-48-08-142Z-source-products.json`
  - Tag: `Легла Монтесори`
  - Product count: `58`
- Transform: `data/transformed/montessori-full.json`
  - Product count: `58`
- Final full import summary: `logs/import-summary-2026-05-15T14-58-33-636Z.json`
  - Processed: `58`
  - Created: `8`
  - Updated: `50`
  - Skipped: `0`
  - Failed: `0`

Git ignore status:

- `data/source/*.json`, `data/transformed/*.json`, and `logs/*.log` are ignored.
- `logs/import-summary-*.json` are currently not ignored and show as untracked via the `logs/` directory.

## 9. Important Commands

Export all Montessori beds:

```bash
npm run export:source -- --tag="Легла Монтесори"
```

Transform:

```bash
npm run transform:products -- \
  --source-file=data/source/<latest-source-file>.json \
  --output-file=data/transformed/montessori-full.json
```

Dry run:

```bash
npm run import:products:dry -- \
  --source-file=data/transformed/montessori-full.json \
  --allow-update
```

Apply:

```bash
npm run import:products:apply -- \
  --source-file=data/transformed/montessori-full.json \
  --allow-update
```

Theme push example:

```bash
shopify theme push --store a3rtjd-ia.myshopify.com --theme 196693557595 --path theme \
  --only <file>
```

Theme pull example:

```bash
shopify theme pull --store a3rtjd-ia.myshopify.com --theme 196693557595 --path theme \
  --only templates/index.json
```

## 10. Do-Not-Touch / Caution List

- Do not edit product-card Liquid unless absolutely necessary.
- Do not edit shared Horizon `product-list`, `accordion`, or generic `section` files unless carefully scoped.
- Avoid global CSS except through the centralized typography snippet.
- Avoid pushing template JSON if live Theme Editor changed it and you have not pulled first.
- Do not commit logs unless intentionally needed.
- Be careful with `theme/layout/theme.liquid`; it is global.
- Prefer pushing individual changed theme files with `--only`.
- Do not run Shopify import apply commands unless explicitly intended.

## 11. Current Visual State

- Homepage top is mostly landed.
- Product page Montessori template is mostly landed.
- Typography is landed and should not be changed unless strongly needed.
- Announcement/header/product trust copy were recently polished.
- CTA reassurance is now a block inside Product information details, which is the preferred placement.
- Standalone product CTA reassurance section still exists but is disabled in the Montessori product template.

## 12. Recommended Next Steps

- Review mobile homepage and mobile product page.
- Polish collection page for Montessori beds, including `theme/templates/collection.montesori-coll-temp.json`.
- Check product card consistency and image ratios.
- Review cart/checkout messaging if Shopify allows it.
- Add or review SEO titles/meta descriptions.
- Add structured data/FAQ only if useful and scoped.
- Continue remaining category/product imports if needed.
- Decide whether `logs/import-summary-*.json` should be ignored or committed intentionally.
