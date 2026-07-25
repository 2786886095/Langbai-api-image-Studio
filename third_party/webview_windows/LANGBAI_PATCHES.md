# Langbai patches

This package is vendored from `theblitzapp/flutter-webview-windows` commit
`571ac6168960ce434f6f8ed5172f06378028ef48`.

- The WebView pointer `Listener` uses `HitTestBehavior.translucent`. Without an
  explicit hit-test behavior, recent Flutter Windows builds can render the
  texture while dropping all mouse input, leaving every HTML control inert.
- Mouse button and wheel messages carry their current local coordinates in the
  same platform-channel call. The pinned native implementation otherwise uses
  a stale `last_cursor_pos_`, so clicking one control can activate another.
- Surface sizes below 2x2 are not reported while a window is minimized. This
  avoids leaving the off-screen composition controller in a degenerate state.

Keep this patch when updating the vendored package until the equivalent
upstream widget implementation is adopted.
