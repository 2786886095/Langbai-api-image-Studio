import 'package:flutter/foundation.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

class RenderWebviewSubregion extends LeafRenderObjectWidget {
  const RenderWebviewSubregion({
    Key? key,
    required this.textureId,
    required this.filterQuality,
    required this.cursorListenable,
    required this.opaqueListenable,
    required this.textureSize,
    required this.subregion,
    this.borderRadius,
  }) : super(key: key);

  // The texture ID of the webview surface.
  final int textureId;

  /// {@macro flutter.widgets.Texture.filterQuality}
  final FilterQuality filterQuality;

  /// A stream reflecting the current cursor style for the webview. This is
  /// typically taken directly from the [WebviewController].
  final ValueListenable<SystemMouseCursor> cursorListenable;

  /// When non-null, enables transparency-aware hit testing. The listenable
  /// reflects whether the pointer is currently over an opaque pixel.
  final ValueListenable<bool> opaqueListenable;

  /// A stream reflecting the current size of the webview surface.
  final ValueListenable<Size> textureSize;

  /// The rect of the webview surface to render.
  final Rect subregion;

  /// If non-null, the corners of this box are rounded by this [BorderRadius].
  final BorderRadius? borderRadius;

  @override
  RenderObject createRenderObject(BuildContext context) {
    return WebviewSubregionBox(
      textureId: textureId,
      filterQuality: filterQuality,
      cursorListenable: cursorListenable,
      opaqueListenable: opaqueListenable,
      textureSize: textureSize,
      rect: subregion,
      borderRadius: borderRadius,
      textDirection: Directionality.maybeOf(context),
    );
  }

  @override
  void updateRenderObject(
      BuildContext context, WebviewSubregionBox renderObject) {
    renderObject
      ..textureId = textureId
      ..filterQuality = filterQuality
      ..cursorListenable = cursorListenable
      ..opaqueListenable = opaqueListenable
      ..textureSizeListenable = textureSize
      ..rect = subregion
      ..borderRadius = borderRadius
      ..textDirection = Directionality.maybeOf(context);
  }

  @override
  void debugFillProperties(DiagnosticPropertiesBuilder properties) {
    super.debugFillProperties(properties);

    properties.add(
      DiagnosticsProperty<BorderRadiusGeometry>(
        'borderRadius',
        borderRadius,
        showName: false,
        defaultValue: null,
      ),
    );
  }
}

class WebviewSubregionBox extends RenderBox implements MouseTrackerAnnotation {
  WebviewSubregionBox({
    required int textureId,
    FilterQuality filterQuality = FilterQuality.low,
    required ValueListenable<SystemMouseCursor> cursorListenable,
    required ValueListenable<bool> opaqueListenable,
    required ValueListenable<Size> textureSize,
    required Rect rect,
    BorderRadius? borderRadius,
    TextDirection? textDirection,
  })  : _textureId = textureId,
        _filterQuality = filterQuality,
        _cursorListenable = cursorListenable,
        _opaqueListenable = opaqueListenable,
        _textureSizeListenable = textureSize,
        _rect = rect,
        _borderRadius = borderRadius,
        _textDirection = textDirection;

  bool _validForMouseTracker = false;

  int get textureId => _textureId;
  int _textureId;
  set textureId(int value) {
    if (value == _textureId) {
      return;
    }

    _textureId = value;
    markNeedsPaint();
  }

  FilterQuality get filterQuality => _filterQuality;
  FilterQuality _filterQuality;
  set filterQuality(FilterQuality value) {
    if (value == _filterQuality) {
      return;
    }

    _filterQuality = value;
    markNeedsPaint();
  }

  ValueListenable<SystemMouseCursor> _cursorListenable;

  ValueListenable<SystemMouseCursor> get cursorListenable => _cursorListenable;
  set cursorListenable(ValueListenable<SystemMouseCursor> value) {
    if (value == _cursorListenable) {
      return;
    }

    if (attached) {
      _cursorListenable.removeListener(_onCursorChanged);
    }

    final oldCursor = _cursorListenable.value;

    _cursorListenable = value;

    if (oldCursor != value.value) {
      markNeedsPaint();
    }

    if (attached) {
      _cursorListenable.addListener(_onCursorChanged);
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

  ValueListenable<Size> _textureSizeListenable;

  ValueListenable<Size> get textureSizeListenable => _textureSizeListenable;
  set textureSizeListenable(ValueListenable<Size> value) {
    if (value == _textureSizeListenable) {
      return;
    }

    if (attached) {
      _textureSizeListenable.removeListener(_onTextureSizeChanged);
    }

    final oldTextureSize = _textureSizeListenable.value;

    _textureSizeListenable = value;

    if (oldTextureSize != value.value) {
      markNeedsPaint();
    }

    if (attached) {
      _textureSizeListenable.addListener(_onTextureSizeChanged);
    }
  }

  Rect _rect;
  Rect get rect => _rect;
  set rect(Rect value) {
    if (value == _rect) {
      return;
    }

    _rect = value;
    markNeedsPaint();
  }

  BorderRadius? _borderRadius;
  BorderRadius? get borderRadius => _borderRadius;
  set borderRadius(BorderRadius? value) {
    if (value == _borderRadius) {
      return;
    }

    _borderRadius = value;
    markNeedsPaint();
  }

  /// The text direction with which to resolve [borderRadius].
  TextDirection? get textDirection => _textDirection;
  TextDirection? _textDirection;
  set textDirection(TextDirection? value) {
    if (_textDirection == value) {
      return;
    }

    _textDirection = value;
    markNeedsPaint();
  }

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

  void _onTextureSizeChanged() {
    markNeedsPaint();
  }

  @override
  @protected
  Size computeDryLayout(covariant BoxConstraints constraints) {
    return constraints.biggest;
  }

  @override
  bool hitTestSelf(Offset position) => _opaqueListenable.value;

  final LayerHandle<ContainerLayer> _clipLayer = LayerHandle<ContainerLayer>();

  @override
  void paint(PaintingContext context, Offset offset) {
    final borderRadius = _borderRadius;

    final oldLayer = _clipLayer.layer;

    if (borderRadius == null) {
      _clipLayer.layer = context.pushClipRect(
        needsCompositing,
        offset,
        Rect.fromLTWH(0, 0, _rect.width, _rect.height),
        _paintTexture,
        oldLayer: oldLayer is ClipRectLayer ? oldLayer : null,
      );
    } else {
      final clip =
          borderRadius.resolve(textDirection).toRRect(Offset.zero & _rect.size);

      _clipLayer.layer = context.pushClipRRect(
        needsCompositing,
        offset,
        clip.outerRect,
        clip,
        _paintTexture,
        clipBehavior: Clip.antiAlias,
        oldLayer: oldLayer is ClipRRectLayer ? oldLayer : null,
      );
    }
  }

  void _paintTexture(PaintingContext context, Offset offset) {
    final size = textureSizeListenable.value;

    context.addLayer(
      TextureLayer(
        rect: Rect.fromLTWH(
          offset.dx - _rect.left,
          offset.dy - _rect.top,
          size.width,
          size.height,
        ),
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
    opaqueListenable.addListener(_onOpaqueChanged);
    textureSizeListenable.addListener(_onTextureSizeChanged);
  }

  @override
  void detach() {
    cursorListenable.removeListener(_onCursorChanged);
    opaqueListenable.removeListener(_onOpaqueChanged);
    textureSizeListenable.removeListener(_onTextureSizeChanged);

    _validForMouseTracker = false;

    super.detach();
  }

  @override
  void dispose() {
    _clipLayer.layer = null;

    super.dispose();
  }
}
