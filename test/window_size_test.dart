import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ai_image_generator/main.dart';

void main() {
  test('normal window sizes are not degenerate', () {
    expect(isDegenerateWindowSize(const Size(1280, 800)), isFalse);
    expect(isDegenerateWindowSize(const Size(2, 2)), isFalse);
  });

  test('zero size (typical of a minimized Windows window) is degenerate', () {
    expect(isDegenerateWindowSize(Size.zero), isTrue);
  });

  test('very small sizes below the safety margin are degenerate', () {
    expect(isDegenerateWindowSize(const Size(1, 1)), isTrue);
    expect(isDegenerateWindowSize(const Size(1, 800)), isTrue);
    expect(isDegenerateWindowSize(const Size(1280, 1)), isTrue);
  });
}
