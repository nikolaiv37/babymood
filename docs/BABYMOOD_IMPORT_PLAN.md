# Baby Mood Import Plan

Baby Mood is a Bulgarian-only Shopify store for Montessori beds, children beds, supplementary children's furniture, and children lamps. Products are selected from the MebelCenter catalog, exported locally, transformed into Baby Mood brand language, then imported into the Baby Mood Shopify store.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from the example:

```bash
cp .env.example .env
```

3. Fill in the store domains and one authentication option for each store.

The tooling supports two Shopify Admin API auth modes. If an `*_SHOPIFY_ADMIN_TOKEN` value is present, it is used first. If the Admin token is empty, the script uses `*_SHOPIFY_CLIENT_ID` and `*_SHOPIFY_CLIENT_SECRET` to request a runtime Admin API access token from Shopify. Runtime tokens are cached in memory only for the current script run.

Static token mode:

```bash
SOURCE_SHOPIFY_STORE_DOMAIN=mebel-center.myshopify.com
SOURCE_SHOPIFY_ADMIN_TOKEN=shpat_...
BABYMOOD_SHOPIFY_STORE_DOMAIN=babymood-bg.myshopify.com
BABYMOOD_SHOPIFY_ADMIN_TOKEN=shpat_...
API_VERSION=2026-04
```

Client credentials mode:

```bash
SOURCE_SHOPIFY_STORE_DOMAIN=mebel-center.myshopify.com
SOURCE_SHOPIFY_ADMIN_TOKEN=
SOURCE_SHOPIFY_CLIENT_ID=...
SOURCE_SHOPIFY_CLIENT_SECRET=...
BABYMOOD_SHOPIFY_STORE_DOMAIN=babymood-bg.myshopify.com
BABYMOOD_SHOPIFY_ADMIN_TOKEN=
BABYMOOD_SHOPIFY_CLIENT_ID=...
BABYMOOD_SHOPIFY_CLIENT_SECRET=...
API_VERSION=2026-04
```

`API_VERSION` is shared by both source and Baby Mood scripts. It is set to `2026-04` for Baby Mood compatibility. Do not commit `.env`; it is ignored by git.

4. Test both store credentials with a read-only shop query:

```bash
npm run auth:test
```

## Dry Export

Do not assume source collection handles. Choose one selector after checking the MebelCenter catalog:

```bash
npm run export:source -- --collection-handle=<handle> --limit=5
npm run export:source -- --tag=<tag> --limit=5
npm run export:source -- --product-type="<type>" --limit=5
```

Exports are saved to `data/source`.

## Transform

Transform the most recent source export:

```bash
npm run transform:products -- --limit=5
```

Or transform an explicit file:

```bash
npm run transform:products -- --source-file=data/source/<file>.json --output-file=data/transformed/sample-5.json
```

Transformed files are saved to `data/transformed`.

## Import First 5 Products

Dry-run first:

```bash
npm run import:products:dry -- --source-file=data/transformed/sample-5.json --limit=5
```

Apply only after reviewing the transformed JSON and dry-run logs:

```bash
npm run import:products:apply -- --source-file=data/transformed/sample-5.json --limit=5
```

Existing products are skipped unless `--allow-update` is passed:

```bash
npm run import:products:apply -- --source-file=data/transformed/sample-5.json --limit=5 --allow-update
```

## Apply Full Import Later

1. Export the selected full product set with the right selector.
2. Transform the full source export.
3. Run a dry import without `--limit`.
4. Review `logs/*.log` and the transformed JSON.
5. Create metafield definitions in Baby Mood if needed.
6. Apply the import.
7. Assign collections if collection assignment is not handled during the product workflow.

```bash
npm run metafields:create:apply
npm run import:products:apply -- --source-file=data/transformed/<full-file>.json
npm run collections:assign -- --source-file=data/transformed/<full-file>.json --apply
```

## Safety Checklist Before Applying

- `.env` points to the correct source store and Baby Mood store.
- `API_VERSION` is set to `2026-04`.
- `npm run auth:test` succeeds for source and Baby Mood.
- The transformed JSON contains only intended products.
- Product titles and SEO fields are Bulgarian and appropriate for Baby Mood.
- Images and variants are preserved.
- Collection handles in `collections` exist in Baby Mood.
- Metafield definitions exist or `npm run metafields:create:apply` has been run.
- Dry-run logs show the expected create/update actions.
- `--allow-update` is used only when updating existing products is intended.
- `--apply` is used only after reviewing dry-run output.

## Safe Test Commands

Replace `<selector>` with one real source selector:

```bash
npm run export:source -- --collection-handle=<selector> --limit=5
npm run transform:products -- --limit=5 --output-file=data/transformed/safe-test-5.json
npm run metafields:create:dry
npm run import:products:dry -- --source-file=data/transformed/safe-test-5.json --limit=5
```
