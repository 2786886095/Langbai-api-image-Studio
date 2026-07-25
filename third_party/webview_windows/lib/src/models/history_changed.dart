import 'package:flutter/foundation.dart';

@immutable
class HistoryChanged {
  const HistoryChanged({
    required this.canGoBack,
    required this.canGoForward,
  });

  final bool canGoBack;
  final bool canGoForward;
}
