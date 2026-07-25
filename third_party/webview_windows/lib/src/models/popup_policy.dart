import 'dart:async';

enum NewWindowDecision { allow, deny, sameWindow }

typedef NewWindowRequestedDelegate = FutureOr<NewWindowDecision> Function(
    String url, bool isUserInitiated);
