import 'dart:convert';
import 'dart:io';
import 'dart:math';

const String chatGptProfilesDirectoryName = 'ChatGPTProfiles';
const String chatGptAccountIndexFileName = 'accounts.json';
const String chatGptAuthStateFileName = 'auth-state.json';

const Set<String> chatGptAuthStatuses = <String>{
  'signed_out',
  'opening_login',
  'waiting_for_user',
  'verifying',
  'ready',
  'expired',
  'rate_limited',
  'protocol_changed',
  'error',
  'closed',
};

final RegExp _accountIdPattern = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
);

String createLocalChatGptAccountId([Random? random]) {
  final source = random ?? Random.secure();
  final bytes = List<int>.generate(16, (_) => source.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex =
      bytes.map((value) => value.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
      '${hex.substring(12, 16)}-${hex.substring(16, 20)}-'
      '${hex.substring(20)}';
}

String validateLocalChatGptAccountId(Object? value) {
  final id = value?.toString().trim().toLowerCase() ?? '';
  if (!_accountIdPattern.hasMatch(id)) {
    throw const FormatException('Invalid local ChatGPT account id.');
  }
  return id;
}

String sanitizeChatGptAccountLabel(
  Object? value, {
  required String fallback,
  int maxLength = 96,
}) {
  final text = value
      ?.toString()
      .replaceAll(RegExp(r'[\u0000-\u001f\u007f]'), ' ')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
  if (text == null || text.isEmpty) return fallback;
  return text.length <= maxLength ? text : text.substring(0, maxLength);
}

String sanitizeMaskedEmail(Object? value) {
  final text = sanitizeChatGptAccountLabel(
    value,
    fallback: '',
    maxLength: 160,
  );
  if (text.isEmpty || !text.contains('@')) return '';
  // Only masked addresses are allowed to cross the browser/native boundary.
  if (!text.contains('*')) return '';
  return text;
}

String sanitizeChatGptAuthStatus(Object? value) {
  final status = value?.toString().trim() ?? '';
  return chatGptAuthStatuses.contains(status) ? status : 'error';
}

class ChatGptAccountRecord {
  const ChatGptAccountRecord({
    required this.localAccountId,
    required this.displayName,
    required this.maskedEmail,
    required this.planLabel,
    required this.lastVerifiedAt,
    required this.status,
  });

  final String localAccountId;
  final String displayName;
  final String maskedEmail;
  final String planLabel;
  final String lastVerifiedAt;
  final String status;

  factory ChatGptAccountRecord.signedOut(String accountId) {
    return ChatGptAccountRecord(
      localAccountId: validateLocalChatGptAccountId(accountId),
      displayName: '我的 ChatGPT',
      maskedEmail: '',
      planLabel: '',
      lastVerifiedAt: '',
      status: 'signed_out',
    );
  }

  factory ChatGptAccountRecord.fromJson(
    Map<dynamic, dynamic> json, {
    required String expectedAccountId,
  }) {
    final accountId = validateLocalChatGptAccountId(expectedAccountId);
    final incomingId = json['local_account_id']?.toString().toLowerCase();
    if (incomingId != null &&
        incomingId.isNotEmpty &&
        incomingId != accountId) {
      throw const FormatException('ChatGPT account state id mismatch.');
    }
    final status = sanitizeChatGptAuthStatus(json['status']);
    return ChatGptAccountRecord(
      localAccountId: accountId,
      displayName: sanitizeChatGptAccountLabel(
        json['display_name'],
        fallback: '我的 ChatGPT',
      ),
      maskedEmail: sanitizeMaskedEmail(json['masked_email']),
      planLabel: sanitizeChatGptAccountLabel(
        json['plan_label'],
        fallback: '',
        maxLength: 64,
      ),
      lastVerifiedAt: _sanitizeIsoTime(json['last_verified_at']),
      status: status,
    );
  }

  ChatGptAccountRecord copyWith({
    String? displayName,
    String? maskedEmail,
    String? planLabel,
    String? lastVerifiedAt,
    String? status,
  }) {
    return ChatGptAccountRecord(
      localAccountId: localAccountId,
      displayName: displayName ?? this.displayName,
      maskedEmail: maskedEmail ?? this.maskedEmail,
      planLabel: planLabel ?? this.planLabel,
      lastVerifiedAt: lastVerifiedAt ?? this.lastVerifiedAt,
      status: status ?? this.status,
    );
  }

  Map<String, String> toJson() => <String, String>{
        'local_account_id': localAccountId,
        'display_name': displayName,
        'masked_email': maskedEmail,
        'plan_label': planLabel,
        'last_verified_at': lastVerifiedAt,
        'status': status,
      };
}

String _sanitizeIsoTime(Object? value) {
  final raw = value?.toString().trim() ?? '';
  if (raw.isEmpty) return '';
  final parsed = DateTime.tryParse(raw);
  return parsed?.toUtc().toIso8601String() ?? '';
}

class ChatGptAccountStore {
  ChatGptAccountStore({String? localAppData})
      : root = Directory(
          <String>[
            localAppData ??
                Platform.environment['LOCALAPPDATA'] ??
                Directory.current.path,
            'LangbaiImageStudio',
          ].join(Platform.pathSeparator),
        );

  static Future<void> _processMutationTail = Future<void>.value();

  final Directory root;

  Directory get profilesRoot => Directory(<String>[
        root.path,
        chatGptProfilesDirectoryName,
      ].join(Platform.pathSeparator));

  File get accountIndexFile => File(<String>[
        root.path,
        chatGptAccountIndexFileName,
      ].join(Platform.pathSeparator));

  File get _lockFile => File(<String>[
        root.path,
        'chatgpt-accounts.lock',
      ].join(Platform.pathSeparator));

  Directory profileDirectory(String accountId) => Directory(
        <String>[
          profilesRoot.path,
          validateLocalChatGptAccountId(accountId),
        ].join(Platform.pathSeparator),
      );

  File stateFile(String accountId) => File(
        <String>[
          profileDirectory(accountId).path,
          chatGptAuthStateFileName,
        ].join(Platform.pathSeparator),
      );

  Future<T> _withStoreLock<T>(Future<T> Function() operation) {
    final attempt =
        _processMutationTail.catchError((Object _) {}).then((_) async {
      RandomAccessFile? handle;
      try {
        await root.create(recursive: true);
        handle = await _lockFile.open(mode: FileMode.append);
        await handle.lock(FileLock.exclusive);
        return await operation();
      } finally {
        if (handle != null) {
          try {
            await handle.unlock();
          } catch (_) {
            // Closing the handle still releases an OS-level lock.
          }
          await handle.close();
        }
      }
    });
    _processMutationTail = attempt.then<void>(
      (_) {},
      onError: (Object _, StackTrace __) {},
    );
    return attempt;
  }

  Future<ChatGptAccountRecord> ensurePrimaryAccount() =>
      _withStoreLock(() async {
        final accounts = await _readAccountsUnlocked();
        if (accounts.isNotEmpty) {
          await profileDirectory(accounts.first.localAccountId)
              .create(recursive: true);
          return accounts.first;
        }
        final record =
            ChatGptAccountRecord.signedOut(createLocalChatGptAccountId());
        await profileDirectory(record.localAccountId).create(recursive: true);
        await _writeAccountsUnlocked(<ChatGptAccountRecord>[record]);
        await _writeStateFileUnlocked(record);
        return record;
      });

  Future<List<ChatGptAccountRecord>> readAccounts() =>
      _withStoreLock(_readAccountsUnlocked);

  Future<List<ChatGptAccountRecord>> _readAccountsUnlocked() async {
    final decoded = await _readRecoveredJson(
      accountIndexFile,
      (value) => value is List,
    );
    if (decoded is! List) return <ChatGptAccountRecord>[];
    final result = <ChatGptAccountRecord>[];
    for (final item in decoded) {
      if (item is! Map) continue;
      final id = item['local_account_id']?.toString();
      if (id == null) continue;
      try {
        result.add(ChatGptAccountRecord.fromJson(
          item,
          expectedAccountId: id,
        ));
      } on FormatException {
        // Ignore malformed metadata without touching profile directories.
      }
    }
    return result;
  }

  Future<ChatGptAccountRecord> readState(String accountId) {
    final id = validateLocalChatGptAccountId(accountId);
    return _withStoreLock(() => _readStateUnlocked(id));
  }

  Future<ChatGptAccountRecord> _readStateUnlocked(String id) async {
    final decoded = await _readRecoveredJson(
      stateFile(id),
      (value) => value is Map,
    );
    if (decoded is! Map) return ChatGptAccountRecord.signedOut(id);
    try {
      return ChatGptAccountRecord.fromJson(decoded, expectedAccountId: id);
    } catch (_) {
      return ChatGptAccountRecord.signedOut(id);
    }
  }

  Future<void> writeState(ChatGptAccountRecord record) =>
      _withStoreLock(() async {
        await _writeStateFileUnlocked(record);
        final accounts = await _readAccountsUnlocked();
        final next = <ChatGptAccountRecord>[
          record,
          ...accounts.where(
            (item) => item.localAccountId != record.localAccountId,
          ),
        ];
        await _writeAccountsUnlocked(next);
      });

  Future<void> _writeStateFileUnlocked(ChatGptAccountRecord record) =>
      _writeJsonAtomically(stateFile(record.localAccountId), record.toJson());

  Future<void> writeAccounts(List<ChatGptAccountRecord> records) =>
      _withStoreLock(() => _writeAccountsUnlocked(records));

  Future<void> _writeAccountsUnlocked(
    List<ChatGptAccountRecord> records,
  ) =>
      _writeJsonAtomically(
        accountIndexFile,
        records.map((record) => record.toJson()).toList(growable: false),
      );

  Future<Object?> _readRecoveredJson(
    File primary,
    bool Function(Object? value) validator,
  ) async {
    final candidates = <File>[
      primary,
      File('${primary.path}.tmp'),
      File('${primary.path}.bak'),
    ];
    final valid = <String, ({File file, Object? value})>{};
    for (final candidate in candidates) {
      try {
        if (!await candidate.exists()) continue;
        final value = jsonDecode(await candidate.readAsString());
        if (!validator(value)) continue;
        valid[candidate.path] = (
          file: candidate,
          value: value,
        );
      } catch (_) {
        // Keep searching the primary, interrupted .tmp, and .bak copies.
      }
    }
    if (valid.isEmpty) return null;
    // A complete fixed .tmp means the process crashed after flushing the new
    // value but before replacing the primary. It is therefore authoritative
    // even on filesystems whose timestamp resolution cannot order both files.
    // Without a valid .tmp, keep a valid primary; use .bak only for recovery.
    final selected = valid['${primary.path}.tmp'] ??
        valid[primary.path] ??
        valid['${primary.path}.bak']!;
    if (selected.file.path != primary.path) {
      await _promoteRecoveredJson(primary, selected.value);
      if (selected.file.path.endsWith('.tmp') && await selected.file.exists()) {
        await selected.file.delete();
      }
    }
    return selected.value;
  }

  Future<void> _promoteRecoveredJson(File primary, Object? value) async {
    await primary.parent.create(recursive: true);
    final recovery = File('${primary.path}.recovering');
    if (await recovery.exists()) await recovery.delete();
    await recovery.writeAsString(jsonEncode(value), flush: true);
    if (await primary.exists()) await primary.delete();
    await recovery.rename(primary.path);
  }

  Future<void> _writeJsonAtomically(File file, Object value) async {
    await file.parent.create(recursive: true);
    final temporary = File('${file.path}.tmp');
    final backup = File('${file.path}.bak');
    if (await temporary.exists()) await temporary.delete();
    final encoded = jsonEncode(value);
    await temporary.writeAsString(encoded, flush: true);
    // Verify the complete temporary file before moving the previous primary.
    jsonDecode(await temporary.readAsString());

    var movedPrimary = false;
    try {
      if (await file.exists()) {
        if (await backup.exists()) await backup.delete();
        await file.rename(backup.path);
        movedPrimary = true;
      }
      await temporary.rename(file.path);
    } catch (_) {
      if (!await file.exists() && movedPrimary && await backup.exists()) {
        await backup.copy(file.path);
      }
      rethrow;
    }
  }
}
