import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:meta/meta.dart' show internal;
import 'package:webview_windows/src/models/cross_origin_request.dart';
import 'package:webview_windows/src/models/pointer.dart';
import 'package:webview_windows/src/models/download_event.dart';
import 'package:webview_windows/src/models/error_status.dart';
import 'package:webview_windows/src/models/history_changed.dart';
import 'package:webview_windows/src/models/loading_state.dart';
import 'package:webview_windows/src/models/memory_usage_target_level.dart';
import 'package:webview_windows/src/models/navigation.dart';
import 'package:webview_windows/src/models/process_failed.dart';
import 'package:webview_windows/src/models/permissions.dart';
import 'package:webview_windows/src/models/popup_policy.dart';
import 'package:webview_windows/src/models/script_id.dart';
import 'package:webview_windows/src/models/tracking_prevention.dart';

import 'cursor.dart';
import 'webview_host.dart';

/// Controls a WebView and provides streams for various change events.
class WebviewController {
  static const String _pluginChannelPrefix = 'io.jns.webview.win';
  static const MethodChannel _pluginChannel =
      MethodChannel(_pluginChannelPrefix);

  /// Get the browser version info including channel name if it is not the
  /// WebView2 Runtime.
  /// Returns [null] if the webview2 runtime is not installed.
  static Future<String?> getWebViewVersion() async {
    return _pluginChannel.invokeMethod<String>('getWebViewVersion');
  }

  /// Creates and initializes a new [WebviewController] inside [host].
  static Future<WebviewController> create(WebviewHost host) async {
    final reply = await _pluginChannel.invokeMapMethod<String, Object?>(
      'initialize',
      <String, Object?>{'hostId': host.hostId},
    );

    if (reply == null) {
      throw PlatformException(
        code: 'initialize_failed',
        message: 'Unexpected response from the plugin',
      );
    }

    final textureId = reply['textureId'] as int;
    final controller = WebviewController._(textureId: textureId);
    controller._setupEventHandlers();
    return controller;
  }

  WebviewController._({
    required int textureId,
  })  : _textureId = textureId,
        _methodChannel = MethodChannel('$_pluginChannelPrefix/$textureId'),
        _eventChannel = EventChannel('$_pluginChannelPrefix/$textureId/events');

  bool _isDisposed = false;

  PermissionRequestedDelegate? _permissionRequested;
  NavigationStartingDelegate? _navigationStarting;
  NewWindowRequestedDelegate? _newWindowRequested;

  final MethodChannel _methodChannel;
  final EventChannel _eventChannel;
  StreamSubscription? _eventStreamSubscription;

  final int _textureId;

  /// The texture ID that was assigned to the webview surface by Flutter.
  int get textureId => _textureId;

  final ValueNotifier<String?> _urlNotifier = ValueNotifier<String?>(null);

  /// A stream reflecting the current URL.
  ValueListenable<String?> get url => _urlNotifier;

  final ValueNotifier<LoadingState> _loadingStateNotifier =
      ValueNotifier<LoadingState>(LoadingState.none);

  /// Reflects the current loading state.
  ValueListenable<LoadingState> get loadingState => _loadingStateNotifier;

  final StreamController<WebviewDownloadEvent> _downloadEventStreamController =
      StreamController<WebviewDownloadEvent>.broadcast();

  Stream<WebviewDownloadEvent> get onDownloadEvent =>
      _downloadEventStreamController.stream;

  final StreamController<WebErrorStatus> _onLoadErrorStreamController =
      StreamController<WebErrorStatus>.broadcast();

  /// Reflects the navigation error when navigation completed with an error.
  Stream<WebErrorStatus> get onLoadError => _onLoadErrorStreamController.stream;

  final ValueNotifier<HistoryChanged> _historyStateNotifier =
      ValueNotifier<HistoryChanged>(
          HistoryChanged(canGoBack: false, canGoForward: false));

  /// Reflects the current history state.
  ValueListenable<HistoryChanged> get historyState => _historyStateNotifier;

  final ValueNotifier<String?> _securityStateNotifier =
      ValueNotifier<String?>(null);

  /// Reflects the current security state.
  ValueListenable<String?> get securityState => _securityStateNotifier;

  final ValueNotifier<String?> _titleNotifier = ValueNotifier<String?>(null);

  /// Reflects the current document title.
  ValueListenable<String?> get title => _titleNotifier;

  final ValueNotifier<SystemMouseCursor> _cursorNotifier =
      ValueNotifier<SystemMouseCursor>(SystemMouseCursors.basic);

