import 'package:flutter/foundation.dart';

enum WebviewDownloadEventKind {
  downloadStarted,
  downloadCompleted,
  downloadProgress
}

@immutable
class WebviewDownloadEvent {
  const WebviewDownloadEvent(
    this.kind,
    this.url,
    this.resultFilePath,
    this.bytesReceived,
    this.totalBytesToReceive,
  );

  final WebviewDownloadEventKind kind;
  final String url;
  final String resultFilePath;
  final int bytesReceived;
  final int totalBytesToReceive;
}
