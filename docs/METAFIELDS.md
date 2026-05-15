# Baby Mood Product Metafields

All Baby Mood product metafields use namespace `custom` and owner type `PRODUCT`.

| Key | Type | Purpose |
| --- | --- | --- |
| `suitable_age` | `single_line_text_field` | Recommended age or usage guidance. |
| `mattress_size` | `single_line_text_field` | Mattress size when relevant. |
| `material` | `single_line_text_field` | Main material. |
| `color` | `single_line_text_field` | Main color. |
| `dimensions` | `single_line_text_field` | Product dimensions. |
| `whats_included` | `multi_line_text_field` | Included parts and exclusions. |
| `parent_benefit` | `multi_line_text_field` | Parent-facing benefit. |
| `safety_note` | `multi_line_text_field` | Safety note for product page. |
| `delivery_note` | `multi_line_text_field` | Delivery and availability note. |
| `care_instructions` | `multi_line_text_field` | Cleaning and care instructions. |
| `room_style` | `single_line_text_field` | Room or design style. |
| `product_highlights` | `list.single_line_text_field` | Bullet highlights. |
| `faq_1_question` | `single_line_text_field` | FAQ question 1. |
| `faq_1_answer` | `multi_line_text_field` | FAQ answer 1. |
| `faq_2_question` | `single_line_text_field` | FAQ question 2. |
| `faq_2_answer` | `multi_line_text_field` | FAQ answer 2. |
| `faq_3_question` | `single_line_text_field` | FAQ question 3. |
| `faq_3_answer` | `multi_line_text_field` | FAQ answer 3. |

## Create Definitions

Dry-run:

```bash
npm run metafields:create:dry
```

Apply:

```bash
npm run metafields:create:apply
```

The script logs each definition. If Shopify reports that a definition already exists, review the warning and continue only if the existing type matches this document.
