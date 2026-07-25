import 'dart:ui';

import 'package:flutter/gestures.dart';
import 'package:flutter/widgets.dart';
import 'package:webview_windows/src/controller.dart';
import 'package:webview_windows/src/models/pointer.dart';
import 'package:webview_windows/src/models/permissions.dart';
import 'package:webview_windows/src/rendering/render_webview.dart';

class Webview extends StatefulWidget {
  const Webview({
    Key? key,
    required this.controller,
    this.width,
    this.height,
    this.permissionRequested,
    this.scaleFactor,
    this.filterQuality = FilterQuality.none,
  }) : super(key: key);

  final WebviewController controller;
  final PermissionRequestedDelegate? permissionRequested;
  final double? width;
  final double? height;

  /// An optional scale factor. Defaults to [FlutterView.devicePixelRatio] for
  /// rendering in native resolution.
  /// Setting this to 1.0 will disable high-DPI support.
  /// This should only be needed to mimic old behavior before high-DPI support
  /// was available.
  final double? scaleFactor;

  /// The [FilterQuality] used for scaling the texture's contents.
  /// Defaults to [FilterQuality.none] as this renders in native resolution
  /// unless specifying a [scaleFactor].
  final FilterQuality filterQuality;

  @override
  _WebviewState createState() => _WebviewState();
}

class _WebviewState extends State<Webview> {
  double _scaleFactor = 1.0;
  Size? _surfaceSize;

  final _downButtons = <int, PointerButton>{};

  PointerDeviceKind _pointerKind = PointerDeviceKind.unknown;

  WebviewController get _controller => widget.controller;

  void _onPointerHover(PointerHoverEvent ev) {
    // ev.kind is for whatever reason not set to touch
    // even on touch input
    if (_pointerKind == PointerDeviceKind.touch) {
      // Ignoring hover events on touch for now
      return;
    }

    widget.controller.setCursorPos(ev.localPosition);
  }

  void _onPointerDown(PointerDownEvent ev) {
    _pointerKind = ev.kind;

    if (ev.kind == PointerDeviceKind.touch) {
      widget.controller.setPointerUpdate(
        WebviewPointerEventKind.down,
        ev.pointer,
        ev.localPosition,
        ev.size,
        ev.pressure,
      );

      return;
    }

    final button = _downButtons[ev.pointer] = PointerButton.fromValue(
      ev.buttons,
    );

    widget.controller.setPointerButtonState(button, true, ev.localPosition);
  }

  void onPointerUp(PointerUpEvent ev) {
    _pointerKind = ev.kind;

    if (ev.kind == PointerDeviceKind.touch) {
      widget.controller.setPointerUpdate(
        WebviewPointerEventKind.up,
        ev.pointer,
        ev.localPosition,
        ev.size,
        ev.pressure,
      );

      return;
    }

    final button = _downButtons.remove(ev.pointer);

    if (button != null) {
      widget.controller.setPointerButtonState(button, false, ev.localPosition);
    }
  }

  void onPointerCancel(PointerCancelEvent ev) {
    _pointerKind = ev.kind;

    final button = _downButtons.remove(ev.pointer);

    if (button != null) {
      widget.controller.setPointerButtonState(button, false, ev.localPosition);
    }
  }

  void _onPointerMove(PointerMoveEvent ev) {
    _pointerKind = ev.kind;

    if (ev.kind == PointerDeviceKind.touch) {
      widget.controller.setPointerUpdate(
        WebviewPointerEventKind.update,
        ev.pointer,
        ev.localPosition,
        ev.size,
        ev.pressure,
      );
    } else {
      widget.controller.setCursorPos(ev.localPosition);
    }
  }

  void onPointerSignal(PointerSignalEvent signal) {
    if (signal is PointerScrollEvent) {
      widget.controller.setScrollDelta(
        -signal.scrollDelta.dx,
        -signal.scrollDelta.dy,
        signal.localPosition,
      );
    }
  }

  void onPointerPanZoomUpdate(PointerPanZoomUpdateEvent signal) {
    if (signal.panDelta.dx.abs() > signal.panDelta.dy.abs()) {
      widget.controller.setScrollDelta(
        -signal.panDelta.dx,
        0,
        signal.localPosition,
      );
    } else {
      widget.controller.setScrollDelta(
        0,
        signal.panDelta.dy,
        signal.localPosition,
      );
    }
  }

  @override
  void initState() {
    super.initState();

    // TODO: Refactor callback and event handling and
    // remove this line
    _controller.setPermissionRequestedDelegate(widget.permissionRequested);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();

    final nextScaleFactor =
        widget.scaleFactor ?? View.of(context).devicePixelRatio;
    final scaleChanged = _scaleFactor != nextScaleFactor;
    _scaleFactor = nextScaleFactor;
    if (scaleChanged && _surfaceSize != null) {
      widget.controller.setSize(_surfaceSize!, _scaleFactor);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: widget.width ?? double.infinity,
      height: widget.height ?? double.infinity,
      child: Listener(
        behavior: HitTestBehavior.translucent,
        onPointerHover: _onPointerHover,
        onPointerDown: _onPointerDown,
        onPointerUp: onPointerUp,
        onPointerCancel: onPointerCancel,
        onPointerMove: _onPointerMove,
        onPointerSignal: onPointerSignal,
        onPointerPanZoomUpdate: onPointerPanZoomUpdate,
        child: RenderWebview(
          textureId: widget.controller.textureId,
          filterQuality: widget.filterQuality,
          cursorListenable: widget.controller.cursor,
          opaqueListenable: widget.controller.isPointerOverOpaqueContent,
          onSizeChanged: _updateSurfaceSize,
        ),
      ),
    );
  }

  void _updateSurfaceSize(Size size) {
    if (size.width < 2 || size.height < 2) return;
    _surfaceSize = size;
    widget.controller.setSize(
      size,
      widget.scaleFactor ?? _scaleFactor,
    );
  }
}
