import Flutter
import UIKit
import WebKit

@main
@objc class AppDelegate: FlutterAppDelegate, UIDocumentPickerDelegate {
  private let channelName = "com.aigen.ai_image_generator/downloads"
  private let geminiSessionsChannelName = "com.aigen.ai_image_generator/gemini_sessions"
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
      let geminiSessions = FlutterMethodChannel(
        name: geminiSessionsChannelName,
        binaryMessenger: controller.binaryMessenger
      )
      geminiSessions.setMethodCallHandler { [weak self] call, result in
        self?.handleGeminiSession(call, result: result)
      }
    }
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  private func handleGeminiSession(
    _ call: FlutterMethodCall,
    result: @escaping FlutterResult
  ) {
    switch call.method {
    case "capture":
      captureGeminiSession(result: result)
    case "restore":
      let arguments = call.arguments as? [String: Any] ?? [:]
      restoreGeminiSession(snapshot: arguments["snapshot"], result: result)
    default:
      result(FlutterMethodNotImplemented)
    }
  }

  private func isGeminiCookieDomain(_ value: String) -> Bool {
    let domain = value.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
    return domain == "google.com" || domain.hasSuffix(".google.com")
  }

  private func captureGeminiSession(result: @escaping FlutterResult) {
    WKWebsiteDataStore.default().httpCookieStore.getAllCookies { [weak self] cookies in
      guard let self = self else {
        result(FlutterError(code: "unavailable", message: "The app is unavailable.", details: nil))
        return
      }
      let snapshot: [[String: Any]] = cookies
        .filter { self.isGeminiCookieDomain($0.domain) }
        .map { cookie in
          var value: [String: Any] = [
            "name": cookie.name,
            "value": cookie.value,
            "domain": cookie.domain,
            "path": cookie.path,
            "secure": cookie.isSecure,
            "httpOnly": cookie.isHTTPOnly,
          ]
          if let expires = cookie.expiresDate {
            value["expires"] = expires.timeIntervalSince1970
          }
          return value
        }
      result(snapshot)
    }
  }

  private func restoreGeminiSession(snapshot: Any?, result: @escaping FlutterResult) {
    let store = WKWebsiteDataStore.default().httpCookieStore
    store.getAllCookies { [weak self] cookies in
      guard let self = self else {
        result(FlutterError(code: "unavailable", message: "The app is unavailable.", details: nil))
        return
      }
      let deleteGroup = DispatchGroup()
      for cookie in cookies where self.isGeminiCookieDomain(cookie.domain) {
        deleteGroup.enter()
        store.delete(cookie) { deleteGroup.leave() }
      }
      deleteGroup.notify(queue: .main) {
        let entries = snapshot as? [[String: Any]] ?? []
        let setGroup = DispatchGroup()
        for entry in entries {
          guard
            let name = entry["name"] as? String,
            let value = entry["value"] as? String,
            let domain = entry["domain"] as? String,
            self.isGeminiCookieDomain(domain)
          else { continue }
          var properties: [HTTPCookiePropertyKey: Any] = [
            .name: name,
            .value: value,
            .domain: domain,
            .path: entry["path"] as? String ?? "/",
          ]
          if entry["secure"] as? Bool == true {
            properties[.secure] = "TRUE"
          }
          if entry["httpOnly"] as? Bool == true {
            properties[HTTPCookiePropertyKey("HttpOnly")] = "TRUE"
          }
          if let expires = entry["expires"] as? Double {
            properties[.expires] = Date(timeIntervalSince1970: expires)
          }
          guard let cookie = HTTPCookie(properties: properties) else { continue }
          setGroup.enter()
          store.setCookie(cookie) { setGroup.leave() }
        }
        setGroup.notify(queue: .main) { result(true) }
      }
    }
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

  private func collisionSafeFileURL(directory: URL, fileName: String) -> URL {
    let desired = directory.appendingPathComponent(fileName, isDirectory: false)
    if !FileManager.default.fileExists(atPath: desired.path) { return desired }
    let value = fileName as NSString
    let ext = value.pathExtension
    let stem = value.deletingPathExtension
    var copy = 1
    while true {
      let candidateName = ext.isEmpty ? "\(stem)（\(copy)）" : "\(stem)（\(copy)）.\(ext)"
      let candidate = directory.appendingPathComponent(candidateName, isDirectory: false)
      if !FileManager.default.fileExists(atPath: candidate.path) { return candidate }
      copy += 1
    }
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
    guard !data.isEmpty else {
      result(FlutterError(code: "empty_file", message: "Cannot save an empty file.", details: nil))
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
      let target = collisionSafeFileURL(directory: directory, fileName: fileName)
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
