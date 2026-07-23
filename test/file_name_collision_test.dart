import 'package:flutter_test/flutter_test.dart';

import 'package:ai_image_generator/main.dart';

void main() {
  test('collision-safe names keep incrementing beyond two copies', () {
    final existing = <String>{
      'panel.png',
      'panel（1）.png',
      'panel（2）.png',
      'panel（3）.png',
    };

    expect(
      collisionSafeFileName('panel.png', existing.contains),
      'panel（4）.png',
    );
  });

  test('collision-safe names preserve extensionless file names', () {
    final existing = <String>{'project', 'project（1）'};

    expect(
      collisionSafeFileName('project', existing.contains),
      'project（2）',
    );
  });
}
