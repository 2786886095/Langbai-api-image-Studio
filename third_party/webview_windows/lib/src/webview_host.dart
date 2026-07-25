import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// A WebView2 environment that one or more [WebviewController]s can be created inside.
///
/// ```dart
/// final host = await WebviewHost.create();
/// final controller = WebviewController(host);
/// await controller.initialize();
/// // ...
/// await controller.dispose();
/// await host.dispose();
/// ```
class WebviewHost {
  static const MethodChannel _pluginChannel =
      MethodChannel('io.jns.webview.win');

  static bool _staleStateCleared = false;

  /// Creates and initializes a new [WebviewHost].
  ///
  /// - [userDataPath]: Directory where cookies, cache, and other browser data
  ///   are stored. When omitted, a unique temporary directory is generated
  ///   automatically, giving this host a fully isolated browser process.
  /// - [browserExePath]: Path to a fixed-version WebView2 runtime executable.
  ///   When omitted, the system-installed WebView2 runtime is used.
  /// - [additionalArguments]: Extra Chromium command-line arguments.
  /// - [areBrowserExtensionsEnabled]: Whether browser extensions are enabled.
  ///   Requires WebView2 EnvironmentOptions v8.
  /// - [enableTrackingPrevention]: Whether tracking prevention is enabled.
  ///   Requires WebView2 EnvironmentOptions v4.
  static Future<WebviewHost> create({
    String? userDataPath,
    String? browserExePath,
    String? additionalArguments,
    bool? areBrowserExtensionsEnabled,
    bool? enableTrackingPrevention,
  }) async {
    // In debug mode, clear any hosts and webviews left over from a previous
    // hot restart before creating a new host.
    if (kDebugMode && !_staleStateCleared) {
      _staleStateCleared = true;
      await _pluginChannel.invokeMethod('disposeAll');
    }

    final reply = await _pluginChannel.invokeMapMethod<String, Object?>(
      'createHost',
      <String, Object?>{
        'userDataPath': userDataPath,
        'browserExePath': browserExePath,
        'additionalArguments': additionalArguments,
        'areBrowserExtensionsEnabled': areBrowserExtensionsEnabled,
        'enableTrackingPrevention': enableTrackingPrevention,
      },
    );

    if (reply == null) {
      throw PlatformException(
        code: 'environment_creation_failed',
        message: 'Unexpected response from the plugin',
      );
    }

    final hostId = reply['hostId'] as int;
    return WebviewHost._(hostId);
  }

  WebviewHost._(this.hostId);

  /// The native host ID assigned by the plugin.
  final int hostId;

  bool _isDisposed = false;

  /// Disposes the host and all webviews created inside it.
  ///
  /// The underlying browser process is terminated and all memory is freed.
  /// Any [WebviewController] that was using this host becomes invalid after
  /// this call.
  Future<void> dispose() async {
    if (_isDisposed) {
      throw StateError('WebviewHost already disposed.');
    }

    _isDisposed = true;

    await _pluginChannel.invokeMethod('disposeHost', hostId);
  }

  /// Returns the OS process IDs for all processes associated with this host's
  /// WebView2 environment.
  Future<List<int>> getProcessIds() async {
    if (_isDisposed) {
      throw StateError('WebviewHost has been disposed.');
    }

    final result = await _pluginChannel.invokeListMethod<int>(
      'getProcessIds',
      <String, Object?>{'hostId': hostId},
    );

    return result ?? const [];
  }
}
