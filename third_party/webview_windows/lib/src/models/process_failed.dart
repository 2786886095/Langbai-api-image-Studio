/// The kind of process failure that occurred.
enum WebviewProcessFailedKind {
  /// The browser process ended unexpectedly.
  browserProcessExited,

  /// The render process ended unexpectedly.
  renderProcessExited,

  /// The render process became unresponsive.
  renderProcessUnresponsive,

  /// A frame-only render process ended unexpectedly.
  frameRenderProcessExited,

  /// A utility process ended unexpectedly.
  utilityProcessExited,

  /// A sandbox helper process ended unexpectedly.
  sandboxHelperProcessExited,

  /// The GPU process ended unexpectedly.
  gpuProcessExited,

  /// A PPAPI plugin process ended unexpectedly.
  ppapiPluginProcessExited,

  /// A PPAPI plugin broker process ended unexpectedly.
  ppapiBrokerProcessExited,

  /// An unknown process ended unexpectedly.
  unknown,
}

/// The reason a WebView2 process failed.
enum WebviewProcessFailedReason {
  /// An unexpected failure occurred.
  unexpected,

  /// The process became unresponsive.
  unresponsive,

  /// The process was terminated (e.g. by the OS or task manager).
  terminated,

  /// The process crashed.
  crashed,

  /// The process failed to launch.
  launchFailed,

  /// The process ran out of memory.
  outOfMemory,

  /// A profile was deleted while the process was still using it.
  @Deprecated('This value is unused.')
  profileDeleted,
}

/// Information about a WebView2 process failure event.
class WebviewProcessFailedEvent {
  const WebviewProcessFailedEvent({
    required this.kind,
    required this.reason,
  });

  final WebviewProcessFailedKind kind;
  final WebviewProcessFailedReason reason;

  /// Whether this failure is unrecoverable (browser process exited).
  bool get isBrowserProcessExited =>
      kind == WebviewProcessFailedKind.browserProcessExited;
}
