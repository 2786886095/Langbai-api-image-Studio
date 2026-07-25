import 'package:flutter/gestures.dart';

/// Pointer button type
// Order must match WebviewPointerButton (see webview.h)
enum PointerButton {
  none,
  primary,
  secondary,
  tertiary;

  /// Attempts to translate a button constant such as [kPrimaryMouseButton]
  /// to a [PointerButton]
  static PointerButton fromValue(int value) {
    switch (value) {
      case kPrimaryMouseButton:
        return PointerButton.primary;
      case kSecondaryMouseButton:
        return PointerButton.secondary;
      case kTertiaryButton:
        return PointerButton.tertiary;
      default:
        return PointerButton.none;
    }
  }
}

/// Pointer Event kind
// Order must match WebviewPointerEventKind (see webview.h)
enum WebviewPointerEventKind { activate, down, enter, leave, up, update }
