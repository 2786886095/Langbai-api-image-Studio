# Langbai patches

This package is vendored from `theblitzapp/flutter-webview-windows` commit
`2ae79f8cda1c3846ea24b9c67d522162cdd8a846`.

- Upstream's new `WebviewHost`, `RenderWebview`, and translucent pointer listener
  replace the unpublished 2024 texture/input implementation used by v1.3.34.
- Surface sizes below 2x2 are not reported while a window is minimized. The app
  runner also avoids resizing its Flutter child to zero in `SIZE_MINIMIZED`.
- `setBackgroundColor` uses `Color.value` so the vendored package remains
  compatible with the Flutter 3.24 toolchain installed on the development PC.
- The package explicitly imports and declares `meta` for its `@internal`
  annotations; upstream currently relies on an analyzer-only transitive import.

Re-run the packaged Windows mouse, wheel, focus, and minimize/restore tests when
updating this snapshot. Browser `.click()` tests do not exercise this code.
