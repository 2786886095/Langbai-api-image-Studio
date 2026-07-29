import 'dart:async';

import 'package:ai_image_generator/secure_storage_queue.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('all provider storage operations share one FIFO mutex', () async {
    final events = <String>[];
    final gate = Completer<void>();

    final first = SecureStorageQueue.run(() async {
      events.add('api-start');
      await gate.future;
      events.add('api-end');
    });
    final second = SecureStorageQueue.run(() async {
      events.add('chatgpt-start');
      events.add('chatgpt-end');
    });
    final third = SecureStorageQueue.run(() async {
      events.add('gemini-start');
      events.add('gemini-end');
    });

    await Future<void>.delayed(Duration.zero);
    expect(events, <String>['api-start']);
    gate.complete();
    await Future.wait(<Future<void>>[first, second, third]);

    expect(events, <String>[
      'api-start',
      'api-end',
      'chatgpt-start',
      'chatgpt-end',
      'gemini-start',
      'gemini-end',
    ]);
  });
}
