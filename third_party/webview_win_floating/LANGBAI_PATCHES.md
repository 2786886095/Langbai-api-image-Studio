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
- for full-window Windows shells, create a dedicated native child HWND under
  the real top-level window after Flutter has attached its render surface;
- keep that host above Flutter, size it from Win32 `WM_SIZE`/DPI/move events,
  and route activation focus to WebView2 instead of Flutter's backing HWND;
- expose a top-level-host creation option so other package users retain the
  original embedded-widget behavior by default.
- expose a trusted text-input bridge backed by WebView2 CDP
  `Input.insertText`; this is retained as a compatibility fallback when a
  provider page cannot use Langbai's direct request adapter.

This package uses a windowed WebView2 controller. In Langbai's full-window
mode, WebView2 is the only visible native content host and Windows input is
handled directly by the operating system instead of crossing Flutter hit
testing or texture forwarding.
