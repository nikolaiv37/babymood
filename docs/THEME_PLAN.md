# Baby Mood Horizon Theme Plan

The store uses Shopify Horizon. Theme work should happen after product import structure is stable, because product templates will depend on Baby Mood collections, metafields, and media.

## Pull Theme Locally

Install and authenticate Shopify CLI first:

```bash
npm install -g @shopify/cli@latest
shopify auth login
```

Pull the Horizon theme into a local `theme` folder:

```bash
shopify theme pull --store babymood.bg --theme <HORIZON_THEME_ID> --path theme
```

The local helper script documents the command without executing it:

```bash
npm run theme:pull
```

## Initial Theme Priorities

- Product page: show Baby Mood metafields for age, mattress size, materials, dimensions, safety note, delivery note, care, highlights, and FAQ.
- Collection pages: create navigation for Montessori beds, children beds, children's furniture, and children lamps.
- Bulgarian market: keep storefront text in Bulgarian.
- SEO: ensure product title, meta title, and meta description are clear and not copied directly from the source catalog.
- Trust content: emphasize safety, delivery clarity, materials, and parent benefit.

## Safety Rules

- Pull before editing.
- Keep theme changes in version control.
- Do not publish directly from local files until product data has been reviewed.
- Test with a duplicate/unpublished theme before publishing.