  /// Reflects the current cursor style.
  ValueListenable<SystemMouseCursor> get cursor => _cursorNotifier;

  final StreamController<Object?> _webMessageStreamController =
      StreamController<Object?>.broadcast();

  Stream<Object?> get webMessage => _webMessageStreamController.stream;

  final ValueNotifier<bool> _containsFullScreenElementNotifier =
      ValueNotifier<bool>(false);

  /// Reflects whether the document currently contains full-screen elements.
  ValueListenable<bool> get containsFullScreenElement =>
      _containsFullScreenElementNotifier;

  final StreamController<WebviewProcessFailedEvent>
      _processFailedStreamController =
      StreamController<WebviewProcessFailedEvent>.broadcast();

  /// Fires when a WebView2 process fails (crashes, becomes unresponsive, etc).
  ///
  /// Listen for [WebviewProcessFailedKind.browserProcessExited] to detect
  /// unrecoverable failures that require recreating the webview.
  Stream<WebviewProcessFailedEvent> get onProcessFailed =>
      _processFailedStreamController.stream;

  final ValueNotifier<Size> _sizeNotifier = ValueNotifier<Size>(Size.zero);

  /// Reflects the current size of the webview surface.
  ValueListenable<Size> get size => _sizeNotifier;

  final ValueNotifier<bool> _isPointerOverOpaqueContent =
      ValueNotifier<bool>(true);

  /// Reflects whether the pointer is currently over an opaque pixel of the
  /// webview content. Only meaningful when transparency hit testing is enabled.
  ValueListenable<bool> get isPointerOverOpaqueContent =>
      _isPointerOverOpaqueContent;

  void _setupEventHandlers() {
    _eventStreamSubscription =
        _eventChannel.receiveBroadcastStream().listen((event) {
      final map = event as Map<dynamic, dynamic>;

      switch (map['type']) {
        case 'urlChanged':
          _urlNotifier.value = map['value'];
          break;

        case 'onLoadError':
          _onLoadErrorStreamController.add(
            WebErrorStatus.values[map['value']],
          );

          break;

        case 'loadingStateChanged':
          _loadingStateNotifier.value = LoadingState.values[map['value']];

          break;

        case 'downloadEvent':
          _downloadEventStreamController.add(
            WebviewDownloadEvent(
              WebviewDownloadEventKind.values[map['value']['kind']],
              map['value']['url'],
              map['value']['resultFilePath'],
              map['value']['bytesReceived'],
              map['value']['totalBytesToReceive'],
            ),
          );

          break;

        case 'historyChanged':
          _historyStateNotifier.value = HistoryChanged(
            canGoBack: map['value']['canGoBack'],
            canGoForward: map['value']['canGoForward'],
          );

          break;

        case 'securityStateChanged':
          _securityStateNotifier.value = map['value'];

          break;

        case 'titleChanged':
          _titleNotifier.value = map['value'];

          break;

        case 'cursorChanged':
          _cursorNotifier.value = getCursorByName(map['value']);

          break;

        case 'webMessageReceived':
          try {
            final message = json.decode(map['value']);

            _webMessageStreamController.add(message);
          } catch (ex) {
            _webMessageStreamController.addError(ex);
          }

          break;

        case 'containsFullScreenElementChanged':
          _containsFullScreenElementNotifier.value = map['value'];

          break;

        case 'sizeChanged':
          _sizeNotifier.value = Size(
            (map['value']['width'] as num).toDouble(),
            (map['value']['height'] as num).toDouble(),
          );

          break;

        case 'pointerTransparencyChanged':
          _isPointerOverOpaqueContent.value = map['value'] as bool;

          break;

        case 'processFailed':
          final value = map['value'] as Map<dynamic, dynamic>;
          final kindIndex = value['kind'] as int;
          final reasonIndex = value['reason'] as int;
          _processFailedStreamController.add(WebviewProcessFailedEvent(
            kind: kindIndex < WebviewProcessFailedKind.values.length
                ? WebviewProcessFailedKind.values[kindIndex]
                : WebviewProcessFailedKind.unknown,
            reason: reasonIndex < WebviewProcessFailedReason.values.length
                ? WebviewProcessFailedReason.values[reasonIndex]
                : WebviewProcessFailedReason.unexpected,
          ));

          break;
      }
    });

    _methodChannel.setMethodCallHandler((call) {
      if (call.method == 'permissionRequested') {
        return _onPermissionRequested(call.arguments as Map<dynamic, dynamic>);
      }

      if (call.method == 'navigationStarting') {
        return _onNavigationStarting(call.arguments as Map<dynamic, dynamic>);
      }

      if (call.method == 'newWindowRequested') {
        return _onNewWindowRequested(call.arguments as Map<dynamic, dynamic>);
      }

      throw MissingPluginException('Unknown method ${call.method}');
    });
  }

