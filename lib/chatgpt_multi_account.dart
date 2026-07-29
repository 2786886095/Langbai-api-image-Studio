import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'secure_storage_queue.dart';

const String chatGptAccountsSecureKey = 'langbai_chatgpt_accounts_v1';
const String chatGptActiveAccountSecureKey =
    'langbai_chatgpt_active_account_v1';
const String chatGptAutoSwitchSecureKey = 'langbai_chatgpt_auto_switch_v1';
const String chatGptTokenSecureKeyPrefix = 'langbai_chatgpt_token_v1_';

typedef ChatGptSessionActivator = Future<void> Function(
  String accessToken,
  String localAccountId,
);

const Set<String> chatGptAccountAvailabilityStates = <String>{
  'ready',
  'unknown',
  'expired',
  'authentication_failed',
  'rate_limited',
};

String _cleanText(Object? value, {int maxLength = 120}) {
  final cleaned = value
      ?.toString()
      .replaceAll(RegExp(r'[\u0000-\u001f\u007f]'), ' ')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
  if (cleaned == null || cleaned.isEmpty) return '';
  return cleaned.length <= maxLength
      ? cleaned
      : cleaned.substring(0, maxLength);
}

String maskChatGptEmail(Object? value) {
  final email = _cleanText(value, maxLength: 180);
  final at = email.lastIndexOf('@');
  if (at <= 0 || at >= email.length - 1) return '';
  final local = email.substring(0, at);
  final domain = email.substring(at + 1);
  final maskLength = max(3, min(8, local.length - 1));
  final mask = List<String>.filled(maskLength, '*').join();
  return '${local.substring(0, 1)}$mask@$domain';
}

Object? _path(Object? value, List<String> parts) {
  Object? current = value;
  for (final part in parts) {
    if (current is! Map) return null;
    current = current[part];
  }
  return current;
}

String _firstText(Iterable<Object?> values, {int maxLength = 120}) {
  for (final value in values) {
    final cleaned = _cleanText(value, maxLength: maxLength);
    if (cleaned.isNotEmpty) return cleaned;
  }
  return '';
}

String _normalizePlan(Object? value) {
  final plan = _cleanText(value, maxLength: 64).toLowerCase();
  const known = <String>{
    'free',
    'plus',
    'pro',
    'team',
    'business',
    'enterprise',
  };
  return known.contains(plan) ? plan : '';
}

Map<String, dynamic> _decodeJwtPayload(String token) {
  final parts = token.split('.');
  if (parts.length < 2) return <String, dynamic>{};
  try {
    final normalized = base64Url.normalize(parts[1]);
    final decoded = jsonDecode(utf8.decode(base64Url.decode(normalized)));
    if (decoded is Map) {
      return decoded.map(
        (key, value) => MapEntry(key.toString(), value),
      );
    }
  } catch (_) {
    // Some valid session access tokens are opaque rather than JWTs.
  }
  return <String, dynamic>{};
}

String? _findAccessToken(Object? value, [int depth = 0]) {
  if (depth > 8) return null;
  if (value is Map) {
    for (final key in const <String>[
      'accessToken',
      'access_token',
      'access-token',
    ]) {
      final candidate = value[key];
      if (candidate is String && candidate.trim().length >= 32) {
        return candidate.trim();
      }
    }
    for (final item in value.values) {
      final found = _findAccessToken(item, depth + 1);
      if (found != null) return found;
    }
  } else if (value is List) {
    for (final item in value) {
      final found = _findAccessToken(item, depth + 1);
      if (found != null) return found;
    }
  }
  return null;
}

DateTime? _parseExpiry(Object? value) {
  if (value is num) {
    final milliseconds = value > 1000000000000
        ? value.toInt()
        : (value.toDouble() * 1000).round();
    return DateTime.fromMillisecondsSinceEpoch(milliseconds, isUtc: true);
  }
  final text = _cleanText(value, maxLength: 80);
  if (text.isEmpty) return null;
  final numeric = num.tryParse(text);
  if (numeric != null) return _parseExpiry(numeric);
  return DateTime.tryParse(text)?.toUtc();
}

