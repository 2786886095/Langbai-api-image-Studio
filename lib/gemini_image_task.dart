import 'dart:convert';

const Set<String> geminiTerminalStates = <String>{
  'succeeded',
  'failed',
  'needs_login',
  'protocol_changed',
  'cancelled',
};

class GeminiImageTask {
  GeminiImageTask({
    required this.id,
    required this.clientRequestId,
    required this.request,
    this.status = 'queued',
    DateTime? createdAt,
    DateTime? updatedAt,
    this.error,
    this.audit = const <String, Object?>{},
    this.recovery = const <String, Object?>{},
    this.accountId = '',
    this.claimId = '',
    this.claimedAccountId = '',
    this.claimExpiresAt,
    this.resultFile = '',
  })  : createdAt = createdAt ?? DateTime.now().toUtc(),
        updatedAt = updatedAt ?? DateTime.now().toUtc();

  final String id;
  final String clientRequestId;
  final Map<String, Object?> request;
  String status;
  DateTime createdAt;
  DateTime updatedAt;
  Map<String, Object?>? error;
  Map<String, Object?> audit;
  Map<String, Object?> recovery;
  String accountId;
  String claimId;
  String claimedAccountId;
  DateTime? claimExpiresAt;
  String resultFile;

  bool get terminal => geminiTerminalStates.contains(status);

  Map<String, Object?> toJson({
    bool includeRequest = false,
    bool includeRecovery = false,
  }) =>
      <String, Object?>{
        'id': id,
        'client_request_id': clientRequestId,
        'status': status,
        'created_at': createdAt.toIso8601String(),
        'updated_at': updatedAt.toIso8601String(),
        'account_id': accountId,
        if (claimId.isNotEmpty) 'claim_id': claimId,
        if (claimedAccountId.isNotEmpty) 'claimed_account_id': claimedAccountId,
        if (claimExpiresAt != null)
          'claim_expires_at': claimExpiresAt!.toIso8601String(),
        if (includeRequest) 'request': request,
        if (includeRecovery && recovery.isNotEmpty) 'recovery': recovery,
        if (error != null) 'error': error,
        'audit': audit,
        if (resultFile.isNotEmpty)
          'result': <String, Object?>{
            'data': <Map<String, Object?>>[
              <String, Object?>{'url': '/v1/image-tasks/$id/files/0'}
            ],
            'audit': audit,
          },
      };

  Map<String, Object?> toPersistenceJson() => <String, Object?>{
        ...toJson(includeRequest: true, includeRecovery: true),
        'result_file': resultFile,
      };

  static GeminiImageTask fromJson(Map<String, dynamic> json) {
    final request = (json['request'] as Map?)?.map(
          (key, value) => MapEntry(key.toString(), value),
        ) ??
        <String, Object?>{};
    final error = (json['error'] as Map?)?.map(
      (key, value) => MapEntry(key.toString(), value),
    );
    final audit = (json['audit'] as Map?)?.map(
          (key, value) => MapEntry(key.toString(), value),
        ) ??
        <String, Object?>{};
    final recovery = (json['recovery'] as Map?)?.map(
          (key, value) => MapEntry(key.toString(), value),
        ) ??
        <String, Object?>{};
    return GeminiImageTask(
      id: json['id']?.toString() ?? '',
      clientRequestId: json['client_request_id']?.toString() ?? '',
      request: request,
      status: json['status']?.toString() ?? 'queued',
      createdAt: DateTime.tryParse(json['created_at']?.toString() ?? ''),
      updatedAt: DateTime.tryParse(json['updated_at']?.toString() ?? ''),
      error: error,
      audit: audit,
      recovery: recovery,
      accountId: json['account_id']?.toString() ?? '',
      claimId: json['claim_id']?.toString() ?? '',
      claimedAccountId: json['claimed_account_id']?.toString() ?? '',
      claimExpiresAt:
          DateTime.tryParse(json['claim_expires_at']?.toString() ?? ''),
      resultFile: json['result_file']?.toString() ?? '',
    );
  }

  static List<GeminiImageTask> decodeList(String source) {
    final decoded = jsonDecode(source);
    if (decoded is! List) return <GeminiImageTask>[];
    return decoded
        .whereType<Map>()
        .map((item) => GeminiImageTask.fromJson(
              item.map((key, value) => MapEntry(key.toString(), value)),
            ))
        .where((task) => task.id.isNotEmpty)
        .toList();
  }
}