  @internal
  void setPermissionRequestedDelegate(
    PermissionRequestedDelegate? permissionRequested,
  ) {
    _permissionRequested = permissionRequested;
  }

  /// Sets the navigation starting delegate.
  ///
  /// The delegate is called when a navigation is initiated, letting you decide whether to allow or cancel the
  /// navigation request.
  void setNavigationStartingDelegate(
    NavigationStartingDelegate? navigationStarting,
  ) {
    _navigationStarting = navigationStarting;
  }

  /// Sets the new window requested delegate.
  ///
  /// The delegate is called when a new window (popup) is requested, letting
  /// you decide whether to allow, deny, or show it in the same window.
  void setNewWindowRequestedDelegate(
    NewWindowRequestedDelegate? newWindowRequested,
  ) {
    _newWindowRequested = newWindowRequested;
  }

  Future<bool?> _onNavigationStarting(Map<dynamic, dynamic> args) async {
    final navigationStarting = _navigationStarting;

    if (navigationStarting == null) {
      return false;
    }

    final url = args['url'] as String?;
    final isUserInitiated = args['isUserInitiated'] as bool?;
    final isRedirected = args['isRedirected'] as bool?;

    if (url != null && isUserInitiated != null && isRedirected != null) {
      final decision =
          await navigationStarting(url, isUserInitiated, isRedirected);

      return decision == NavigationDecision.cancel;
    }

    return false;
  }

  Future<int?> _onNewWindowRequested(Map<dynamic, dynamic> args) async {
    final newWindowRequested = _newWindowRequested;

    if (newWindowRequested == null) {
      return null;
    }

    final url = args['url'] as String?;
    final isUserInitiated = args['isUserInitiated'] as bool?;

    if (url != null && isUserInitiated != null) {
      final decision = await newWindowRequested(url, isUserInitiated);
      return decision.index;
    }

    return null;
  }

  Future<bool?> _onPermissionRequested(Map<dynamic, dynamic> args) async {
    final permissionRequested = _permissionRequested;

    if (permissionRequested == null) {
      return null;
    }

    final url = args['url'] as String?;
    final permissionKindIndex = args['permissionKind'] as int?;
    final isUserInitiated = args['isUserInitiated'] as bool?;

    if (url != null && permissionKindIndex != null && isUserInitiated != null) {
      final permissionKind = WebviewPermissionKind.values[permissionKindIndex];
      final decision =
          await permissionRequested(url, permissionKind, isUserInitiated);

      switch (decision) {
        case WebviewPermissionDecision.allow:
          return true;

        case WebviewPermissionDecision.deny:
          return false;

        default:
          return null;
      }
    }

    return null;
  }

  Future<void> dispose() async {
    if (!_isDisposed) {
      _isDisposed = true;
      await _eventStreamSubscription?.cancel();
      await _onLoadErrorStreamController.close();
      await _downloadEventStreamController.close();
      await _webMessageStreamController.close();
      await _processFailedStreamController.close();

      await _pluginChannel.invokeMethod('dispose', _textureId);
    }
  }

  /// Loads the given [url].
  ///
  /// If [headers] is provided, the request will include the specified
  /// HTTP headers. Headers are only applied to the initial navigation
  /// request (not to redirects or sub-resource requests).
  Future<void> loadUrl(String url, {Map<String, String>? headers}) async {
    if (_isDisposed) {
      return;
    }

    return _methodChannel.invokeMethod('loadUrl', {
      'url': url,
      if (headers != null) 'headers': headers,
    });
  }

  /// Loads a document from the given string.
  Future<void> loadStringContent(String content) async {
    if (_isDisposed) {
      return;
    }

    return _methodChannel.invokeMethod('loadStringContent', content);
  }

  /// Reloads the current document.
  Future<void> reload() async {
    if (_isDisposed) {
      return;
    }

    return _methodChannel.invokeMethod('reload');
  }

  /// Stops all navigations and pending resource fetches.
  Future<void> stop() async {
    if (_isDisposed) {
      return;
    }

    return _methodChannel.invokeMethod('stop');
  }

