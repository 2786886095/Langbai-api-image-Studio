import 'dart:async';
import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

const String _geminiAccountsKey = 'gemini_web_accounts_v1';
const String _geminiAutoSwitchKey = 'gemini_web_auto_switch_v1';

class GeminiAccountMetadata {
  const GeminiAccountMetadata({
    required this.localAccountId,
    this.accountUuid = '',
    this.displayName = 'Gemini 浏览器账号',
    this.maskedEmail = '',
    this.browserProfileId = '',
    this.platform = '',
    this.status = 'unknown',
    this.loginReady = false,
    this.quotaState = 'unknown',
    this.cooldownUntil = '',
    this.lastErrorCode = '',
    this.lastQuotaAt = '',
    this.lastVerifiedAt = '',
    this.temporaryChatAvailable = false,
    this.fullsizeDownloadAvailable = false,
    this.effectiveConcurrency = 1,
    this.lastError = '',
  });

  final String localAccountId;
  final String accountUuid;
  final String displayName;
  final String maskedEmail;
  final String browserProfileId;
  final String platform;
  final String status;
  final bool loginReady;
  final String quotaState;
  final String cooldownUntil;
  final String lastErrorCode;
  final String lastQuotaAt;
  final String lastVerifiedAt;
  final bool temporaryChatAvailable;
  final bool fullsizeDownloadAvailable;
  final int effectiveConcurrency;
  final String lastError;

  bool get coolingDown {
    final until = DateTime.tryParse(cooldownUntil);
    return until != null && until.isAfter(DateTime.now().toUtc());
  }

  bool get available =>
      loginReady &&
      status == 'ready' &&
      quotaState != 'exhausted' &&
      !coolingDown &&
      fullsizeDownloadAvailable;

  GeminiAccountMetadata copyWith({
    String? localAccountId,
    String? accountUuid,
    String? displayName,
    String? maskedEmail,
    String? browserProfileId,
    String? platform,
    String? status,
    bool? loginReady,
    String? quotaState,
    String? cooldownUntil,
    String? lastErrorCode,
    String? lastQuotaAt,
    String? lastVerifiedAt,
    bool? temporaryChatAvailable,
    bool? fullsizeDownloadAvailable,
    int? effectiveConcurrency,
    String? lastError,
  }) =>
      GeminiAccountMetadata(
        localAccountId: localAccountId ?? this.localAccountId,
        accountUuid: accountUuid ?? this.accountUuid,
        displayName: displayName ?? this.displayName,
        maskedEmail: maskedEmail ?? this.maskedEmail,
        browserProfileId: browserProfileId ?? this.browserProfileId,
        platform: platform ?? this.platform,
        status: status ?? this.status,
        loginReady: loginReady ?? this.loginReady,
        quotaState: quotaState ?? this.quotaState,
        cooldownUntil: cooldownUntil ?? this.cooldownUntil,
        lastErrorCode: lastErrorCode ?? this.lastErrorCode,
        lastQuotaAt: lastQuotaAt ?? this.lastQuotaAt,
        lastVerifiedAt: lastVerifiedAt ?? this.lastVerifiedAt,
        temporaryChatAvailable:
            temporaryChatAvailable ?? this.temporaryChatAvailable,
        fullsizeDownloadAvailable:
            fullsizeDownloadAvailable ?? this.fullsizeDownloadAvailable,
        effectiveConcurrency: effectiveConcurrency ?? this.effectiveConcurrency,
        lastError: lastError ?? this.lastError,
      );

  Map<String, Object?> toJson() => <String, Object?>{
        'local_account_id': localAccountId,
        if (accountUuid.isNotEmpty) 'account_uuid': accountUuid,
        'display_name': displayName,
        'masked_email': maskedEmail,
        'browser_profile_id': browserProfileId,
        'platform': platform,
        'status': status,
        'login_ready': loginReady,
        'quota_state': quotaState,
        if (cooldownUntil.isNotEmpty) 'cooldown_until': cooldownUntil,
        if (lastErrorCode.isNotEmpty) 'last_error_code': lastErrorCode,
        if (lastQuotaAt.isNotEmpty) 'last_quota_at': lastQuotaAt,
        'last_verified_at': lastVerifiedAt,
        'temporary_chat_available': temporaryChatAvailable,
        'fullsize_download_available': fullsizeDownloadAvailable,
        'effective_concurrency': effectiveConcurrency,
        'available': available,
        if (lastError.isNotEmpty) 'last_error': lastError,
      };

