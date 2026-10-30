# LogFlow Assets

Open `preview.html` to see everything.

```
brand/          logo mark, full logos (light/dark bg), favicon.svg, og-image.svg
icons/ui/       66 SVG icons (24px, stroke, currentColor)
icons/sprite.svg  same icons as <symbol id="lf-NAME"> sprite
icons/levels/   trace / debug / info / warn / error / fatal badges
illustrations/  empty states (logs, search, alerts), 404, hero stream
fonts/          Space Grotesk (display), Inter (UI), JetBrains Mono (logs) + fonts.css
styles/         tokens.css (colors/type/spacing, light + dark), base.css, components.css, tailwind.preset.js
png/            favicons 16-512, og-image.png, logo @2x
```

## Use
```html
<link rel="icon" href="/logflow-assets/brand/favicon.svg">
<link rel="stylesheet" href="/logflow-assets/styles/base.css">
<link rel="stylesheet" href="/logflow-assets/styles/components.css">
<html data-theme="dark"> <!-- optional dark mode -->
<svg class="lf-icon"><use href="/logflow-assets/icons/sprite.svg#lf-search"/></svg>
<span class="lf-level lf-level--error">ERROR</span>
```
Palette: Navy #0B1B33 · Teal #14B8A6 · Blue #3B6BFF.
Fonts: SIL OFL (licenses included). Icons/logo: original, free to use in your project.
