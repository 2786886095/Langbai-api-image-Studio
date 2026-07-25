import 'dart:async';

enum NavigationDecision { navigate, cancel }

typedef NavigationStartingDelegate = FutureOr<NavigationDecision> Function(
    String url, bool isUserInitiated, bool isRedirected);