  /// Navigates the WebView to the previous page in the navigation history.
  Future<void> goBack() async {
    if (_isDisposed) {
      return;
    }

    return _methodChannel.invokeMethod('goBack');
  }

  /// Navigates the WebView to the next page in the navigation history.
  Future<void> goForward() async {
    if (_isDisposed) {
      return;
    }

    return _methodChannel.invokeMethod('goForward');
  }

  /// Adds the provided JavaScript [script] to a list of scripts that should be run after the global
  /// object has been created, but before the HTML document has been parsed and before any
  /// other script included by the HTML document is run.
  ///
  /// Returns a [ScriptID] on success which can be used for [removeScriptToExecuteOnDocumentCreated].
  ///
  /// see https://docs.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2?view=webview2-1.0.1264.42#addscripttoexecuteondocumentcreated
  Future<ScriptID?> addScriptToExecuteOnDocumentCreated(String script) async {
    if (_isDisposed) {
      return null;
    }

    return _methodChannel.invokeMethod<String?>(
        'addScriptToExecuteOnDocumentCreated', script);
  }

  /// Removes the script identified by [scriptId] from the list of registered scripts.
  ///
  /// see https://docs.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2?view=webview2-1.0.1264.42#removescripttoexecuteondocumentcreated
  Future<void> removeScriptToExecuteOnDocumentCreated(ScriptID scriptId) async {
    if (_isDisposed) {
      return null;
    }

    return _methodChannel.invokeMethod(
        'removeScriptToExecuteOnDocumentCreated', scriptId);
  }

  /// Runs the JavaScript [script] in the current top-level document rendered in
  /// the WebView and returns its result.
  ///
  /// see https://docs.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2?view=webview2-1.0.1264.42#executescript
  Future<dynamic> executeScript(String script) async {
    if (_isDisposed) {
      return;
    }

    final data = await _methodChannel.invokeMethod('executeScript', script);

    if (data == null) {
      return null;
    }

    return jsonDecode(data as String);
  }

  /// Posts the given JSON-formatted message to the current document.
  Future<void> postWebMessage(String message) async {
    if (_isDisposed) {
      return;
    }

    return _methodChannel.invokeMethod('postWebMessage', message);
  }

  /// Sets the user agent value.
  Future<void> setUserAgent(String userAgent) async {
    if (_isDisposed) {
      return;
    }

    return _methodChannel.invokeMethod('setUserAgent', userAgent);
  }

  /// Clears browser cookies.
  Future<void> clearCookies() async {
    if (_isDisposed) {
      return;
    }

    return _methodChannel.invokeMethod('clearCookies');
  }

  /// Clears browser cache.
  Future<void> clearCache() async {
    if (_isDisposed) {
      return;
    }

    return _methodChannel.invokeMethod('clearCache');
  }

  /// Toggles ignoring cache for each request. If true, cache will not be used.
  Future<void> setCacheDisabled(bool disabled) async {
    if (_isDisposed) {
      return;
    }

    return _methodChannel.invokeMethod('setCacheDisabled', disabled);
  }

  /// Opens the Browser DevTools in a separate window
  Future<void> openDevTools() async {
    if (_isDisposed) {
      return;
    }

    return _methodChannel.invokeMethod('openDevTools');
  }

  /// Controls whether the user can open DevTools.
  ///
  /// When disabled, the [openDevTools] method and the F12 shortcut will not work.
  Future<void> setDevToolsEnabled(bool enabled) async {
    if (_isDisposed) {
      return;
    }

    return _methodChannel.invokeMethod('setDevToolsEnabled', enabled);
  }

  /// Controls whether JavaScript execution is enabled.
  Future<void> setScriptEnabled(bool enabled) async {
    if (_isDisposed) return;
    return _methodChannel.invokeMethod('setScriptEnabled', enabled);
  }

  /// Controls whether native JavaScript dialogs (alert, confirm, prompt) are shown.
  Future<void> setScriptDialogsEnabled(bool enabled) async {
    if (_isDisposed) return;
    return _methodChannel.invokeMethod('setScriptDialogsEnabled', enabled);
  }

  /// Controls whether the built-in error page is shown on navigation failures.
  Future<void> setBuiltInErrorPageEnabled(bool enabled) async {
    if (_isDisposed) return;
    return _methodChannel.invokeMethod('setBuiltInErrorPageEnabled', enabled);
  }