  factory GeminiAccountMetadata.fromJson(Map<String, dynamic> json) {
    final status = json['status']?.toString() ?? 'unknown';
    return GeminiAccountMetadata(
      localAccountId: json['local_account_id']?.toString() ?? '',
      accountUuid: json['account_uuid']?.toString() ?? '',
      displayName: json['display_name']?.toString() ?? 'Gemini 浏览器账号',
      maskedEmail: json['masked_email']?.toString() ?? '',
      browserProfileId: json['browser_profile_id']?.toString() ?? '',
      platform: json['platform']?.toString() ?? '',
      status: status,
      loginReady: json.containsKey('login_ready')
          ? json['login_ready'] == true
          : status == 'ready',
      quotaState: json['quota_state']?.toString() ??
          (status == 'quota_exhausted' ? 'exhausted' : 'unknown'),
      cooldownUntil: json['cooldown_until']?.toString() ?? '',
      lastErrorCode: json['last_error_code']?.toString() ?? '',
      lastQuotaAt: json['last_quota_at']?.toString() ?? '',
      lastVerifiedAt: json['last_verified_at']?.toString() ?? '',
      temporaryChatAvailable: json['temporary_chat_available'] == true,
      fullsizeDownloadAvailable: json['fullsize_download_available'] == true,
      effectiveConcurrency:
          int.tryParse(json['effective_concurrency']?.toString() ?? '') ?? 1,
      lastError: json['last_error']?.toString() ?? '',
    );
  }
}

class GeminiAccountStore {
  GeminiAccountStore(this.storage);

  final FlutterSecureStorage storage;
  Future<void> _mutationChain = Future<void>.value();

  Future<List<GeminiAccountMetadata>> load() async {
    final raw = await storage.read(key: _geminiAccountsKey);
    if (raw == null || raw.isEmpty) return <GeminiAccountMetadata>[];
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! List) return <GeminiAccountMetadata>[];
      return decoded
          .whereType<Map>()
          .map((value) => GeminiAccountMetadata.fromJson(
                value.map((key, item) => MapEntry(key.toString(), item)),
              ))
          .where((account) => account.localAccountId.isNotEmpty)
          .toList();
    } catch (_) {
      return <GeminiAccountMetadata>[];
    }
  }

  Future<bool> autoSwitchEnabled() async {
    final raw = (await storage.read(key: _geminiAutoSwitchKey) ?? '').trim();
    return raw != 'false';
  }

  Future<bool> setAutoSwitchEnabled(bool enabled) async {
    await storage.write(
      key: _geminiAutoSwitchKey,
      value: enabled ? 'true' : 'false',
    );
    return enabled;
  }

  Future<T> _mutate<T>(
    Future<T> Function(List<GeminiAccountMetadata> accounts) operation,
  ) {
    final completer = Completer<T>();
    _mutationChain = _mutationChain.catchError((Object _) {}).then((_) async {
      try {
        completer.complete(await operation(await load()));
      } catch (error, stackTrace) {
        completer.completeError(error, stackTrace);
      }
    });
    return completer.future;
  }

  Future<void> _write(List<GeminiAccountMetadata> accounts) => storage.write(
        key: _geminiAccountsKey,
        value: jsonEncode(accounts.map((item) => item.toJson()).toList()),
      );

  Future<List<GeminiAccountMetadata>> upsert(
    GeminiAccountMetadata account,
  ) =>
      _mutate((accounts) async {
        final index = accounts.indexWhere(
          (item) => item.localAccountId == account.localAccountId,
        );
        if (index >= 0) {
          accounts[index] = account;
        } else {
          accounts.add(account);
        }
        await _write(accounts);
        return accounts;
      });

  Future<List<GeminiAccountMetadata>> remove(String id) =>
      _mutate((accounts) async {
        accounts.removeWhere((account) => account.localAccountId == id);
        await _write(accounts);
        return accounts;
      });
}