String _newLocalAccountId([Random? random]) {
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

class ParsedChatGptSession {
  const ParsedChatGptSession({
    required this.accessToken,
    required this.accountFingerprint,
    required this.displayName,
    required this.maskedEmail,
    required this.planLabel,
    required this.expiresAt,
  });

  final String accessToken;
  final String accountFingerprint;
  final String displayName;
  final String maskedEmail;
  final String planLabel;
  final DateTime? expiresAt;

  static ParsedChatGptSession parse(String rawInput) {
    var input = rawInput.trim();
    if (input.isEmpty) {
      throw const FormatException('Session JSON or access token is required.');
    }
    if (input.toLowerCase().startsWith('bearer ')) {
      input = input.substring(7).trim();
    }

    Object? session;
    String? token;
    try {
      session = jsonDecode(input);
      token = _findAccessToken(session);
      if (session is String && token == null) token = session.trim();
    } catch (_) {
      token = input.replaceAll(RegExp(r'''^["']|["']$'''), '').trim();
    }
    token ??= '';
    if (token.length < 32 ||
        token.contains(RegExp(r'\s')) ||
        token.length > 32768) {
      throw const FormatException(
        'No valid accessToken was found in the pasted content.',
      );
    }

    final jwt = _decodeJwtPayload(token);
    final user = _path(session, const <String>['user']);
    final account = _path(session, const <String>['account']);
    final profile =
        _path(jwt, const <String>['https://api.openai.com/profile']);
    final email = _firstText(<Object?>[
      _path(user, const <String>['email']),
      _path(profile, const <String>['email']),
      jwt['email'],
    ], maxLength: 180);
    final stableIdentity = _firstText(<Object?>[
      _path(user, const <String>['id']),
      _path(account, const <String>['id']),
      _path(session, const <String>['accountId']),
      jwt['sub'],
      email.toLowerCase(),
      token,
    ], maxLength: 32768);
    final fingerprint = sha256.convert(utf8.encode(stableIdentity)).toString();
    final displayName = _firstText(<Object?>[
      _path(user, const <String>['name']),
      _path(profile, const <String>['name']),
      jwt['name'],
      email.isNotEmpty ? email.split('@').first : null,
      '我的 ChatGPT',
    ], maxLength: 96);
    final plan = <Object?>[
      _path(session, const <String>['plan']),
      _path(session, const <String>['plan_type']),
      _path(user, const <String>['plan']),
      _path(account, const <String>['plan_type']),
      _path(jwt, const <String>['plan_type']),
    ].map(_normalizePlan).firstWhere(
          (value) => value.isNotEmpty,
          orElse: () => '',
        );
    final expiresAt = _parseExpiry(
          _path(session, const <String>['expires']),
        ) ??
        _parseExpiry(jwt['exp']);

    return ParsedChatGptSession(
      accessToken: token,
      accountFingerprint: fingerprint,
      displayName: displayName,
      maskedEmail: maskChatGptEmail(email),
      planLabel: plan,
      expiresAt: expiresAt,
    );
  }
}

class ChatGptSecureAccount {
  const ChatGptSecureAccount({
    required this.localAccountId,
    required this.accountFingerprint,
    required this.displayName,
    required this.maskedEmail,
    required this.planLabel,
    required this.expiresAt,
    required this.lastVerifiedAt,
    required this.status,
    required this.lastError,
  });

  final String localAccountId;
  final String accountFingerprint;
  final String displayName;
  final String maskedEmail;
  final String planLabel;
  final String expiresAt;
  final String lastVerifiedAt;
  final String status;
  final String lastError;

  factory ChatGptSecureAccount.fromJson(Map<dynamic, dynamic> json) {
    final status = _cleanText(json['status'], maxLength: 40);
    return ChatGptSecureAccount(
      localAccountId: _cleanText(json['local_account_id'], maxLength: 64),
      accountFingerprint:
          _cleanText(json['account_fingerprint'], maxLength: 64),
      displayName: _cleanText(json['display_name'], maxLength: 96),
      maskedEmail: _cleanText(json['masked_email'], maxLength: 180),
      planLabel: _normalizePlan(json['plan_label']),
      expiresAt: _cleanText(json['expires_at'], maxLength: 80),
      lastVerifiedAt: _cleanText(json['last_verified_at'], maxLength: 80),
      status: chatGptAccountAvailabilityStates.contains(status)
          ? status
          : 'unknown',
      lastError: _cleanText(json['last_error'], maxLength: 240),
    );
  }

  bool get isExpired {
    final parsed = DateTime.tryParse(expiresAt);
    return parsed != null && !parsed.toUtc().isAfter(DateTime.now().toUtc());
  }

  bool get isSelectable =>
      !isExpired &&
      status != 'expired' &&
      status != 'authentication_failed' &&
      status != 'rate_limited';

  ChatGptSecureAccount copyWith({
    String? displayName,
    String? maskedEmail,
    String? planLabel,
    String? expiresAt,
    String? lastVerifiedAt,
    String? status,
    String? lastError,
  }) {
    return ChatGptSecureAccount(
      localAccountId: localAccountId,
      accountFingerprint: accountFingerprint,
      displayName: displayName ?? this.displayName,
      maskedEmail: maskedEmail ?? this.maskedEmail,
      planLabel: planLabel ?? this.planLabel,
      expiresAt: expiresAt ?? this.expiresAt,
      lastVerifiedAt: lastVerifiedAt ?? this.lastVerifiedAt,
      status: status ?? this.status,
      lastError: lastError ?? this.lastError,
    );
  }

  Map<String, String> toJson() => <String, String>{
        'local_account_id': localAccountId,
        'account_fingerprint': accountFingerprint,
        'display_name': displayName,
        'masked_email': maskedEmail,
        'plan_label': planLabel,
        'expires_at': expiresAt,
        'last_verified_at': lastVerifiedAt,
        'status': status,
        'last_error': lastError,
      };
}

class ChatGptMultiAccountStore {
  ChatGptMultiAccountStore(this.storage);

  final FlutterSecureStorage storage;

  String tokenKey(String localAccountId) =>
      '$chatGptTokenSecureKeyPrefix$localAccountId';

  Future<List<ChatGptSecureAccount>> _readAccountsUnlocked() async {
    try {
      final raw = await storage.read(key: chatGptAccountsSecureKey);
      if (raw == null || raw.isEmpty) return <ChatGptSecureAccount>[];
      final decoded = jsonDecode(raw);
      if (decoded is! List) return <ChatGptSecureAccount>[];
      return decoded
          .whereType<Map>()
          .map(ChatGptSecureAccount.fromJson)
          .where((account) =>
              account.localAccountId.isNotEmpty &&
              account.accountFingerprint.length == 64)
          .toList(growable: false);
    } catch (_) {
      return <ChatGptSecureAccount>[];
    }
  }

  Future<List<ChatGptSecureAccount>> readAccounts() =>
      SecureStorageQueue.run(_readAccountsUnlocked);

  Future<void> _writeAccountsUnlocked(
    List<ChatGptSecureAccount> accounts,
  ) {
    return storage.write(
      key: chatGptAccountsSecureKey,
      value: jsonEncode(
        accounts.map((account) => account.toJson()).toList(growable: false),
      ),
    );
  }

  Future<void> writeAccounts(List<ChatGptSecureAccount> accounts) =>
      SecureStorageQueue.run(() => _writeAccountsUnlocked(accounts));

  Future<ChatGptSecureAccount> importSession(
    String rawInput, {
    String? preferredLocalAccountId,
  }) =>
      SecureStorageQueue.run(() async {
        final parsed = ParsedChatGptSession.parse(rawInput);
        final accounts = await _readAccountsUnlocked();
        final duplicateIndex = accounts.indexWhere(
          (account) => account.accountFingerprint == parsed.accountFingerprint,
        );
        final preferredIndex = preferredLocalAccountId == null
            ? -1
            : accounts.indexWhere(
                (account) => account.localAccountId == preferredLocalAccountId,
              );
        final existingIndex =
            duplicateIndex >= 0 ? duplicateIndex : preferredIndex;
        final localId = existingIndex >= 0
            ? accounts[existingIndex].localAccountId
            : (preferredLocalAccountId?.trim().isNotEmpty == true
                ? preferredLocalAccountId!.trim()
                : _newLocalAccountId());
        final expiresAt = parsed.expiresAt?.toUtc().toIso8601String() ?? '';
        final now = DateTime.now().toUtc().toIso8601String();
        final account = ChatGptSecureAccount(
          localAccountId: localId,
          accountFingerprint: parsed.accountFingerprint,
          displayName: parsed.displayName,
          maskedEmail: parsed.maskedEmail,
          planLabel: parsed.planLabel,
          expiresAt: expiresAt,
          lastVerifiedAt: now,
          status: parsed.expiresAt != null &&
                  !parsed.expiresAt!.toUtc().isAfter(DateTime.now().toUtc())
              ? 'expired'
              : 'ready',
          lastError: '',
        );
        final next = <ChatGptSecureAccount>[...accounts];
        if (existingIndex >= 0) {
          next[existingIndex] = account;
        } else {
          next.add(account);
        }
        await storage.write(
          key: tokenKey(localId),
          value: parsed.accessToken,
        );
        await _writeAccountsUnlocked(next);
        final active =
            (await storage.read(key: chatGptActiveAccountSecureKey) ?? '')
                .trim();
        if (active.isEmpty ||
            !next.any((item) => item.localAccountId == active)) {
          await storage.write(
            key: chatGptActiveAccountSecureKey,
            value: localId,
          );
        }
        return account;
      });

  Future<String> activeAccountId() => SecureStorageQueue.run(() async =>
      (await storage.read(key: chatGptActiveAccountSecureKey) ?? '').trim());

  Future<bool> autoSwitchEnabled() => SecureStorageQueue.run(() async =>
      (await storage.read(key: chatGptAutoSwitchSecureKey)) != 'false');

  Future<void> setAutoSwitch(bool enabled) => SecureStorageQueue.run(
        () => storage.write(
          key: chatGptAutoSwitchSecureKey,
          value: enabled ? 'true' : 'false',
        ),
      );

  Future<void> selectAccount(String localAccountId) =>
      SecureStorageQueue.run(() async {
        final accounts = await _readAccountsUnlocked();
        if (!accounts.any((item) => item.localAccountId == localAccountId)) {
          throw const FormatException('ChatGPT account was not found.');
        }
        await storage.write(
          key: chatGptActiveAccountSecureKey,
          value: localAccountId,
        );
      });

  Future<String> readToken(String localAccountId) =>
      SecureStorageQueue.run(() async {
        final token = await storage.read(key: tokenKey(localAccountId)) ?? '';
        if (token.length < 32) {
          throw const FormatException('ChatGPT account token is missing.');
        }
        return token;
      });

  /// Rehydrates a newly started in-process gateway from persisted secure
  /// storage. Updating the desktop app restarts the gateway process, but must
  /// not require the user to import the same account token again.
  Future<ChatGptSecureAccount?> restoreGatewaySession(
    ChatGptSessionActivator activate,
  ) async {
    final accounts = await readAccounts();
    if (accounts.isEmpty) return null;
    final activeId = await activeAccountId();
    final candidates = <ChatGptSecureAccount>[
      ...accounts.where((account) => account.localAccountId == activeId),
      ...accounts.where((account) => account.localAccountId != activeId),
    ];
    for (final account in candidates) {
      try {
        final token = await readToken(account.localAccountId);
        await activate(token, account.localAccountId);
        if (account.localAccountId != activeId) {
          await selectAccount(account.localAccountId);
        }
        return account;
      } catch (_) {
        // Keep every account and token untouched. A later account may still
        // be readable if one legacy secure-storage entry is damaged.
      }
    }
    return null;
  }

  Future<ChatGptSecureAccount?> activeAccount() async {
    final id = await activeAccountId();
    final accounts = await readAccounts();
    for (final account in accounts) {
      if (account.localAccountId == id) return account;
    }
    return accounts.isEmpty ? null : accounts.first;
  }

  Future<void> deleteAccount(String localAccountId) =>
      SecureStorageQueue.run(() async {
        final accounts = await _readAccountsUnlocked();
        final next = accounts
            .where((item) => item.localAccountId != localAccountId)
            .toList(growable: false);
        await storage.delete(key: tokenKey(localAccountId));
        await _writeAccountsUnlocked(next);
        final active =
            (await storage.read(key: chatGptActiveAccountSecureKey) ?? '')
                .trim();
        if (active == localAccountId) {
          if (next.isEmpty) {
            await storage.delete(key: chatGptActiveAccountSecureKey);
          } else {
            await storage.write(
              key: chatGptActiveAccountSecureKey,
              value: next.first.localAccountId,
            );
          }
        }
      });

  Future<ChatGptSecureAccount> markAccount(
    String localAccountId, {
    required String status,
    String lastError = '',
  }) =>
      SecureStorageQueue.run(() async {
        final accounts = await _readAccountsUnlocked();
        final index = accounts
            .indexWhere((item) => item.localAccountId == localAccountId);
        if (index < 0) {
          throw const FormatException('ChatGPT account was not found.');
        }
        final normalizedStatus =
            chatGptAccountAvailabilityStates.contains(status)
                ? status
                : 'unknown';
        final nextAccount = accounts[index].copyWith(
          status: normalizedStatus,
          lastError: lastError,
          lastVerifiedAt: normalizedStatus == 'ready'
              ? DateTime.now().toUtc().toIso8601String()
              : null,
        );
        final next = <ChatGptSecureAccount>[...accounts]..[index] = nextAccount;
        await _writeAccountsUnlocked(next);
        return nextAccount;
      });

  Future<ChatGptSecureAccount?> rotateAfterFailure({
    required String failedStatus,
    required String reason,
  }) =>
      SecureStorageQueue.run(() async {
        final accounts = await _readAccountsUnlocked();
        if (accounts.isEmpty) return null;
        var currentId =
            (await storage.read(key: chatGptActiveAccountSecureKey) ?? '')
                .trim();
        var currentIndex =
            accounts.indexWhere((item) => item.localAccountId == currentId);
        if (currentIndex < 0) currentIndex = 0;
        final current = accounts[currentIndex].copyWith(
          status: failedStatus,
          lastError: reason,
        );
        final updated = <ChatGptSecureAccount>[...accounts]..[currentIndex] =
            current;
        await _writeAccountsUnlocked(updated);
        if ((await storage.read(key: chatGptAutoSwitchSecureKey)) == 'false') {
          return null;
        }

        for (var offset = 1; offset < updated.length; offset++) {
          final candidate = updated[(currentIndex + offset) % updated.length];
          if (!candidate.isSelectable) continue;
          await storage.write(
            key: chatGptActiveAccountSecureKey,
            value: candidate.localAccountId,
          );
          return candidate;
        }
        return null;
      });

  Future<Map<String, Object?>> snapshot() => SecureStorageQueue.run(() async {
        final accounts = await _readAccountsUnlocked();
        var active =
            (await storage.read(key: chatGptActiveAccountSecureKey) ?? '')
                .trim();
        if (active.isEmpty && accounts.isNotEmpty) {
          active = accounts.first.localAccountId;
          await storage.write(
            key: chatGptActiveAccountSecureKey,
            value: active,
          );
        }
        return <String, Object?>{
          'accounts': accounts
              .map((account) => account.toJson())
              .toList(growable: false),
          'active_account_id': active,
          'auto_switch':
              (await storage.read(key: chatGptAutoSwitchSecureKey)) != 'false',
        };
      });
}
