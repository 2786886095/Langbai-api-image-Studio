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
- Mouse button messages carry their own local coordinates and update WebView2
  focus before the button event. This prevents delayed hover messages from
  sending clicks to a stale result-image position under heavy IndexedDB load.
- Wheel messages likewise carry their own coordinates, and a monitor-DPI change
  resubmits the last surface size with the new scale factor. Settings and custom
  lists no longer depend on a delayed hover position to receive scrolling.
- On mouse-button and wheel delivery, the native layer resolves the current OS
  cursor with `GetCursorPos`/`ScreenToClient`; Flutter local coordinates remain
  only as a fallback. This avoids texture-transform offsets in packaged builds.

Re-run the packaged Windows mouse, wheel, focus, and minimize/restore tests when
updating this snapshot. Browser `.click()` tests do not exercise this code.
