import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

const String _geminiAccountsKey = 'gemini_web_accounts_v1';

class GeminiAccountMetadata {
  const GeminiAccountMetadata({
    required this.localAccountId,
    this.displayName = 'Gemini 浏览器账号',
    this.maskedEmail = '',
    this.browserProfileId = '',
    this.platform = '',
    this.status = 'unknown',
    this.lastVerifiedAt = '',
    this.temporaryChatAvailable = false,
    this.fullsizeDownloadAvailable = false,
    this.effectiveConcurrency = 1,
    this.lastError = '',
  });

  final String localAccountId;
  final String displayName;
  final String maskedEmail;
  final String browserProfileId;
  final String platform;
  final String status;
  final String lastVerifiedAt;
  final bool temporaryChatAvailable;
  final bool fullsizeDownloadAvailable;
  final int effectiveConcurrency;
  final String lastError;

  Map<String, Object?> toJson() => <String, Object?>{
        'local_account_id': localAccountId,
        'display_name': displayName,
        'masked_email': maskedEmail,
        'browser_profile_id': browserProfileId,
        'platform': platform,
        'status': status,
        'last_verified_at': lastVerifiedAt,
        'temporary_chat_available': temporaryChatAvailable,
        'fullsize_download_available': fullsizeDownloadAvailable,
        'effective_concurrency': effectiveConcurrency,
        if (lastError.isNotEmpty) 'last_error': lastError,
      };

  factory GeminiAccountMetadata.fromJson(Map<String, dynamic> json) =>
      GeminiAccountMetadata(
        localAccountId: json['local_account_id']?.toString() ?? '',
        displayName: json['display_name']?.toString() ?? 'Gemini 浏览器账号',
        maskedEmail: json['masked_email']?.toString() ?? '',
        browserProfileId: json['browser_profile_id']?.toString() ?? '',
        platform: json['platform']?.toString() ?? '',
        status: json['status']?.toString() ?? 'unknown',
        lastVerifiedAt: json['last_verified_at']?.toString() ?? '',
        temporaryChatAvailable: json['temporary_chat_available'] == true,
        fullsizeDownloadAvailable: json['fullsize_download_available'] == true,
        effectiveConcurrency:
            int.tryParse(json['effective_concurrency']?.toString() ?? '') ?? 1,
        lastError: json['last_error']?.toString() ?? '',
      );
}

class GeminiAccountStore {
  const GeminiAccountStore(this.storage);

  final FlutterSecureStorage storage;

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

  Future<List<GeminiAccountMetadata>> upsert(
    GeminiAccountMetadata account,
  ) async {
    final accounts = await load();
    final index = accounts.indexWhere(
      (item) => item.localAccountId == account.localAccountId,
    );
    if (index >= 0) {
      accounts[index] = account;
    } else {
      accounts.add(account);
    }
    await storage.write(
      key: _geminiAccountsKey,
      value: jsonEncode(accounts.map((item) => item.toJson()).toList()),
    );
    return accounts;
  }

  Future<List<GeminiAccountMetadata>> remove(String id) async {
    final accounts = await load()
      ..removeWhere((account) => account.localAccountId == id);
    await storage.write(
      key: _geminiAccountsKey,
      value: jsonEncode(accounts.map((item) => item.toJson()).toList()),
    );
    return accounts;
  }
}
