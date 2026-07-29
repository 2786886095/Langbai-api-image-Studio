import Cocoa
import FlutterMacOS
import WebKit

class MainFlutterWindow: NSWindow {
  private let downloadsChannelName = "com.aigen.ai_image_generator/downloads"
  private let geminiSessionsChannelName = "com.aigen.ai_image_generator/gemini_sessions"
  private var downloadsChannel: FlutterMethodChannel?
  private var geminiSessionsChannel: FlutterMethodChannel?

  override func awakeFromNib() {
    let flutterViewController = FlutterViewController()
    let windowFrame = self.frame
    self.contentViewController = flutterViewController
    self.setFrame(windowFrame, display: true)

    RegisterGeneratedPlugins(registry: flutterViewController)

    let bridgeRegistrar = flutterViewController.registrar(forPlugin: "AiGenDownloads")
    let channel = FlutterMethodChannel(
      name: downloadsChannelName,
      binaryMessenger: bridgeRegistrar.messenger
    )
    channel.setMethodCallHandler { [weak self] call, result in
      guard let self = self else {
        result(FlutterError(code: "unavailable", message: "The app window is unavailable.", details: nil))
        return
      }
      self.handleDownloadCall(call, result: result)
    }
    downloadsChannel = channel

    let geminiChannel = FlutterMethodChannel(
      name: geminiSessionsChannelName,
      binaryMessenger: bridgeRegistrar.messenger
    )
    geminiChannel.setMethodCallHandler { [weak self] call, result in
      self?.handleGeminiSessionCall(call, result: result)
    }
    geminiSessionsChannel = geminiChannel

    super.awakeFromNib()
  }

  private func handleGeminiSessionCall(
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

  private func handleDownloadCall(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    let arguments = call.arguments as? [String: Any] ?? [:]
    switch call.method {
    case "chooseDirectory":
      chooseDirectory(kind: normalizedKind(arguments["kind"] as? String), result: result)
    case "getSavedDirectories":
      result(savedDirectories())
    case "saveFile":
      saveFile(arguments: arguments, result: result)
    case "openExternalUrl":
      openExternalUrl(arguments["url"] as? String ?? "", result: result)
    case "downloadUpdate":
      result(FlutterError(
        code: "unsupported",
        message: "macOS updates are handled by the Flutter network layer.",
        details: nil
      ))
    default:
      result(FlutterMethodNotImplemented)
    }
  }

  private func normalizedKind(_ value: String?) -> String {
    return value == "zips" ? "zips" : "images"
  }

  private func bookmarkKey(_ kind: String) -> String {
    return "download_directory_\(kind)"
  }

  private func chooseDirectory(kind: String, result: @escaping FlutterResult) {
    let panel = NSOpenPanel()
    panel.canChooseFiles = false
    panel.canChooseDirectories = true
    panel.allowsMultipleSelection = false
    panel.canCreateDirectories = true
    panel.prompt = "Choose Folder"
    if let current = try? resolveDirectory(kind) {
      panel.directoryURL = current
    }
    panel.beginSheetModal(for: self) { [weak self] response in
      guard let self = self else {
        result(FlutterError(code: "unavailable", message: "The app window is unavailable.", details: nil))
        return
      }
      guard response == .OK, let url = panel.url else {
        result(FlutterError(code: "cancelled", message: "Directory selection cancelled.", details: nil))
        return
      }
      do {
        let bookmark = try url.bookmarkData(
          options: .withSecurityScope,
          includingResourceValuesForKeys: nil,
          relativeTo: nil
        )
        UserDefaults.standard.set(bookmark, forKey: self.bookmarkKey(kind))
        result(url.path)
      } catch {
        result(FlutterError(code: "bookmark_failed", message: error.localizedDescription, details: nil))
      }
    }
  }

  private func resolveDirectory(_ kind: String) throws -> URL {
    guard let bookmark = UserDefaults.standard.data(forKey: bookmarkKey(kind)) else {
      throw NSError(domain: downloadsChannelName, code: 1, userInfo: [
        NSLocalizedDescriptionKey: "No \(kind) download directory selected."
      ])
    }
    var stale = false
    let url = try URL(
      resolvingBookmarkData: bookmark,
      options: .withSecurityScope,
      relativeTo: nil,
      bookmarkDataIsStale: &stale
    )
    if stale {
      let refreshed = try url.bookmarkData(
        options: .withSecurityScope,
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
      directories[kind] = (try? resolveDirectory(kind).path) ?? ""
    }
    return directories
  }

  private func sanitizeFileName(_ value: String, fallback: String) -> String {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    let source = trimmed.isEmpty ? fallback : trimmed
    let invalid = CharacterSet(charactersIn: "\\/:*?\"<>|")
    return String(source.components(separatedBy: invalid).joined(separator: "_").prefix(180))
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
    let kind = normalizedKind(arguments["kind"] as? String)
    let fileName = sanitizeFileName(
      arguments["fileName"] as? String ?? "download.bin",
      fallback: "download.bin"
    )
    let folder = sanitizeFileName(arguments["folder"] as? String ?? "", fallback: "")
    guard let data = Data(base64Encoded: arguments["base64"] as? String ?? "") else {
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
        try FileManager.default.createDirectory(
          at: directory,
          withIntermediateDirectories: true,
          attributes: nil
        )
      }
      let target = collisionSafeFileURL(directory: directory, fileName: fileName)
      try data.write(to: target, options: .atomic)
      result(target.path)
    } catch {
      result(FlutterError(code: "save_failed", message: error.localizedDescription, details: nil))
    }
  }

  private func openExternalUrl(_ value: String, result: @escaping FlutterResult) {
    guard let url = URL(string: value), url.scheme == "http" || url.scheme == "https" else {
      result(FlutterError(code: "invalid_url", message: "Only http/https URLs can be opened.", details: nil))
      return
    }
    result(NSWorkspace.shared.open(url))
  }
}
