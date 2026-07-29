const List<String> geminiWebRatios = <String>[
  '1:1',
  '3:2',
  '2:3',
  '4:3',
  '3:4',
  '16:9',
  '9:16',
];

const List<String> geminiDimensionModes = <String>[
  'native_fullsize',
  'strict_native',
  'exact_output',
  'local_4k_upscale',
];

Map<String, Object?> geminiWebCapabilities({
  required bool companionConnected,
  required bool sessionAvailable,
  int effectiveConcurrency = 1,
}) =>
    <String, Object?>{
      'provider': 'gemini_web',
      'image_only': true,
      'model': 'gemini-web-image',
      'max_batch_input': 100,
      'max_effective_concurrency': 10,
      'effective_concurrency': effectiveConcurrency,
      'companion_connected': companionConnected,
      'session_available': sessionAvailable,
      'temporary_chat_required': true,
      'fullsize_download': true,
      'reference_images': <String, Object?>{
        'verified_max': 1,
        'client_limit': 20,
      },
      'resolution_intents': <String>['2k'],
      'ratios': geminiWebRatios,
      'dimension_modes': geminiDimensionModes,
      'verified_native_presets': <Map<String, Object?>>[
        <String, Object?>{
          'ratio': '1:1',
          'size': '2048x2048',
          'status': 'verified'
        },
        <String, Object?>{
          'ratio': '3:2',
          'size': '2528x1696',
          'status': 'verified'
        },
      ],
    };
