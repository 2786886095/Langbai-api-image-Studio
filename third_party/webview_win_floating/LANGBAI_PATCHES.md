# Langbai vendor notes

Vendored from `jakky1/webview_win_floating` commit
`bbae6b84cc1f3119327701e187eee53283cae567` (package version `3.0.3`).

Local changes:

- expose document-created scripts so the existing trusted native bridge is
  installed before application JavaScript runs;
- surface WebView2 `ProcessFailed` events to Dart;
- validate native method results and avoid null-controller destruction;
- use UTF-8-safe path and URL conversion.
- retain pending WebViews during asynchronous environment/controller creation,
  complete creation errors once, validate COM interfaces, and remove registered
  events before closing the controller;
- use programmatic focus and notify WebView2 when parent-window bounds move;
- remove the unused `fullscreen_window` dependency from the desktop shell.
- build against WebView2 SDK `1.0.2210.55`, matching the previous vendored
  Windows host and covering the controller/process APIs used here.

This package uses a windowed WebView2 controller. Windows input is handled by
the operating system instead of being forwarded through Flutter textures.
