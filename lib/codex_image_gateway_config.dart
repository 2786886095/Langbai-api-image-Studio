import 'dart:io';

const String codexImageGatewayBaseUrl = 'http://127.0.0.1:18081/v1';
const String codexImageGatewayDirectoryName = 'LangbaiCodexImageGateway';
const String codexImageGatewayKeyFileName = 'local-api-key.txt';

bool isValidCodexImageGatewayKey(String value) {
  return RegExp(r'^[a-f0-9]{64}$').hasMatch(value.trim());
}

String codexImageGatewayKeyPath(
  String localAppData, {
  String? separator,
}) {
  final root = localAppData.trim();
  if (root.isEmpty) {
    throw const FileSystemException('LOCALAPPDATA is unavailable.');
  }
  final sep = separator ?? Platform.pathSeparator;
  return [
    root.replaceAll(RegExp(r'[\\/]+$'), ''),
    codexImageGatewayDirectoryName,
    codexImageGatewayKeyFileName,
  ].join(sep);
}

Future<Map<String, String>> loadCodexImageGatewayConfig({
  bool? isWindows,
  Map<String, String>? environment,
  Future<String> Function(String path)? readText,
}) async {
  if (!(isWindows ?? Platform.isWindows)) {
    throw const FileSystemException(
      'ChatGPT web image gateway is available only in the Windows app.',
    );
  }
  final env = environment ?? Platform.environment;
  final path = codexImageGatewayKeyPath(env['LOCALAPPDATA'] ?? '');
  final key = ((readText != null)
          ? await readText(path)
          : await File(path).readAsString())
      .trim();
  if (!isValidCodexImageGatewayKey(key)) {
    throw const FormatException('Invalid local image gateway key.');
  }
  return <String, String>{
    'baseUrl': codexImageGatewayBaseUrl,
    'apiKey': key,
  };
}