  /// Controls whether the browser's zoom controls (pinch-to-zoom on touch,
  /// ctrl+scroll on desktop) are enabled.
  Future<void> setZoomControlEnabled(bool enabled) async {
    if (_isDisposed) return;
    return _methodChannel.invokeMethod('setZoomControlEnabled', enabled);
  }

  /// Controls whether browser-specific accelerator keys (e.g. F5, Ctrl+P) are
  /// handled by the WebView.
  Future<void> setBrowserAcceleratorKeysEnabled(bool enabled) async {
    if (_isDisposed) return;
    return _methodChannel.invokeMethod(
        'setBrowserAcceleratorKeysEnabled', enabled);
  }

  /// Controls whether the browser's general autofill feature is enabled.
  Future<void> setGeneralAutofillEnabled(bool enabled) async {
    if (_isDisposed) return;
    return _methodChannel.invokeMethod('setGeneralAutofillEnabled', enabled);
  }

  /// Controls whether the browser's password autosave feature is enabled.
  Future<void> setPasswordAutosaveEnabled(bool enabled) async {
    if (_isDisposed) return;
    return _methodChannel.invokeMethod('setPasswordAutosaveEnabled', enabled);
  }

  /// Controls whether pinch-to-zoom is enabled on touch screens.
  Future<void> setPinchZoomEnabled(bool enabled) async {
    if (_isDisposed) return;
    return _methodChannel.invokeMethod('setPinchZoomEnabled', enabled);
  }

  /// Controls whether swiping left/right to navigate back/forward is enabled.
  Future<void> setSwipeNavigationEnabled(bool enabled) async {
    if (_isDisposed) return;
    return _methodChannel.invokeMethod('setSwipeNavigationEnabled', enabled);
  }

  /// Controls whether SmartScreen reputation checking is enabled.
  Future<void> setReputationCheckingEnabled(bool enabled) async {
    if (_isDisposed) return;
    return _methodChannel.invokeMethod('setReputationCheckingEnabled', enabled);
  }

  /// Calls a DevTools Protocol (CDP) method and returns the JSON result string.
  ///
  /// [method] is the CDP method name (e.g. `'HeapProfiler.collectGarbage'`).
  /// [parameters] is a JSON string of method parameters (defaults to `'{}'`).
  ///
  /// Returns the raw CDP JSON response string, or `null` if this controller
  /// has been disposed.
  ///
  /// Example — force JavaScript garbage collection:
  /// ```dart
  /// await controller.callDevToolsProtocolMethod('HeapProfiler.collectGarbage');
  /// ```
  Future<String?> callDevToolsProtocolMethod(
    String method, [
    String parameters = '{}',
  ]) async {
    if (_isDisposed) return null;
    return _methodChannel.invokeMethod<String>(
      'callDevToolsProtocolMethod',
      [method, parameters],
    );
  }

  /// Sets the tracking prevention level.
  ///
  /// See [WebviewTrackingPreventionLevel] for available levels.
  Future<void> setTrackingPreventionLevel(
    WebviewTrackingPreventionLevel level,
  ) async {
    if (_isDisposed) {
      return;
    }

    return _methodChannel.invokeMethod(
        'setTrackingPreventionLevel', level.index);
  }

  /// Sets the background color to the provided [color].
  ///
  /// Due to a limitation of the underlying WebView implementation,
  /// semi-transparent values are not supported.
  /// Any non-zero alpha value will be considered as opaque (0xff).
  Future<void> setBackgroundColor(Color color) async {
    if (_isDisposed) {
      return;
    }

    return _methodChannel.invokeMethod(
        'setBackgroundColor', color.value.toSigned(32));
  }

  /// Sets the zoom factor.
  Future<void> setZoomFactor(double zoomFactor) async {
    if (_isDisposed) {
      return;
    }

    return _methodChannel.invokeMethod('setZoomFactor', zoomFactor);
  }

  /// Suspends the web view.
  Future<void> suspend() async {
    if (_isDisposed) {
      return;
    }

    return _methodChannel.invokeMethod('suspend');
  }

  /// Resumes the web view.
  Future<void> resume() async {
    if (_isDisposed) {
      return;
    }

    return _methodChannel.invokeMethod('resume');
  }

  /// Sets the desired memory consumption level of the WebView.
  Future<void> setMemoryUsageTargetLevel(
      WebviewMemoryUsageTargetLevel level) async {
    if (_isDisposed) {
      return;
    }

    return _methodChannel.invokeMethod(
        'setMemoryUsageTargetLevel', level.index);
  }

