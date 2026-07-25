import 'dart:ui';

import 'package:flutter/gestures.dart';
import 'package:flutter/widgets.dart';
import 'package:webview_windows/src/controller.dart';
import 'package:webview_windows/src/models/pointer.dart';
import 'package:webview_windows/src/rendering/render_webview_subregion.dart';

class WebviewSubregion extends StatefulWidget {
  const WebviewSubregion({
    Key? key,
    required this.controller,
    required this.subregion,
    this.filterQuality = FilterQuality.none,
    this.borderRadius,
  }) : super(key: key);

  final WebviewController controller;

  /// The rect of the webview surface to render.
  final Rect subregion;

  /// The [FilterQuality] used for scaling the texture's contents.
  /// Defaults to [FilterQuality.none] as this renders in native resolution
  /// unless specifying a [scaleFactor].
  final FilterQuality filterQuality;

  /// If non-null, the corners of this box are rounded by this [BorderRadius].
  final BorderRadius? borderRadius;

  @override
  _WebviewSubregionState createState() => _WebviewSubregionState();
}

class _WebviewSubregionState extends State<WebviewSubregion> {
  final _downButtons = <int, PointerButton>{};

  PointerDeviceKind _pointerKind = PointerDeviceKind.unknown;

  Offset _transformCursorPosition(Offset position) {
    return position.translate(widget.subregion.left, widget.subregion.top);
  }

  void _onPointerHover(PointerHoverEvent ev) {
    // ev.kind is for whatever reason not set to touch
    // even on touch input
    if (_pointerKind == PointerDeviceKind.touch) {
      // Ignoring hover events on touch for now
      return;
    }

    widget.controller.setCursorPos(_transformCursorPosition(ev.localPosition));
  }

  void _onPointerDown(PointerDownEvent ev) {
    _pointerKind = ev.kind;

    if (ev.kind == PointerDeviceKind.touch) {
      widget.controller.setPointerUpdate(
        WebviewPointerEventKind.down,
        ev.pointer,
        _transformCursorPosition(ev.localPosition),
        ev.size,
        ev.pressure,
      );

      return;
    }

    final button = _downButtons[ev.pointer] = PointerButton.fromValue(
      ev.buttons,
    );

    widget.controller.setPointerButtonState(button, true);
  }

  void onPointerUp(PointerUpEvent ev) {
    _pointerKind = ev.kind;

    if (ev.kind == PointerDeviceKind.touch) {
      widget.controller.setPointerUpdate(
        WebviewPointerEventKind.up,
        ev.pointer,
        _transformCursorPosition(ev.localPosition),
        ev.size,
        ev.pressure,
      );

      return;
    }

    final button = _downButtons.remove(ev.pointer);

    if (button != null) {
      widget.controller.setPointerButtonState(button, false);
    }
  }

  void onPointerCancel(PointerCancelEvent ev) {
    _pointerKind = ev.kind;

    final button = _downButtons.remove(ev.pointer);

    if (button != null) {
      widget.controller.setPointerButtonState(button, false);
    }
  }

  void _onPointerMove(PointerMoveEvent ev) {
    _pointerKind = ev.kind;

    if (ev.kind == PointerDeviceKind.touch) {
      widget.controller.setPointerUpdate(
        WebviewPointerEventKind.update,
        ev.pointer,
        _transformCursorPosition(ev.localPosition),
        ev.size,
        ev.pressure,
      );
    } else {
      widget.controller.setCursorPos(
        _transformCursorPosition(ev.localPosition),
      );
    }
  }

  void onPointerSignal(PointerSignalEvent signal) {
    if (signal is PointerScrollEvent) {
      widget.controller.setScrollDelta(
        -signal.scrollDelta.dx,
        -signal.scrollDelta.dy,
      );
    }
  }

  void onPointerPanZoomUpdate(PointerPanZoomUpdateEvent signal) {
    if (signal.panDelta.dx.abs() > signal.panDelta.dy.abs()) {
      widget.controller.setScrollDelta(-signal.panDelta.dx, 0);
    } else {
      widget.controller.setScrollDelta(0, signal.panDelta.dy);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: widget.subregion.width,
      height: widget.subregion.height,
      child: Listener(
        behavior: HitTestBehavior.translucent,
        onPointerHover: _onPointerHover,
        onPointerDown: _onPointerDown,
        onPointerUp: onPointerUp,
        onPointerCancel: onPointerCancel,
        onPointerMove: _onPointerMove,
        onPointerSignal: onPointerSignal,
        onPointerPanZoomUpdate: onPointerPanZoomUpdate,
        child: RenderWebviewSubregion(
          textureId: widget.controller.textureId,
          filterQuality: widget.filterQuality,
          cursorListenable: widget.controller.cursor,
          opaqueListenable: widget.controller.isPointerOverOpaqueContent,
          textureSize: widget.controller.size,
          subregion: widget.subregion,
          borderRadius: widget.borderRadius,
        ),
      ),
    );
  }
}
