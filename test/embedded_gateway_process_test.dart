import 'dart:convert';
import 'dart:io';

import 'package:ai_image_generator/embedded_chatgpt_gateway.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final executable =
      (Platform.environment['LANGBAI_EMBEDDED_GATEWAY_EXECUTABLE'] ?? '')
          .trim();

  test(
    'Windows manager launches, authenticates, bridges a session, and stops the packaged gateway',
    () async {
      final manager = EmbeddedChatGptGatewayManager();
      try {
        final config = await manager.configuration();
        expect(config['embedded'], isTrue);
        expect(config['apiKey'], matches(RegExp(r'^[a-f0-9]{64}$')));
        final baseUrl = Uri.parse(config['baseUrl']! as String);
        expect(baseUrl.host, '127.0.0.1');
        expect(baseUrl.port, inInclusiveRange(18081, 18100));

        final client = HttpClient()..findProxy = (_) => 'DIRECT';
        try {
          final request = await client.getUrl(
            baseUrl.replace(path: '/v1/image-capabilities'),
          );
          request.headers.set(
            HttpHeaders.authorizationHeader,
            'Bearer ${config['apiKey']}',
          );
          final response = await request.close();
          final decoded =
              jsonDecode(await utf8.decoder.bind(response).join()) as Map;
          expect(response.statusCode, 200);
          expect(decoded['image_only'], isTrue);
          expect(decoded['models'], contains('gpt-image-2'));
        } finally {
          client.close(force: true);
        }

        final payload = base64Url
            .encode(utf8.encode(jsonEncode(<String, Object?>{
              'sub': 'gateway-process-test',
              'exp': DateTime.now()
                      .toUtc()
                      .add(const Duration(minutes: 10))
                      .millisecondsSinceEpoch ~/
                  1000,
            })))
            .replaceAll('=', '');
        await manager.setSessionToken(
          'eyJhbGciOiJub25lIn0.$payload.signature',
          accountId: '11111111-1111-4111-8111-111111111111',
        );
        await manager.clearSessionToken(
          accountId: '11111111-1111-4111-8111-111111111111',
        );
      } finally {
        await manager.stop();
      }
    },
    skip: executable.isEmpty
        ? 'Set LANGBAI_EMBEDDED_GATEWAY_EXECUTABLE to run the packaged-process test.'
        : false,
  );
}
