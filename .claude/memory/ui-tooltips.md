# UI convention — narrow tooltips

Native `title` tooltips in this web app must be kept **narrow** — wrapped to ~44 chars/line (narrow-and-tall), the way the Image Impact ("estimated imaging impact" ellipse) tooltips already are. `web/src/components/ImageImpact.tsx` has a `wrap(text, max=52)` helper that inserts newlines so the native tooltip renders narrow-and-tall; that pattern is the reference the user called "good."

Wide, single-line tooltips (e.g. the polar-alignment bullseye / "!" tooltips before this convention) are **too wide** — they overflow the chart area and are hard to read.

**How to apply:** extract `wrap()` from `ImageImpact.tsx` into a shared util and run all tooltip text through it before passing to `title=`. Applies to new tooltips and to fixing existing ones, now and in the future.
