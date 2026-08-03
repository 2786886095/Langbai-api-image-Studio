import 'dart:async';
import 'dart:math';
import 'dart:io';

import 'package:ai_image_generator/embedded_chatgpt_gateway.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('gateway secrets are 64 lowercase hexadecimal characters', () {
    final value = randomGatewaySecret(random: Random(7));
    expect(value, matches(RegExp(r'^[a-f0-9]{64}$')));
  });

  test('gateway executable uses a private sibling directory', () {
    final value = embeddedGatewayExecutablePath(
      executableDirectory: r'C:\Program Files\Langbai',
    );
    expect(
      value,
      endsWith(
          'chatgpt_gateway${Platform.pathSeparator}langbai_chatgpt_gateway.exe'),
    );
  });

  test('gateway updater targets only the bundled helper process name', () {
    expect(embeddedGatewayProcessName, 'langbai_chatgpt_gateway.exe');
    expect(
        embeddedGatewayProcessName.contains(Platform.pathSeparator), isFalse);
  });

  test('failed gateway startup Future is cleared and can be retried', () async {
    var attempts = 0;
    final manager = EmbeddedChatGptGatewayManager(
      startAttemptForTesting: () async {
        attempts++;
        if (attempts == 1) throw StateError('first launch failed');
        return <String, Object?>{
          'baseUrl': 'http://127.0.0.1:18081/v1',
          'apiKey': 'test-key',
          'embedded': true,
        };
      },
    );

    await expectLater(manager.configuration(), throwsStateError);
    final recovered = await manager.configuration();

    expect(attempts, 2);
    expect(recovered['embedded'], isTrue);
  });

  test('gateway update stop command matches the exact executable path', () {
    final command = gatewayStopByPathPowerShell(
      r'F:\Apps\Langbai\chatgpt_gateway\langbai_chatgpt_gateway.exe',
    );
    expect(command, contains(r'[IO.Path]::GetFullPath'));
    expect(command, contains(r'F:\Apps\Langbai\chatgpt_gateway'));
    expect(command, contains(r'$_.ExecutablePath'));
  });

  test('concurrent activation of the same account and token is single-flight',
      () async {
    final coordinator = SessionActivationCoordinator();
    final release = Completer<void>();
    var calls = 0;

    Future<void> apply() async {
      calls++;
      await release.future;
    }

    final attempts = List<Future<void>>.generate(
      70,
      (_) => coordinator.activate(
        accountId: 'account-one',
        fingerprint: 'fingerprint-one',
        apply: apply,
      ),
    );
    await Future<void>.delayed(Duration.zero);
    expect(calls, 1);
    release.complete();
    await Future.wait(attempts);

    await coordinator.activate(
      accountId: 'account-one',
      fingerprint: 'fingerprint-one',
      apply: apply,
    );
    expect(calls, 1);
  });

  test('activation retries after failure and runs again for a new token',
      () async {
    final coordinator = SessionActivationCoordinator();
    var calls = 0;

    Future<void> apply() async {
      calls++;
      if (calls == 1) throw StateError('temporary bridge failure');
    }

    await expectLater(
      coordinator.activate(
        accountId: 'account-one',
        fingerprint: 'fingerprint-one',
        apply: apply,
      ),
      throwsStateError,
    );
    await coordinator.activate(
      accountId: 'account-one',
      fingerprint: 'fingerprint-one',
      apply: apply,
    );
    await coordinator.activate(
      accountId: 'account-one',
      fingerprint: 'fingerprint-two',
      apply: apply,
    );
    expect(calls, 3);
  });

  test('gateway restart invalidates an activation still in flight', () async {
    final coordinator = SessionActivationCoordinator();
    final release = Completer<void>();
    var calls = 0;
    final first = coordinator.activate(
      accountId: 'account-one',
      fingerprint: 'fingerprint-one',
      apply: () async {
        calls++;
        await release.future;
      },
    );
    coordinator.clear();
    release.complete();
    await expectLater(first, throwsA(isA<HttpException>()));

    await coordinator.activate(
      accountId: 'account-one',
      fingerprint: 'fingerprint-one',
      apply: () async {
        calls++;
      },
    );
    expect(calls, 2);
  });
}
