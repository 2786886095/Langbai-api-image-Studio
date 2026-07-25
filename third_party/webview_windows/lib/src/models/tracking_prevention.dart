/// The level of tracking prevention for the WebView.
enum WebviewTrackingPreventionLevel {
  /// Disables tracking prevention.
  none,

  /// Blocks only harmful trackers.
  basic,

  /// Blocks harmful trackers and trackers from sites the user has not visited.
  balanced,

  /// Blocks harmful trackers and most trackers from all sites.
  strict;
}
