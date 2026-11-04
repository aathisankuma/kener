---
title: Site Customizations
description: Configure footer, colors, fonts, theme, announcements, and custom CSS behavior
---

Use **Manage → Customizations** to control visual behavior of the public status page.

## What you can customize {#what-you-can-customize}

- Design of the status page (preset and options)
- Site footer HTML
- Status colors (light + dark)
- Font source and font family
- Default theme and theme toggle
- Site-wide announcement banner
- Custom CSS (stored now, injection pending)
- Page ordering in the page switcher

## Runtime impact map {#runtime-impact-map}

| Customization  | Stored key                  | Runtime impact                                                  |
| -------------- | --------------------------- | --------------------------------------------------------------- |
| Design         | `designSettings`            | `data-*` attributes on the public page, styled in `designs.css` |
| Footer         | `footerHTML`                | Rendered by public footer component                             |
| Status colors  | `colors`, `colorsDark`      | Injected as CSS variables in public layout `<head>`             |
| Font           | `font` (`cssSrc`, `family`) | Loads font stylesheet and applies global `--font-family`        |
| Theme defaults | `theme`, `themeToggle`      | Sets initial mode and controls whether users can toggle theme   |
| Announcement   | `announcement`              | Renders site banner when title + message are present            |
| Custom CSS     | `customCSS`                 | Injected as `<style>` block in public layout `<head>`           |
| Page ordering  | `pageOrderingSettings`      | Controls page display order in the public page switcher         |

## Design {#design}

Pick one of six designs with a click. Each card shows a small preview:

| Design   | Menu bar         | Overall status | Services   | Corners        | Spacing |
| -------- | ---------------- | -------------- | ---------- | -------------- | ------- |
| Standard | Floating         | Outlined       | In one box | Round          | Normal  |
| Classic  | Brand-colour bar | Filled         | In one box | Slightly round | Normal  |
| Cards    | Floating         | Filled         | As cards   | Round          | Normal  |
| Compact  | Brand-colour bar | Outlined       | In one box | Straight       | Compact |
| Bold     | Brand-colour bar | Filled         | As cards   | Round          | Normal  |
| Portal   | Brand-colour bar | Filled         | As cards   | Straight       | Normal  |

**Portal** also sets **Layout** to _Portal_: a service portal look. On the home page, and on other pages shown as a grid, a hero in the brand colour with a picture sits at the top and each service is an app card with its icon and a status badge (_Operational_, _Major Outage_, …). On pages shown as a list, services form a plain list with the status on the right; the description opens from a **?** next to the name. With _Kener_ as layout, the page keeps Kener's own structure. For the look in the screenshots of many hosted status pages, choose **Portal** and set **Brand colour** to `#0052cc`.

Then change any option on its own; the design is then shown as your own combination. **Services per row** sets how many services sit side by side, with every design: on grid pages and the portal start page as cards, on list pages as columns. _Automatic_ keeps what the layout does (one list, Kener's grid, two app cards in the portal), or choose 1 to 4. Phones always show one service per row and tablets at most two; the setting stays as it is when you pick another design. **Brand colour** colours the menu bar; without it, the accent colour under **Status Colors** is used. Click **Save Design** and reload the status page.

The design is applied before your **Custom CSS**, so custom CSS can still change anything. If an older custom CSS styles the same parts (for example the menu bar), remove those rules or keep the **Standard** design.

### Personal design {#personal-design}

Everyone who is signed in sees **Design** in the menu bar of the status page. There they pick a design and the number of services per row for themselves; only they see it, and the site's brand colour stays. **As set for everyone** goes back to the design chosen here. The choices are kept in cookies (`kener-design`, `kener-columns`) in that browser, so it applies on that device only. Visitors who are not signed in always see the design set here.

## Footer HTML {#footer-html}

Footer content is rendered as HTML on the public page.

> [!CAUTION]
> Keep footer HTML trusted and minimal. It is rendered directly.

## Colors and fonts {#colors-and-fonts}

Color settings feed CSS variables for status/accent colors in the public layout. Font settings:

- load `font.cssSrc` as stylesheet
- set `--font-family`
- apply global font family

## Theme and announcement {#theme-and-announcement}

- `theme` sets default mode (`light`, `dark`, `system`)
- `themeToggle` controls whether users can switch theme in UI
- announcement banner appears when both `title` and `message` are set

## Custom CSS {#custom-css-status}

`customCSS` is injected as a `<style>` block in the public layout `<head>`. Do not include `<style>` tags — only raw CSS.

Use Custom CSS to override styles, add `@font-face` rules for self-hosted fonts, or customize the status page appearance beyond the built-in settings.

See [Custom Fonts guide](/docs/v4/guides/custom-fonts) for font-specific examples.

## Page ordering {#page-ordering}

Control the display order of pages in the public page switcher.

- **Enable custom page ordering** — when enabled, pages appear in the saved order instead of creation order.
- Use the up/down arrows to reorder pages.
- New pages added after saving will appear at the end of the list automatically.
- Disabling ordering reverts the public display to default (creation order) but preserves your saved order for later re-enabling.

Stored as `pageOrderingSettings` with `enabled` (boolean) and `order` (array of page IDs).

## Verify changes {#verify-changes}

- Update footer and refresh page.
- Change color values and confirm status/accent colors update.
- Set font URL/family and confirm typography changes.
- Toggle theme settings and verify theme toggle visibility.
- Create announcement and verify banner appears.
- Enable page ordering, reorder pages, and verify the page switcher reflects the new order.
