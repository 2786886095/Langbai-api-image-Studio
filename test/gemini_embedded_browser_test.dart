import 'package:ai_image_generator/gemini_embedded_browser.dart';
import 'package:ai_image_generator/gemini_web_gateway.dart';
import 'package:flutter_test/flutter_test.dart';
import 'dart:io';

const String _profileId = '123e4567-e89b-42d3-a456-426614174000';

void main() {
  test('allows the authenticated Google original-image relay host', () {
    expect(
      isAllowedGeminiImageUrlForTest(
        Uri.parse(
          'https://work.fife.usercontent.google.com/rd-gg-dl/original',
        ),
      ),
      isTrue,
    );
  });
  test('embedded browser and gateway use the current selector protocol', () {
    expect(geminiEmbeddedSelectorPackVersion, '2026.07.30.6');
    expect(geminiSelectorPackVersion, geminiEmbeddedSelectorPackVersion);
  });

  test('login and generation readiness remain distinct', () {
    final loginOnly = geminiEmbeddedReadinessEvent(
      accountId: 'local-account',
      accountUuid: _profileId,
      maskedEmail: 'u***@example.com',
      loginReady: true,
      temporaryChatAvailable: false,
      fullsizeDownloadAvailable: true,
      selectorPackCompatible: true,
    );
    expect(loginOnly['status'], 'logged_in');
    expect(loginOnly['login_ready'], isTrue);
    expect(loginOnly['generation_ready'], isFalse);

    final directReady = geminiEmbeddedReadinessEvent(
      accountId: 'local-account',
      accountUuid: _profileId,
      maskedEmail: 'u***@example.com',
      loginReady: true,
      temporaryChatAvailable: false,
      directProtocolAvailable: true,
      fullsizeDownloadAvailable: true,
      selectorPackCompatible: true,
    );
    expect(directReady['status'], 'ready');
    expect(directReady['temporary_chat_available'], isFalse);
    expect(directReady['direct_protocol_available'], isTrue);

    final ready = geminiEmbeddedReadinessEvent(
      accountId: 'local-account',
      accountUuid: _profileId,
      maskedEmail: 'u***@example.com',
      loginReady: true,
      temporaryChatAvailable: true,
      fullsizeDownloadAvailable: true,
      selectorPackCompatible: true,
    );
    expect(ready['status'], 'ready');
    expect(ready['generation_ready'], isTrue);
  });

  test('embedded config keeps the real gateway key out of page JavaScript', () {
    const realKey = 'local-secret-that-must-stay-in-dart';
    final config = GeminiEmbeddedBrowserConfig.fromGateway(
      gateway: const <String, Object?>{
        'baseUrl': 'http://127.0.0.1:18160/v1/',
        'apiKey': realKey,
      },
      profileId: _profileId,
    );

    final safe = config.toSafeJavaScriptConfig('windows');
    expect(config.baseUrl, 'http://127.0.0.1:18160/v1');
    expect(config.apiKey, realKey);
    expect(safe['pairingKey'], isNot(realKey));
    expect(safe.values, isNot(contains(realKey)));
    expect(safe['profileId'], _profileId);
    expect(safe['nativeTransport'], 'postMessage');
    expect(config.nativeBridgeCapability, hasLength(64));
    expect(safe.values, isNot(contains(config.nativeBridgeCapability)));
  });

  test('embedded config rejects non-loopback gateways and invalid profiles',
      () {
    expect(
      () => GeminiEmbeddedBrowserConfig.fromGateway(
        gateway: const <String, Object?>{
          'baseUrl': 'https://example.com/v1',
          'apiKey': 'secret',
        },
        profileId: _profileId,
      ),
      throwsFormatException,
    );
    expect(
      () => GeminiEmbeddedBrowserConfig.fromGateway(
        gateway: const <String, Object?>{
          'baseUrl': 'http://127.0.0.1:18160/v1',
          'apiKey': 'secret',
        },
        profileId: 'not-a-uuid',
      ),
      throwsFormatException,
    );
  });

  test('only Gemini and Google sign-in pages can navigate at top level', () {
    expect(
      isAllowedGeminiTopLevelNavigation('https://gemini.google.com/app'),
      isTrue,
    );
    expect(
      isAllowedGeminiTopLevelNavigation(
        'https://accounts.google.com/v3/signin/identifier',
      ),
      isTrue,
    );
    expect(
      isAllowedGeminiTopLevelNavigation('https://example.com/phishing'),
      isFalse,
    );
    expect(
        isAllowedGeminiTopLevelNavigation('http://gemini.google.com'), isFalse);
  });

  test('request controller switches profiles and collapses login UI', () {
    final controller = GeminiEmbeddedBrowserRequestController();
    final second = createGeminiEmbeddedProfileId();

    controller.show(_profileId);
    expect(controller.visible, isTrue);
    expect(controller.profileId, _profileId);

    controller.collapse();
    expect(controller.visible, isFalse);

    controller.activate(second);
    expect(controller.visible, isFalse);
    expect(controller.profileId, second);
    expect(controller.requestRevision, greaterThanOrEqualTo(2));
  });

  test('Windows Gemini profiles are named and isolated from the main profile',
      () {
    final second = createGeminiEmbeddedProfileId();
    expect(windowsGeminiWebViewProfileName(_profileId), startsWith('gemini-'));
    expect(
      windowsGeminiWebViewProfileName(_profileId),
      isNot(windowsGeminiWebViewProfileName(second)),
    );
    expect(windowsGeminiWebViewProfileName(_profileId), isNot('Default'));
  });

  test('legacy local account IDs resolve through browser_profile_id', () {
    const legacyLocalId = 'legacy-hash-that-is-not-a-uuid';
    final snapshot = <String, Object?>{
      'accounts': <Map<String, Object?>>[
        <String, Object?>{
          'local_account_id': legacyLocalId,
          'browser_profile_id': _profileId,
          'account_uuid': '',
        },
      ],
    };
    expect(
      geminiEmbeddedProfileIdFromSnapshot(snapshot, legacyLocalId),
      _profileId,
    );
    expect(
      geminiEmbeddedProfileIdForAccount(
        <String, Object?>{'local_account_id': legacyLocalId},
      ),
      isEmpty,
    );
  });

  test('legacy Gemini default profile is copied before WebView startup',
      () async {
    final temp = await Directory.systemTemp.createTemp('gemini-profile-');
    addTearDown(() async {
      if (await temp.exists()) await temp.delete(recursive: true);
    });
    final source = Directory(<String>[
      temp.path,
      'AI Image Generator',
      'gemini_embedded_webview',
      _profileId,
      'EBWebView',
      'Default',
    ].join(Platform.pathSeparator));
    await source.create(recursive: true);
    await File(<String>[source.path, 'Cookies'].join(Platform.pathSeparator))
        .writeAsString('legacy-session', flush: true);
    await File(<String>[source.path, 'LOCK'].join(Platform.pathSeparator))
        .writeAsString('stale-lock', flush: true);

    await migrateWindowsGeminiProfilesBeforeWebViewStart(
      const <String>[_profileId],
      localAppData: temp.path,
    );

    final destination = Directory(<String>[
      windowsGeminiWebViewDataPath(localAppData: temp.path),
      'EBWebView',
      'WV2Profile_${windowsGeminiWebViewProfileName(_profileId)}',
    ].join(Platform.pathSeparator));
    expect(
      await File(<String>[destination.path, 'Cookies']
              .join(Platform.pathSeparator))
          .readAsString(),
      'legacy-session',
    );
    expect(
      await File(
              <String>[destination.path, 'LOCK'].join(Platform.pathSeparator))
          .exists(),
      isFalse,
    );
    expect(await source.exists(), isTrue,
        reason: 'migration keeps a rollback copy');
  });

  test('shared Default Google session migrates only into the active profile',
      () async {
    final temp =
        await Directory.systemTemp.createTemp('gemini-shared-profile-');
    addTearDown(() async {
      if (await temp.exists()) await temp.delete(recursive: true);
    });
    final webViewRoot = Directory(<String>[
      windowsGeminiWebViewDataPath(localAppData: temp.path),
      'EBWebView',
    ].join(Platform.pathSeparator));
    final sourceNetwork = Directory(<String>[
      webViewRoot.path,
      'Default',
      'Network',
    ].join(Platform.pathSeparator));
    final destination = Directory(<String>[
      webViewRoot.path,
      'WV2Profile_${windowsGeminiWebViewProfileName(_profileId)}',
    ].join(Platform.pathSeparator));
    final destinationNetwork = Directory(<String>[
      destination.path,
      'Network',
    ].join(Platform.pathSeparator));
    await sourceNetwork.create(recursive: true);
    await destinationNetwork.create(recursive: true);
    await File(<String>[sourceNetwork.path, 'Cookies']
            .join(Platform.pathSeparator))
        .writeAsString('SQLite SAPISID authenticated-session', flush: true);
    await File(<String>[destinationNetwork.path, 'Cookies']
            .join(Platform.pathSeparator))
        .writeAsString('SQLite NID anonymous-session', flush: true);
    await File(
            <String>[destination.path, 'keep-me'].join(Platform.pathSeparator))
        .writeAsString('preserved', flush: true);
    final sourceSessionState = File(<String>[
      webViewRoot.path,
      'Default',
      'Local Storage',
      'leveldb',
      'session-state',
    ].join(Platform.pathSeparator));
    await sourceSessionState.create(recursive: true);
    await sourceSessionState.writeAsString(
      'authenticated-profile-state',
      flush: true,
    );

    await migrateWindowsGeminiProfilesBeforeWebViewStart(
      const <String>[_profileId],
      sharedDefaultMigrationProfileId: _profileId,
      localAppData: temp.path,
    );

    expect(
      await File(<String>[destinationNetwork.path, 'Cookies']
              .join(Platform.pathSeparator))
          .readAsString(),
      contains('SAPISID'),
    );
    expect(
      await File(<String>[
        destination.path,
        'Local Storage',
        'leveldb',
        'session-state',
      ].join(Platform.pathSeparator))
          .readAsString(),
      'authenticated-profile-state',
    );
    expect(
      webViewRoot.listSync().whereType<Directory>().any(
          (directory) => directory.path.contains('.pre-langbai-migration-')),
      isTrue,
      reason: 'the anonymous destination profile keeps a rollback copy',
    );
    expect(
      await File(<String>[
        destination.path,
        '.langbai-shared-profile-migration-v2',
      ].join(Platform.pathSeparator))
          .exists(),
      isTrue,
    );
  });

  test('an authenticated named profile is never overwritten by Default',
      () async {
    final temp = await Directory.systemTemp.createTemp('gemini-auth-profile-');
    addTearDown(() async {
      if (await temp.exists()) await temp.delete(recursive: true);
    });
    final webViewRoot = Directory(<String>[
      windowsGeminiWebViewDataPath(localAppData: temp.path),
      'EBWebView',
    ].join(Platform.pathSeparator));
    final sourceCookies = File(<String>[
      webViewRoot.path,
      'Default',
      'Network',
      'Cookies',
    ].join(Platform.pathSeparator));
    final destinationCookies = File(<String>[
      webViewRoot.path,
      'WV2Profile_${windowsGeminiWebViewProfileName(_profileId)}',
      'Network',
      'Cookies',
    ].join(Platform.pathSeparator));
    await sourceCookies.parent.create(recursive: true);
    await destinationCookies.parent.create(recursive: true);
    await sourceCookies.writeAsString('SAPISID source-account', flush: true);
    await destinationCookies.writeAsString(
      '__Secure-1PSID destination-account',
      flush: true,
    );

    await migrateWindowsGeminiProfilesBeforeWebViewStart(
      const <String>[_profileId],
      sharedDefaultMigrationProfileId: _profileId,
      localAppData: temp.path,
    );

    expect(
      await destinationCookies.readAsString(),
      '__Secure-1PSID destination-account',
    );
  });

  test('an uncheckpointed Default cookie database is not copied', () async {
    final temp = await Directory.systemTemp.createTemp('gemini-live-profile-');
    addTearDown(() async {
      if (await temp.exists()) await temp.delete(recursive: true);
    });
    final webViewRoot = Directory(<String>[
      windowsGeminiWebViewDataPath(localAppData: temp.path),
      'EBWebView',
    ].join(Platform.pathSeparator));
    final sourceNetwork = Directory(<String>[
      webViewRoot.path,
      'Default',
      'Network',
    ].join(Platform.pathSeparator));
    final destinationCookies = File(<String>[
      webViewRoot.path,
      'WV2Profile_${windowsGeminiWebViewProfileName(_profileId)}',
      'Network',
      'Cookies',
    ].join(Platform.pathSeparator));
    await sourceNetwork.create(recursive: true);
    await destinationCookies.parent.create(recursive: true);
    await File(<String>[sourceNetwork.path, 'Cookies']
            .join(Platform.pathSeparator))
        .writeAsString('SAPISID source-account', flush: true);
    await File(<String>[sourceNetwork.path, 'Cookies-wal']
            .join(Platform.pathSeparator))
        .writeAsString('pending sqlite transaction', flush: true);
    await destinationCookies.writeAsString('NID destination', flush: true);

    await migrateWindowsGeminiProfilesBeforeWebViewStart(
      const <String>[_profileId],
      sharedDefaultMigrationProfileId: _profileId,
      localAppData: temp.path,
    );

    expect(await destinationCookies.readAsString(), 'NID destination');
  });
}
