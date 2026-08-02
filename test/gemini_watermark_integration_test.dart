import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('watermark remover bundle is packaged and loaded before app code', () {
    final index = File('index.html').readAsStringSync();
    final pubspec = File('pubspec.yaml').readAsStringSync();
    final serviceWorker = File('sw.js').readAsStringSync();
    final bundle = File('gemini-watermark-remover.bundle.js');

    expect(bundle.existsSync(), isTrue);
    expect(bundle.lengthSync(), greaterThan(100000));
    expect(index, contains('gemini-watermark-remover.bundle.js'));
    expect(
      index.indexOf('gemini-watermark-remover.bundle.js'),
      lessThan(index.indexOf('app.js?v=')),
    );
    expect(pubspec, contains('- gemini-watermark-remover.bundle.js'));
    expect(serviceWorker, contains('./gemini-watermark-remover.bundle.js'));
  });

  test('Gemini generation processing is enabled by default and audited', () {
    final app = File('app.js').readAsStringSync();

    expect(app, contains('geminiWatermarkRemovalEnabled: true'));
    expect(app, contains('removeGeminiWatermarkBlob(blob)'));
    expect(app, contains('transform: "gemini_watermark_removed"'));
    expect(app, contains('watermarkRemoval: processed.watermarkRemoval'));
  });

  test('standalone import supports multiple images and folder output', () {
    final index = File('index.html').readAsStringSync();
    final app = File('app.js').readAsStringSync();

    expect(index, contains('id="watermarkImageInput"'));
    expect(index, contains('multiple hidden'));
    expect(app, contains('processImportedWatermarkImages'));
    expect(
        app, contains('files.length > 1 ? buildWatermarkOutputFolderName()'));
    expect(app, contains('await nativeDownload.chooseDir("images")'));
  });
}