  /// Adds a Virtual Host Name Mapping.
  ///
  /// Please refer to
  /// [Microsofts](https://docs.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2_3#setvirtualhostnametofoldermapping)
  /// documentation for more details.
  Future<void> addVirtualHostNameMapping(
    String hostName,
    String folderPath,
    WebviewHostResourceAccessKind accessKind,
  ) async {
    if (_isDisposed) {
      return;
    }

    return _methodChannel.invokeMethod(
        'setVirtualHostNameMapping', [hostName, folderPath, accessKind.index]);
  }

  /// Removes a Virtual Host Name Mapping.
  ///
  /// Please refer to
  /// [Microsofts](https://docs.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2_3#clearvirtualhostnametofoldermapping)
  /// documentation for more details.
  Future<void> removeVirtualHostNameMapping(String hostName) async {
    if (_isDisposed) {
      return;
    }

    return _methodChannel.invokeMethod('clearVirtualHostNameMapping', hostName);
  }

  /// Enables or disables transparency-aware hit testing. When enabled, the
  /// native side checks the alpha value at the cursor position on every hover
  /// and emits a [isPointerOverOpaqueContent] change when the opacity state
  /// flips. This allows pointer events to pass through transparent areas of
  /// the webview to widgets behind it.
  Future<void> setTransparencyHitTestingEnabled(bool enabled) async {
    if (_isDisposed) {
      return;
    }

    await _methodChannel.invokeMethod(
        'setTransparencyHitTestingEnabled', enabled);

    if (!enabled) {
      _isPointerOverOpaqueContent.value = true;
    }
  }

  /// Sets extra HTTP headers that will be included in every request made by
  /// this webview instance (navigations, sub-resources, XHR, etc.).
  ///
  /// These are global headers applied to all requests. Domain-specific headers
  /// set via [setDomainExtraHeaders] take precedence for matching domains.
  Future<void> setExtraHeaders(Map<String, String> headers) async {
    if (_isDisposed) {
      return;
    }

    return _methodChannel.invokeMethod('setExtraHeaders', headers);
  }

  /// Sets extra HTTP headers for requests to a specific [domain].
  ///
  /// These headers are merged with the global headers set via
  /// [setExtraHeaders], with domain-specific headers taking precedence when
  /// both define the same header name.
  ///
  /// Pass an empty map for [headers] to remove the domain-specific headers.
  Future<void> setDomainExtraHeaders(
    String domain,
    Map<String, String> headers,
  ) async {
    if (_isDisposed) {
      return;
    }

    return _methodChannel
        .invokeMethod('setDomainExtraHeaders', [domain, headers]);
  }

  /// Limits the number of frames per second to the given value.
  Future<void> setFpsLimit([int? maxFps = 0]) async {
    if (_isDisposed) {
      return;
    }

    return _methodChannel.invokeMethod('setFpsLimit', maxFps);
  }

  /// Sends a Pointer (Touch) update
  @internal
  Future<void> setPointerUpdate(
    WebviewPointerEventKind kind,
    int pointer,
    Offset position,
    double size,
    double pressure,
  ) async {
    if (_isDisposed) {
      return;
    }

    return _methodChannel.invokeMethod('setPointerUpdate',
        [pointer, kind.index, position.dx, position.dy, size, pressure]);
  }

  /// Moves the virtual cursor to [position].
  @internal
  Future<void> setCursorPos(Offset position) async {
    if (_isDisposed) {
      return;
    }

    return _methodChannel
        .invokeMethod('setCursorPos', [position.dx, position.dy]);
  }

  /// Indicates whether the specified [button] is currently down.
  @internal
  Future<void> setPointerButtonState(
    PointerButton button,
    bool isDown,
    Offset position,
  ) async {
    if (_isDisposed) {
      return;
    }

    return _methodChannel.invokeMethod('setPointerButton', <String, dynamic>{
      'button': button.index,
      'isDown': isDown,
      'x': position.dx,
      'y': position.dy,
    });
  }

  /// Sets the horizontal and vertical scroll delta.
  @internal
  Future<void> setScrollDelta(double dx, double dy, Offset position) async {
    if (_isDisposed) {
      return;
    }

    return _methodChannel.invokeMethod(
      'setScrollDelta',
      [dx, dy, position.dx, position.dy],
    );
  }

  /// Sets the surface size to the provided [size].
  @internal
  Future<void> setSize(Size size, double scaleFactor) async {
    if (_isDisposed) {
      return;
    }

    return _methodChannel
        .invokeMethod('setSize', [size.width, size.height, scaleFactor]);
  }
}
