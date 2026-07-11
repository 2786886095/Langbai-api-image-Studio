import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, UIDocumentPickerDelegate {
  private let channelName = "com.aigen.ai_image_generator/downloads"
  private var pendingDirectoryResult: FlutterResult?
  private var pendingDirectoryKind = "images"

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    GeneratedPluginRegistrant.register(with: self)
    if let controller = window?.rootViewController as? FlutterViewController {
      let channel = FlutterMethodChannel(
        name: channelName,
        binaryMessenger: controller.binaryMessenger
      )
      channel.setMethodCallHandler { [weak self] call, result in
        self?.handle(call, result: result)
      }
    }
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  private func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    let arguments = call.arguments as? [String: Any] ?? [:]
    switch call.method {
    case "chooseDirectory":
      chooseDirectory(kind: arguments["kind"] as? String ?? "images", result: result)
    case "getSavedDirectories":
      result(savedDirectories())
    case "saveFile":
      saveFile(arguments: arguments, result: result)
    case "openExternalUrl":
      openExternalUrl(arguments["url"] as? String ?? "", result: result)
    case "downloadUpdate":
      result(FlutterError(
        code: "unsupported",
        message: "iOS updates are opened in the system browser.",
        details: nil
      ))
    default:
      result(FlutterMethodNotImplemented)
    }
  }

  private func chooseDirectory(kind: String, result: @escaping FlutterResult) {
    guard pendingDirectoryResult == nil else {
      result(FlutterError(code: "busy", message: "A directory picker is already open.", details: nil))
      return
    }
    pendingDirectoryKind = kind
    pendingDirectoryResult = result
    let picker = UIDocumentPickerViewController(documentTypes: ["public.folder"], in: .open)
    picker.delegate = self
    picker.allowsMultipleSelection = false
    guard let controller = window?.rootViewController else {
      pendingDirectoryResult = nil
      result(FlutterError(code: "unavailable", message: "Cannot present the directory picker.", details: nil))
      return
    }
    controller.present(picker, animated: true)
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    guard let result = pendingDirectoryResult else { return }
    pendingDirectoryResult = nil
    guard let url = urls.first else {
      result(FlutterError(code: "cancelled", message: "Directory selection cancelled.", details: nil))
      return
    }
    do {
      let bookmark = try url.bookmarkData(
        options: .minimalBookmark,
        includingResourceValuesForKeys: nil,
        relativeTo: nil
      )
      UserDefaults.standard.set(bookmark, forKey: bookmarkKey(pendingDirectoryKind))
      result(url.absoluteString)
    } catch {
      result(FlutterError(code: "bookmark_failed", message: error.localizedDescription, details: nil))
    }
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    let result = pendingDirectoryResult
    pendingDirectoryResult = nil
    result?(FlutterError(code: "cancelled", message: "Directory selection cancelled.", details: nil))
  }

  private func bookmarkKey(_ kind: String) -> String {
    return "download_directory_\(kind)"
  }

  private func resolveDirectory(_ kind: String) throws -> URL {
    guard let bookmark = UserDefaults.standard.data(forKey: bookmarkKey(kind)) else {
      throw NSError(domain: channelName, code: 1, userInfo: [
        NSLocalizedDescriptionKey: "No \(kind) download directory selected."
      ])
    }
    var stale = false
    let url = try URL(
      resolvingBookmarkData: bookmark,
      options: .withoutUI,
      relativeTo: nil,
      bookmarkDataIsStale: &stale
    )
    if stale {
      let refreshed = try url.bookmarkData(
        options: .minimalBookmark,
        includingResourceValuesForKeys: nil,
        relativeTo: nil
      )
      UserDefaults.standard.set(refreshed, forKey: bookmarkKey(kind))
    }
    return url
  }

  private func savedDirectories() -> [String: String] {
    var directories: [String: String] = [:]
    for kind in ["images", "zips"] {
      if let url = try? resolveDirectory(kind) {
        directories[kind] = url.absoluteString
      } else {
        directories[kind] = ""
      }
    }
    return directories
  }

  private func sanitizeFileName(_ value: String, fallback: String) -> String {
    let source = value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? fallback : value
    let invalid = CharacterSet(charactersIn: "\\/:*?\"<>|")
    let sanitized = source.components(separatedBy: invalid).joined(separator: "_")
    return String(sanitized.prefix(180))
  }

  private func saveFile(arguments: [String: Any], result: @escaping FlutterResult) {
    let kind = arguments["kind"] as? String ?? "images"
    let fileName = sanitizeFileName(
      arguments["fileName"] as? String ?? "download.bin",
      fallback: "download.bin"
    )
    let folder = sanitizeFileName(arguments["folder"] as? String ?? "", fallback: "")
    let encoded = arguments["base64"] as? String ?? ""
    guard let data = Data(base64Encoded: encoded) else {
      result(FlutterError(code: "invalid_data", message: "Invalid base64 file data.", details: nil))
      return
    }

    do {
      let root = try resolveDirectory(kind)
      let accessing = root.startAccessingSecurityScopedResource()
      defer { if accessing { root.stopAccessingSecurityScopedResource() } }
      var directory = root
      if !folder.isEmpty && folder != "." && folder != ".." {
        directory.appendPathComponent(folder, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      }
      let target = directory.appendingPathComponent(fileName, isDirectory: false)
      try data.write(to: target, options: .atomic)
      result(target.absoluteString)
    } catch {
      result(FlutterError(code: "save_failed", message: error.localizedDescription, details: nil))
    }
  }

  private func openExternalUrl(_ value: String, result: @escaping FlutterResult) {
    guard let url = URL(string: value), url.scheme == "http" || url.scheme == "https" else {
      result(FlutterError(code: "invalid_url", message: "Only http/https URLs can be opened.", details: nil))
      return
    }
    UIApplication.shared.open(url, options: [:]) { success in
      result(success)
    }
  }
}
