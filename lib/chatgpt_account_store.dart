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

  final Directory root;

  Directory get profilesRoot => Directory(<String>[
        root.path,
        chatGptProfilesDirectoryName
      ].join(Platform.pathSeparator));

  File get accountIndexFile => File(<String>[
        root.path,
        chatGptAccountIndexFileName
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

  Future<ChatGptAccountRecord> ensurePrimaryAccount() async {
    final accounts = await readAccounts();
    if (accounts.isNotEmpty) {
      await profileDirectory(accounts.first.localAccountId)
          .create(recursive: true);
      return accounts.first;
    }
    final record =
        ChatGptAccountRecord.signedOut(createLocalChatGptAccountId());
    await profileDirectory(record.localAccountId).create(recursive: true);
    await writeAccounts(<ChatGptAccountRecord>[record]);
    await writeState(record);
    return record;
  }

  Future<List<ChatGptAccountRecord>> readAccounts() async {
    try {
      if (!await accountIndexFile.exists()) return <ChatGptAccountRecord>[];
      final decoded = jsonDecode(await accountIndexFile.readAsString());
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
    } catch (_) {
      return <ChatGptAccountRecord>[];
    }
  }

  Future<ChatGptAccountRecord> readState(String accountId) async {
    final id = validateLocalChatGptAccountId(accountId);
    try {
      final file = stateFile(id);
      if (!await file.exists()) return ChatGptAccountRecord.signedOut(id);
      final decoded = jsonDecode(await file.readAsString());
      if (decoded is! Map) return ChatGptAccountRecord.signedOut(id);
      return ChatGptAccountRecord.fromJson(
        decoded,
        expectedAccountId: id,
      );
    } catch (_) {
      return ChatGptAccountRecord.signedOut(id);
    }
  }

  Future<void> writeState(ChatGptAccountRecord record) async {
    final file = stateFile(record.localAccountId);
    await _writeJsonAtomically(file, record.toJson());
    final accounts = await readAccounts();
    final next = <ChatGptAccountRecord>[
      record,
      ...accounts.where(
        (item) => item.localAccountId != record.localAccountId,
      ),
    ];
    await writeAccounts(next);
  }

  Future<void> writeAccounts(List<ChatGptAccountRecord> records) async {
    await _writeJsonAtomically(
      accountIndexFile,
      records.map((record) => record.toJson()).toList(growable: false),
    );
  }

  Future<void> _writeJsonAtomically(File file, Object value) async {
    await file.parent.create(recursive: true);
    final temporary = File('${file.path}.tmp');
    await temporary.writeAsString(jsonEncode(value), flush: true);
    if (await file.exists()) await file.delete();
    await temporary.rename(file.path);
  }
}
