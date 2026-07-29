import 'dart:async';

/// Serializes every secure-storage operation in this process.
///
/// flutter_secure_storage's Windows backend persists a shared encrypted
/// container. Concurrent read-modify-write operations from independent
/// provider stores can otherwise overwrite keys written by another store.
class SecureStorageQueue {
  SecureStorageQueue._();

  static Future<void> _tail = Future<void>.value();

  static Future<T> run<T>(Future<T> Function() operation) {
    final completer = Completer<T>();
    _tail = _tail.catchError((Object _) {}).then((_) async {
      try {
        completer.complete(await operation());
      } catch (error, stackTrace) {
        completer.completeError(error, stackTrace);
      }
    });
    return completer.future;
  }
}
