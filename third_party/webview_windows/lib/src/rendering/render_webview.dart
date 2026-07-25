import 'package:flutter/foundation.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

class RenderWebview extends LeafRenderObjectWidget {
  const RenderWebview({
    Key? key,
    required this.textureId,
    required this.filterQuality,
    required this.cursorListenable,
    required this.opaqueListenable,
    required this.onSizeChanged,
  }) : super(key: key);

  // The texture ID of the webview surface.
  final int textureId;

  /// {@macro flutter.widgets.Texture.filterQuality}
  final FilterQuality filterQuality;

  /// The current cursor style for the webview. This is typically taken directly
  /// from the [WebviewController].
  final ValueListenable<SystemMouseCursor> cursorListenable;

  /// When non-null, enables transparency-aware hit testing. The listenable
  /// reflects whether the pointer is currently over an opaque pixel.
  final ValueListenable<bool> opaqueListenable;

  /// A callback that is called when the size of the webview surface changes.
  /// This is typically used to update the size of the webview surface in the
  /// [WebviewController].
  final void Function(Size)? onSizeChanged;

  @override
  RenderObject createRenderObject(BuildContext context) {
    return WebviewBox(
      textureId: textureId,
      filterQuality: filterQuality,
      cursorListenable: cursorListenable,
      opaqueListenable: opaqueListenable,
      onSizeChanged: onSizeChanged,
    );
  }

  @override
  void updateRenderObject(BuildContext context, WebviewBox renderObject) {
    renderObject
      ..textureId = textureId
      ..filterQuality = filterQuality
      ..cursorListenable = cursorListenable
      ..opaqueListenable = opaqueListenable
      ..onSizeChanged = onSizeChanged;
  }
}

class WebviewBox extends RenderBox implements MouseTrackerAnnotation {
  WebviewBox({
    required int textureId,
    FilterQuality filterQuality = FilterQuality.low,
    required ValueListenable<SystemMouseCursor> cursorListenable,
    required ValueListenable<bool> opaqueListenable,
    required this.onSizeChanged,
  })  : _textureId = textureId,
        _filterQuality = filterQuality,
        _cursorListenable = cursorListenable,
        _opaqueListenable = opaqueListenable;

  bool _validForMouseTracker = false;

  int get textureId => _textureId;
  int _textureId;
  set textureId(int value) {
    if (value != _textureId) {
      _textureId = value;
      markNeedsPaint();
    }
  }

  FilterQuality get filterQuality => _filterQuality;
  FilterQuality _filterQuality;
  set filterQuality(FilterQuality value) {
    if (value != _filterQuality) {
      _filterQuality = value;
      markNeedsPaint();
    }
  }

  ValueListenable<SystemMouseCursor> _cursorListenable;

  ValueListenable<SystemMouseCursor> get cursorListenable => _cursorListenable;
  set cursorListenable(ValueListenable<SystemMouseCursor> value) {
    if (value != _cursorListenable) {
      if (attached) {
        _cursorListenable.removeListener(_onCursorChanged);
      }

      _cursorListenable = value;

      if (attached) {
        _cursorListenable.addListener(_onCursorChanged);
      }
    }
  }

  ValueListenable<bool> _opaqueListenable;

  ValueListenable<bool> get opaqueListenable => _opaqueListenable;
  set opaqueListenable(ValueListenable<bool> value) {
    if (value != _opaqueListenable) {
      if (attached) {
        _opaqueListenable.removeListener(_onOpaqueChanged);
      }

      _opaqueListenable = value;

      if (attached) {
        _opaqueListenable.addListener(_onOpaqueChanged);
      }
    }
  }

  void _onOpaqueChanged() {
    markNeedsPaint();
  }

  void Function(Size)? onSizeChanged;
  Size? _lastNotifiedSize;

  @override
  SystemMouseCursor get cursor => cursorListenable.value;

  @override
  bool get sizedByParent => true;

  @override
  bool get alwaysNeedsCompositing => true;

  @override
  bool get isRepaintBoundary => true;

  void _onCursorChanged() {
    // A repaint is needed in order to trigger a device update of
    // [MouseTracker] so that this new value can be found.
    markNeedsPaint();
  }

  @override
  @protected
  Size computeDryLayout(covariant BoxConstraints constraints) {
    return constraints.biggest;
  }

  @override
  void performLayout() {
    if (_lastNotifiedSize != size) {
      _lastNotifiedSize = size;
      onSizeChanged?.call(size);
    }
  }

  @override
  bool hitTestSelf(Offset position) => _opaqueListenable.value;

  final LayerHandle<ClipRectLayer> _clipRectLayer =
      LayerHandle<ClipRectLayer>();

  @override
  void paint(PaintingContext context, Offset offset) {
    context.addLayer(
      TextureLayer(
        rect: Rect.fromLTWH(offset.dx, offset.dy, size.width, size.height),
        textureId: _textureId,
        filterQuality: _filterQuality,
      ),
    );
  }

  @override
  PointerEnterEventListener? get onEnter => null;

  @override
  PointerExitEventListener? get onExit => null;

  @override
  bool get validForMouseTracker => _validForMouseTracker;

  @override
  void attach(PipelineOwner owner) {
    super.attach(owner);

    _validForMouseTracker = true;

    cursorListenable.addListener(_onCursorChanged);
    _opaqueListenable.addListener(_onOpaqueChanged);
  }

  @override
  void detach() {
    cursorListenable.removeListener(_onCursorChanged);
    _opaqueListenable.removeListener(_onOpaqueChanged);

    _validForMouseTracker = false;

    super.detach();
  }

  @override
  void dispose() {
    _clipRectLayer.layer = null;

    super.dispose();
  }
}
