#include "webview_bridge.h"

#include <flutter/event_stream_handler_functions.h>
#include <flutter/method_result_functions.h>

#include <format>
#include <map>

#include "texture_bridge_gpu.h"

namespace {
constexpr auto kErrorInvalidArgs = "invalidArguments";

constexpr auto kMethodLoadUrl = "loadUrl";
constexpr auto kMethodLoadStringContent = "loadStringContent";
constexpr auto kMethodReload = "reload";
constexpr auto kMethodStop = "stop";
constexpr auto kMethodGoBack = "goBack";
constexpr auto kMethodGoForward = "goForward";
constexpr auto kMethodAddScriptToExecuteOnDocumentCreated =
    "addScriptToExecuteOnDocumentCreated";
constexpr auto kMethodRemoveScriptToExecuteOnDocumentCreated =
    "removeScriptToExecuteOnDocumentCreated";
constexpr auto kMethodExecuteScript = "executeScript";
constexpr auto kMethodPostWebMessage = "postWebMessage";
constexpr auto kMethodSetSize = "setSize";
constexpr auto kMethodSetCursorPos = "setCursorPos";
constexpr auto kMethodSetPointerUpdate = "setPointerUpdate";
constexpr auto kMethodSetPointerButton = "setPointerButton";
constexpr auto kMethodSetScrollDelta = "setScrollDelta";
constexpr auto kMethodSetUserAgent = "setUserAgent";
constexpr auto kMethodSetBackgroundColor = "setBackgroundColor";
constexpr auto kMethodSetZoomFactor = "setZoomFactor";
constexpr auto kMethodOpenDevTools = "openDevTools";
constexpr auto kMethodSuspend = "suspend";
constexpr auto kMethodResume = "resume";
constexpr auto kMethodSetMemoryUsageTargetLevel = "setMemoryUsageTargetLevel";
constexpr auto kMethodSetVirtualHostNameMapping = "setVirtualHostNameMapping";
constexpr auto kMethodClearVirtualHostNameMapping =
    "clearVirtualHostNameMapping";
constexpr auto kMethodClearCookies = "clearCookies";
constexpr auto kMethodClearCache = "clearCache";
constexpr auto kMethodSetCacheDisabled = "setCacheDisabled";
constexpr auto kMethodSetFpsLimit = "setFpsLimit";
constexpr auto kMethodSetMuted = "setMuted";
constexpr auto kMethodSetDevToolsEnabled = "setDevToolsEnabled";
constexpr auto kMethodSetTrackingPreventionLevel = "setTrackingPreventionLevel";
constexpr auto kMethodSetTransparencyHitTestingEnabled =
    "setTransparencyHitTestingEnabled";
constexpr auto kMethodSetExtraHeaders = "setExtraHeaders";
constexpr auto kMethodSetDomainExtraHeaders = "setDomainExtraHeaders";
constexpr auto kMethodSetScriptEnabled = "setScriptEnabled";
constexpr auto kMethodSetScriptDialogsEnabled = "setScriptDialogsEnabled";
constexpr auto kMethodSetBuiltInErrorPageEnabled = "setBuiltInErrorPageEnabled";
constexpr auto kMethodSetZoomControlEnabled = "setZoomControlEnabled";
constexpr auto kMethodSetBrowserAcceleratorKeysEnabled =
    "setBrowserAcceleratorKeysEnabled";
constexpr auto kMethodSetGeneralAutofillEnabled = "setGeneralAutofillEnabled";
constexpr auto kMethodSetPasswordAutosaveEnabled = "setPasswordAutosaveEnabled";
constexpr auto kMethodSetPinchZoomEnabled = "setPinchZoomEnabled";
constexpr auto kMethodSetSwipeNavigationEnabled = "setSwipeNavigationEnabled";
constexpr auto kMethodSetReputationCheckingEnabled =
    "setReputationCheckingEnabled";
constexpr auto kMethodCallDevToolsProtocolMethod = "callDevToolsProtocolMethod";

constexpr auto kEventType = "type";
constexpr auto kEventValue = "value";

constexpr auto kErrorNotSupported = "not_supported";
constexpr auto kScriptFailed = "script_failed";
constexpr auto kMethodFailed = "method_failed";

static const std::optional<std::pair<double, double>> GetPointFromArgs(
    const flutter::EncodableValue* args) {
  const flutter::EncodableList* list =
      std::get_if<flutter::EncodableList>(args);
  if (!list || list->size() != 2) {
    return std::nullopt;
  }
  const auto x = std::get_if<double>(&(*list)[0]);
  const auto y = std::get_if<double>(&(*list)[1]);
  if (!x || !y) {
    return std::nullopt;
  }
  return std::make_pair(*x, *y);
}

static const std::optional<std::tuple<double, double, double>>
GetPointAndScaleFactorFromArgs(const flutter::EncodableValue* args) {
  const flutter::EncodableList* list =
      std::get_if<flutter::EncodableList>(args);
  if (!list || list->size() != 3) {
    return std::nullopt;
  }
  const auto x = std::get_if<double>(&(*list)[0]);
  const auto y = std::get_if<double>(&(*list)[1]);
  const auto z = std::get_if<double>(&(*list)[2]);
  if (!x || !y || !z) {
    return std::nullopt;
  }
  return std::make_tuple(*x, *y, *z);
}

static const std::string& GetCursorName(const HCURSOR cursor) {
  // The cursor names correspond to the Flutter Engine names:
  // in shell/platform/windows/flutter_window_win32.cc
  static const std::string kDefaultCursorName = "basic";
  static const std::pair<std::string, const wchar_t*> mappings[] = {
      {"allScroll", IDC_SIZEALL},
      {kDefaultCursorName, IDC_ARROW},
      {"click", IDC_HAND},
      {"forbidden", IDC_NO},
      {"help", IDC_HELP},
      {"move", IDC_SIZEALL},
      {"none", nullptr},
      {"noDrop", IDC_NO},
      {"precise", IDC_CROSS},
      {"progress", IDC_APPSTARTING},
      {"text", IDC_IBEAM},
      {"resizeColumn", IDC_SIZEWE},
      {"resizeDown", IDC_SIZENS},
      {"resizeDownLeft", IDC_SIZENESW},
      {"resizeDownRight", IDC_SIZENWSE},
      {"resizeLeft", IDC_SIZEWE},
      {"resizeLeftRight", IDC_SIZEWE},
      {"resizeRight", IDC_SIZEWE},
      {"resizeRow", IDC_SIZENS},
      {"resizeUp", IDC_SIZENS},
      {"resizeUpDown", IDC_SIZENS},
      {"resizeUpLeft", IDC_SIZENWSE},
      {"resizeUpRight", IDC_SIZENESW},
      {"resizeUpLeftDownRight", IDC_SIZENWSE},
      {"resizeUpRightDownLeft", IDC_SIZENESW},
      {"wait", IDC_WAIT},
  };

  static std::map<HCURSOR, std::string> cursors;
  static bool initialized = false;

  if (!initialized) {
    initialized = true;
    for (const auto& pair : mappings) {
      HCURSOR cursor_handle = LoadCursor(nullptr, pair.second);
      if (cursor_handle) {
        cursors[cursor_handle] = pair.first;
      }
    }
  }

  const auto it = cursors.find(cursor);
  if (it != cursors.end()) {
    return it->second;
  }
  return kDefaultCursorName;
}

}  // namespace

WebviewBridge::WebviewBridge(flutter::BinaryMessenger* messenger,
                             flutter::TextureRegistrar* texture_registrar,
                             GraphicsContext* graphics_context,
                             std::unique_ptr<Webview> webview)
    : webview_(std::move(webview)), texture_registrar_(texture_registrar) {
  texture_bridge_ =
      std::make_unique<TextureBridgeGpu>(graphics_context, webview_->surface());

  flutter_texture_ =
      std::make_unique<flutter::TextureVariant>(flutter::GpuSurfaceTexture(
          kFlutterDesktopGpuSurfaceTypeDxgiSharedHandle,
          [bridge = static_cast<TextureBridgeGpu*>(texture_bridge_.get())](
              size_t width,
              size_t height) -> const FlutterDesktopGpuSurfaceDescriptor* {
            return bridge->GetSurfaceDescriptor(width, height);
          }));

  texture_id_ = texture_registrar->RegisterTexture(flutter_texture_.get());
  // Capture texture_registrar_ and texture_id_ by value so this callback does
  // not depend on WebviewBridge staying alive. The callback may fire from the
  // capture thread slightly after ~WebviewBridge begins, so it must not touch
  // any member via `this`.
  texture_bridge_->SetOnFrameAvailable(
      [registrar = texture_registrar_, id = texture_id_]() {
        registrar->MarkTextureFrameAvailable(id);
      });

  const auto method_channel_name =
      std::format("io.jns.webview.win/{}", texture_id_);
  method_channel_ =
      std::make_unique<flutter::MethodChannel<flutter::EncodableValue>>(
          messenger, method_channel_name,
          &flutter::StandardMethodCodec::GetInstance());
  method_channel_->SetMethodCallHandler([this](const auto& call, auto result) {
    HandleMethodCall(call, std::move(result));
  });

  const auto event_channel_name =
      std::format("io.jns.webview.win/{}/events", texture_id_);
  event_channel_ =
      std::make_unique<flutter::EventChannel<flutter::EncodableValue>>(
          messenger, event_channel_name,
          &flutter::StandardMethodCodec::GetInstance());

  auto handler = std::make_unique<
      flutter::StreamHandlerFunctions<flutter::EncodableValue>>(
      [this](const flutter::EncodableValue* arguments,
             std::unique_ptr<flutter::EventSink<flutter::EncodableValue>>&&
                 events) {
        event_sink_ = std::move(events);
        RegisterEventHandlers();
        return nullptr;
      },
      [this](const flutter::EncodableValue* arguments) {
        event_sink_ = nullptr;
        return nullptr;
      });

  event_channel_->SetStreamHandler(std::move(handler));
}

WebviewBridge::~WebviewBridge() {
  // Stop the capture pipeline first so no new frames can arrive and call
  // MarkTextureFrameAvailable while we are dismantling the bridge.
  if (texture_bridge_) {
    texture_bridge_->Stop();
    // Drop the apartment-affine capture item on this (UI) thread. Deferring
    // to the async UnregisterTexture callback below would release it on an
    // engine worker thread and deadlock during shutdown.
    texture_bridge_->ReleaseCaptureItem();
  }

  // Destroy the webview itself. This kills the underlying WebView2 browser
  // process and its Visual, so no new FrameArrived events will be dispatched
  // by the capture source after this returns.
  webview_.reset();

  // Tear down the method/event channels synchronously. These are only ever
  // touched on the platform thread, so it is safe to free them here.
  method_channel_.reset();
  event_channel_.reset();
  event_sink_.reset();

  // Unregister the texture asynchronously and keep flutter_texture_ and
  // texture_bridge_ alive until Flutter confirms the raster thread has
  // released its reference to the ObtainDescriptor callback. Without this,
  // the raster thread could call into a freed TextureBridgeGpu.
  std::shared_ptr<flutter::TextureVariant> tex(std::move(flutter_texture_));
  std::shared_ptr<TextureBridge> bridge(std::move(texture_bridge_));

  texture_registrar_->UnregisterTexture(
      texture_id_, [tex = std::move(tex), bridge = std::move(bridge)]() {
        // tex and bridge are freed here, after Flutter has guaranteed the
        // raster thread will no longer invoke the descriptor callback.
      });
}

void WebviewBridge::RegisterEventHandlers() {
  webview_->OnUrlChanged([this](const std::string& url) {
    const auto event = flutter::EncodableValue(flutter::EncodableMap{
        {flutter::EncodableValue(kEventType),
         flutter::EncodableValue("urlChanged")},
        {flutter::EncodableValue(kEventValue), flutter::EncodableValue(url)},
    });
    EmitEvent(event);
  });

  webview_->OnLoadError([this](COREWEBVIEW2_WEB_ERROR_STATUS web_status) {
    const auto event = flutter::EncodableValue(flutter::EncodableMap{
        {flutter::EncodableValue(kEventType),
         flutter::EncodableValue("onLoadError")},
        {flutter::EncodableValue(kEventValue),
         flutter::EncodableValue(static_cast<int>(web_status))},
    });
    EmitEvent(event);
  });

  webview_->OnLoadingStateChanged([this](WebviewLoadingState state) {
    const auto event = flutter::EncodableValue(flutter::EncodableMap{
        {flutter::EncodableValue(kEventType),
         flutter::EncodableValue("loadingStateChanged")},
        {flutter::EncodableValue(kEventValue),
         flutter::EncodableValue(static_cast<int>(state))},
    });
    EmitEvent(event);
  });

  webview_->OnDownloadEvent([this](WebviewDownloadEvent webviewDownloadEvent) {
    const auto event = flutter::EncodableValue(flutter::EncodableMap{
        {flutter::EncodableValue(kEventType),
         flutter::EncodableValue("downloadEvent")},
        {flutter::EncodableValue(kEventValue),
         flutter::EncodableValue(flutter::EncodableMap{
             {flutter::EncodableValue("kind"),
              flutter::EncodableValue(
                  static_cast<int>(webviewDownloadEvent.kind))},
             {flutter::EncodableValue("url"),
              flutter::EncodableValue(webviewDownloadEvent.url)},
             {flutter::EncodableValue("resultFilePath"),
              flutter::EncodableValue(webviewDownloadEvent.resultFilePath)},
             {flutter::EncodableValue("bytesReceived"),
              flutter::EncodableValue(webviewDownloadEvent.bytesReceived)},
             {flutter::EncodableValue("totalBytesToReceive"),
              flutter::EncodableValue(
                  webviewDownloadEvent.totalBytesToReceive)},
         })}});
    EmitEvent(event);
  });

  webview_->OnHistoryChanged([this](WebviewHistoryChanged historyChanged) {
    const auto event = flutter::EncodableValue(flutter::EncodableMap{
        {flutter::EncodableValue(kEventType),
         flutter::EncodableValue("historyChanged")},
        {flutter::EncodableValue(kEventValue),
         flutter::EncodableValue(flutter::EncodableMap{
             {flutter::EncodableValue("canGoBack"),
              flutter::EncodableValue(
                  static_cast<bool>(historyChanged.can_go_back))},
             {flutter::EncodableValue("canGoForward"),
              flutter::EncodableValue(
                  static_cast<bool>(historyChanged.can_go_forward))},
         })},
    });
    EmitEvent(event);
  });

  webview_->OnDevtoolsProtocolEvent([this](const std::string& json) {
    const auto event = flutter::EncodableValue(flutter::EncodableMap{
        {flutter::EncodableValue(kEventType),
         flutter::EncodableValue("securityStateChanged")},
        {flutter::EncodableValue(kEventValue), flutter::EncodableValue(json)}});
    EmitEvent(event);
  });

  webview_->OnDocumentTitleChanged([this](const std::string& title) {
    const auto event = flutter::EncodableValue(flutter::EncodableMap{
        {flutter::EncodableValue(kEventType),
         flutter::EncodableValue("titleChanged")},
        {flutter::EncodableValue(kEventValue), flutter::EncodableValue(title)},
    });
    EmitEvent(event);
  });

  webview_->OnSurfaceSizeChanged([this](size_t width, size_t height) {
    texture_bridge_->NotifySurfaceSizeChanged();

    const auto event = flutter::EncodableValue(flutter::EncodableMap{
        {flutter::EncodableValue(kEventType),
         flutter::EncodableValue("sizeChanged")},
        {flutter::EncodableValue(kEventValue),
         flutter::EncodableValue(flutter::EncodableMap{
             {flutter::EncodableValue("width"),
              flutter::EncodableValue(static_cast<double>(width))},
             {flutter::EncodableValue("height"),
              flutter::EncodableValue(static_cast<double>(height))},
         })},
    });

    EmitEvent(event);
  });

  webview_->OnCursorChanged([this](const HCURSOR cursor) {
    const auto& name = GetCursorName(cursor);
    const auto event = flutter::EncodableValue(
        flutter::EncodableMap{{flutter::EncodableValue(kEventType),
                               flutter::EncodableValue("cursorChanged")},
                              {flutter::EncodableValue(kEventValue), name}});
    EmitEvent(event);
  });

  webview_->OnWebMessageReceived([this](const std::string& message) {
    const auto event = flutter::EncodableValue(
        flutter::EncodableMap{{flutter::EncodableValue(kEventType),
                               flutter::EncodableValue("webMessageReceived")},
                              {flutter::EncodableValue(kEventValue), message}});
    EmitEvent(event);
  });

  webview_->OnPermissionRequested(
      [this](const std::string& url, WebviewPermissionKind kind,
             bool is_user_initiated,
             Webview::WebviewPermissionRequestedCompleter completer) {
        OnPermissionRequested(url, kind, is_user_initiated, completer);
      });

  webview_->OnNavigationStarting(
      [this](const std::string& url, bool is_user_initiated, bool is_redirected,
             Webview::NavigationStartingCompleter completer) {
        OnNavigationStarting(url, is_user_initiated, is_redirected, completer);
      });

  webview_->OnNewWindowRequested(
      [this](const std::string& url, bool is_user_initiated,
             Webview::NewWindowRequestedCompleter completer) {
        OnNewWindowRequested(url, is_user_initiated, completer);
      });

  webview_->OnContainsFullScreenElementChanged(
      [this](bool contains_fullscreen_element) {
        const auto event = flutter::EncodableValue(flutter::EncodableMap{
            {flutter::EncodableValue(kEventType),
             flutter::EncodableValue("containsFullScreenElementChanged")},
            {flutter::EncodableValue(kEventValue),
             contains_fullscreen_element}});
        EmitEvent(event);
      });

  webview_->OnProcessFailed([this](int kind, int reason) {
    const auto event = flutter::EncodableValue(flutter::EncodableMap{
        {flutter::EncodableValue(kEventType),
         flutter::EncodableValue("processFailed")},
        {flutter::EncodableValue(kEventValue),
         flutter::EncodableValue(flutter::EncodableMap{
             {flutter::EncodableValue("kind"), flutter::EncodableValue(kind)},
             {flutter::EncodableValue("reason"),
              flutter::EncodableValue(reason)},
         })}});
    EmitEvent(event);
  });
}

void WebviewBridge::OnPermissionRequested(
    const std::string& url, WebviewPermissionKind permissionKind,
    bool isUserInitiated,
    Webview::WebviewPermissionRequestedCompleter completer) {
  auto args = std::make_unique<flutter::EncodableValue>(flutter::EncodableMap{
      {"url", url},
      {"isUserInitiated", isUserInitiated},
      {"permissionKind", static_cast<int>(permissionKind)}});

  method_channel_->InvokeMethod(
      "permissionRequested", std::move(args),
      std::make_unique<flutter::MethodResultFunctions<flutter::EncodableValue>>(
          [completer](const flutter::EncodableValue* result) {
            auto allow = std::get_if<bool>(result);
            if (allow != nullptr) {
              return completer(*allow ? WebviewPermissionState::Allow
                                      : WebviewPermissionState::Deny);
            }
            completer(WebviewPermissionState::Default);
          },
          [completer](const std::string& error_code,
                      const std::string& error_message,
                      const flutter::EncodableValue* error_details) {
            completer(WebviewPermissionState::Default);
          },
          [completer]() { completer(WebviewPermissionState::Default); }));
}

void WebviewBridge::OnNavigationStarting(
    const std::string& url, bool isUserInitiated, bool isRedirected,
    Webview::NavigationStartingCompleter completer) {
  auto args = std::make_unique<flutter::EncodableValue>(
      flutter::EncodableMap{{"url", url},
                            {"isUserInitiated", isUserInitiated},
                            {"isRedirected", isRedirected}});

  method_channel_->InvokeMethod(
      "navigationStarting", std::move(args),
      std::make_unique<flutter::MethodResultFunctions<flutter::EncodableValue>>(
          [completer](const flutter::EncodableValue* result) {
            auto allow = std::get_if<bool>(result);
            if (allow != nullptr) {
              completer(*allow);
              return;
            }
            completer(false);
          },
          [completer](const std::string& error_code,
                      const std::string& error_message,
                      const flutter::EncodableValue* error_details) {
            completer(false);
          },
          [completer]() { completer(false); }));
}

void WebviewBridge::OnNewWindowRequested(
    const std::string& url, bool isUserInitiated,
    Webview::NewWindowRequestedCompleter completer) {
  auto args = std::make_unique<flutter::EncodableValue>(flutter::EncodableMap{
      {"url", url}, {"isUserInitiated", isUserInitiated}});

  method_channel_->InvokeMethod(
      "newWindowRequested", std::move(args),
      std::make_unique<flutter::MethodResultFunctions<flutter::EncodableValue>>(
          [completer](const flutter::EncodableValue* result) {
            auto decision = std::get_if<int32_t>(result);
            if (decision != nullptr) {
              completer(static_cast<NewWindowDecision>(*decision));
              return;
            }
            completer(NewWindowDecision::Allow);
          },
          [completer](const std::string& error_code,
                      const std::string& error_message,
                      const flutter::EncodableValue* error_details) {
            completer(NewWindowDecision::Allow);
          },
          [completer]() { completer(NewWindowDecision::Allow); }));
}

void WebviewBridge::CheckTransparencyAtCursor(double x, double y) {
  auto scale_factor = webview_->scale_factor();
  int px = static_cast<int>(x * scale_factor);
  int py = static_cast<int>(y * scale_factor);

  auto alpha =
      static_cast<TextureBridgeGpu*>(texture_bridge_.get())->ReadAlpha(px, py);
  bool is_opaque = alpha > hit_test_alpha_threshold_;

  if (!last_hit_test_opaque_.has_value() ||
      is_opaque != last_hit_test_opaque_.value()) {
    last_hit_test_opaque_ = is_opaque;

    const auto event = flutter::EncodableValue(flutter::EncodableMap{
        {flutter::EncodableValue(kEventType),
         flutter::EncodableValue("pointerTransparencyChanged")},
        {flutter::EncodableValue(kEventValue),
         flutter::EncodableValue(is_opaque)},
    });
    EmitEvent(event);
  }
}

void WebviewBridge::HandleMethodCall(
    const flutter::MethodCall<flutter::EncodableValue>& method_call,
    std::unique_ptr<flutter::MethodResult<flutter::EncodableValue>> result) {
  const auto& method_name = method_call.method_name();

  // setCursorPos: [double x, double y]
  if (method_name.compare(kMethodSetCursorPos) == 0) {
    const auto point = GetPointFromArgs(method_call.arguments());
    if (point) {
      webview_->SetCursorPos(point->first, point->second);

      if (transparency_hit_testing_enabled_) {
        CheckTransparencyAtCursor(point->first, point->second);
      }

      return result->Success();
    }
    return result->Error(kErrorInvalidArgs);
  }

  // setPointerUpdate:
  // [int pointer, int event, double x, double y, double size, double pressure]
  if (method_name.compare(kMethodSetPointerUpdate) == 0) {
    const flutter::EncodableList* list =
        std::get_if<flutter::EncodableList>(method_call.arguments());
    if (!list || list->size() != 6) {
      return result->Error(kErrorInvalidArgs);
    }

    const auto pointer = std::get_if<int32_t>(&(*list)[0]);
    const auto event = std::get_if<int32_t>(&(*list)[1]);
    const auto x = std::get_if<double>(&(*list)[2]);
    const auto y = std::get_if<double>(&(*list)[3]);
    const auto size = std::get_if<double>(&(*list)[4]);
    const auto pressure = std::get_if<double>(&(*list)[5]);

    if (pointer && event && x && y && size && pressure) {
      webview_->SetPointerUpdate(*pointer,
                                 static_cast<WebviewPointerEventKind>(*event),
                                 *x, *y, *size, *pressure);
      return result->Success();
    }
    return result->Error(kErrorInvalidArgs);
  }

  // setScrollDelta: [double dx, double dy]
  if (method_name.compare(kMethodSetScrollDelta) == 0) {
    const auto delta = GetPointFromArgs(method_call.arguments());
    if (delta) {
      webview_->SetScrollDelta(delta->first, delta->second);
      return result->Success();
    }
    return result->Error(kErrorInvalidArgs);
  }

  // setPointerButton: {"button": int, "isDown": bool}
  if (method_name.compare(kMethodSetPointerButton) == 0) {
    const auto& map = std::get<flutter::EncodableMap>(*method_call.arguments());

    const auto button = map.find(flutter::EncodableValue("button"));
    const auto isDown = map.find(flutter::EncodableValue("isDown"));
    if (button != map.end() && isDown != map.end()) {
      const auto buttonValue = std::get_if<int32_t>(&button->second);
      const auto isDownValue = std::get_if<bool>(&isDown->second);
      if (buttonValue && isDownValue) {
        webview_->SetPointerButtonState(
            static_cast<WebviewPointerButton>(*buttonValue), *isDownValue);
        return result->Success();
      }
    }
    return result->Error(kErrorInvalidArgs);
  }

  // setSize: [double width, double height, double scale_factor]
  if (method_name.compare(kMethodSetSize) == 0) {
    auto size = GetPointAndScaleFactorFromArgs(method_call.arguments());
    if (size) {
      const auto [width, height, scale_factor] = size.value();

      webview_->SetSurfaceSize(static_cast<size_t>(width),
                               static_cast<size_t>(height),
                               static_cast<float>(scale_factor));

      if (auto* gpu_bridge =
              static_cast<TextureBridgeGpu*>(texture_bridge_.get())) {
        gpu_bridge->SetOutputScale(static_cast<float>(scale_factor));
      }

      texture_bridge_->Start();

      // Immediately notify the Flutter engine that the texture has changed.
      // While no frame has been captured yet, this triggers the engine to call
      // the `GetSurfaceDescriptor` callback which leads to the texture being
      // resized immediately instead of it being delayed until after the first
      // frame at the new size is captured.
      texture_registrar_->MarkTextureFrameAvailable(texture_id_);

      return result->Success();
    }
    return result->Error(kErrorInvalidArgs);
  }

  // loadUrl: map with "url" (string) and optional "headers"
  // (map<string,string>)
  if (method_name.compare(kMethodLoadUrl) == 0) {
    if (const auto args =
            std::get_if<flutter::EncodableMap>(method_call.arguments())) {
      auto url_it = args->find(flutter::EncodableValue("url"));
      if (url_it == args->end()) {
        return result->Error(kErrorInvalidArgs);
      }
      const auto& url = std::get<std::string>(url_it->second);

      std::map<std::string, std::string> headers;
      auto headers_it = args->find(flutter::EncodableValue("headers"));
      if (headers_it != args->end()) {
        const auto& hmap = std::get<flutter::EncodableMap>(headers_it->second);
        for (const auto& [k, v] : hmap) {
          headers[std::get<std::string>(k)] = std::get<std::string>(v);
        }
      }

      webview_->LoadUrl(url, headers);
      return result->Success();
    }
    return result->Error(kErrorInvalidArgs);
  }

  // loadStringContent: string
  if (method_name.compare(kMethodLoadStringContent) == 0) {
    if (const auto content =
            std::get_if<std::string>(method_call.arguments())) {
      webview_->LoadStringContent(*content);
      return result->Success();
    }
    return result->Error(kErrorInvalidArgs);
  }

  // reload
  if (method_name.compare(kMethodReload) == 0) {
    if (webview_->Reload()) {
      return result->Success();
    }
    return result->Error(kMethodFailed);
  }

  // stop
  if (method_name.compare(kMethodStop) == 0) {
    if (webview_->Stop()) {
      return result->Success();
    }
    return result->Error(kMethodFailed);
  }

  // goBack
  if (method_name.compare(kMethodGoBack) == 0) {
    if (webview_->GoBack()) {
      return result->Success();
    }
    return result->Error(kMethodFailed);
  }

  // goForward
  if (method_name.compare(kMethodGoForward) == 0) {
    if (webview_->GoForward()) {
      return result->Success();
    }
    return result->Error(kMethodFailed);
  }

  // suspend
  if (method_name.compare(kMethodSuspend) == 0) {
    texture_bridge_->Stop();
    webview_->Suspend();
    return result->Success();
  }

  // resume
  if (method_name.compare(kMethodResume) == 0) {
    webview_->Resume();
    texture_bridge_->Start();
    return result->Success();
  }

  // setMemoryUsageTargetLevel: int (0 = normal, 1 = low)
  if (method_name.compare(kMethodSetMemoryUsageTargetLevel) == 0) {
    if (const auto* level = std::get_if<int32_t>(method_call.arguments())) {
      if (webview_->SetMemoryUsageTargetLevel(*level)) {
        return result->Success();
      }
      return result->Error("memory_target_level_failed",
                           "Failed to set memory usage target level");
    }
    return result->Error("invalid_argument", "Expected an int argument");
  }

  // setVirtualHostNameMapping [string hostName, string path, int accessKind]
  if (method_name.compare(kMethodSetVirtualHostNameMapping) == 0) {
    const flutter::EncodableList* list =
        std::get_if<flutter::EncodableList>(method_call.arguments());
    if (!list || list->size() != 3) {
      return result->Error(kErrorInvalidArgs);
    }

    const auto hostName = std::get_if<std::string>(&(*list)[0]);
    const auto path = std::get_if<std::string>(&(*list)[1]);
    const auto accessKind = std::get_if<int32_t>(&(*list)[2]);

    if (hostName && path && accessKind) {
      webview_->SetVirtualHostNameMapping(
          *hostName, *path,
          static_cast<WebviewHostResourceAccessKind>(*accessKind));
      return result->Success();
    }
    return result->Error(kErrorInvalidArgs);
  }

  // clearVirtualHostNameMapping: string
  if (method_name.compare(kMethodClearVirtualHostNameMapping) == 0) {
    if (const auto hostName =
            std::get_if<std::string>(method_call.arguments())) {
      if (webview_->ClearVirtualHostNameMapping(*hostName)) {
        return result->Success();
      }
    }
    return result->Error(kErrorInvalidArgs);
  }

  if (method_name.compare(kMethodAddScriptToExecuteOnDocumentCreated) == 0) {
    if (const auto script = std::get_if<std::string>(method_call.arguments())) {
      std::shared_ptr<flutter::MethodResult<flutter::EncodableValue>>
          shared_result = std::move(result);

      webview_->AddScriptToExecuteOnDocumentCreated(
          *script, [shared_result](bool success, const std::string& script_id) {
            if (success) {
              shared_result->Success(script_id);
            } else {
              shared_result->Error(kScriptFailed, "Executing script failed.");
            }
          });
      return;
    }
    return result->Error(kErrorInvalidArgs);
  }

  if (method_name.compare(kMethodRemoveScriptToExecuteOnDocumentCreated) == 0) {
    if (const auto script_id =
            std::get_if<std::string>(method_call.arguments())) {
      std::shared_ptr<flutter::MethodResult<flutter::EncodableValue>>
          shared_result = std::move(result);

      webview_->RemoveScriptToExecuteOnDocumentCreated(*script_id);
      shared_result->Success();
      return;
    }
    return result->Error(kErrorInvalidArgs);
  }

  // executeScript: string
  if (method_name.compare(kMethodExecuteScript) == 0) {
    if (const auto script = std::get_if<std::string>(method_call.arguments())) {
      std::shared_ptr<flutter::MethodResult<flutter::EncodableValue>>
          shared_result = std::move(result);

      webview_->ExecuteScript(
          *script,
          [shared_result](bool success, const std::string& json_result) {
            if (success) {
              shared_result->Success(json_result);
            } else {
              shared_result->Error(kScriptFailed, "Executing script failed.");
            }
          });
      return;
    }
    return result->Error(kErrorInvalidArgs);
  }

  // postWebMessage: string
  if (method_name.compare(kMethodPostWebMessage) == 0) {
    if (const auto message =
            std::get_if<std::string>(method_call.arguments())) {
      if (webview_->PostWebMessage(*message)) {
        return result->Success();
      }
      return result->Error(kErrorNotSupported, "Posting the message failed.");
    }
    return result->Error(kErrorInvalidArgs);
  }

  // setUserAgent: string
  if (method_name.compare(kMethodSetUserAgent) == 0) {
    if (const auto user_agent =
            std::get_if<std::string>(method_call.arguments())) {
      if (webview_->SetUserAgent(*user_agent)) {
        return result->Success();
      }
      return result->Error(kErrorNotSupported,
                           "Setting the user agent failed.");
    }
    return result->Error(kErrorInvalidArgs);
  }

  // setBackgroundColor: int
  if (method_name.compare(kMethodSetBackgroundColor) == 0) {
    if (const auto color = std::get_if<int32_t>(method_call.arguments())) {
      if (webview_->SetBackgroundColor(*color)) {
        return result->Success();
      }
      return result->Error(kErrorNotSupported,
                           "Setting the background color failed.");
    }
    return result->Error(kErrorInvalidArgs);
  }

  // setZoomFactor: double
  if (method_name.compare(kMethodSetZoomFactor) == 0) {
    if (const auto factor = std::get_if<double>(method_call.arguments())) {
      if (webview_->SetZoomFactor(*factor)) {
        return result->Success();
      }
      return result->Error(kErrorNotSupported,
                           "Setting the zoom factor failed.");
    }
    return result->Error(kErrorInvalidArgs);
  }

  // openDevTools
  if (method_name.compare(kMethodOpenDevTools) == 0) {
    if (webview_->OpenDevTools()) {
      return result->Success();
    }
    return result->Error(kMethodFailed);
  }

  // clearCookies
  if (method_name.compare(kMethodClearCookies) == 0) {
    if (webview_->ClearCookies()) {
      return result->Success();
    }
    return result->Error(kMethodFailed);
  }

  // clearCache
  if (method_name.compare(kMethodClearCache) == 0) {
    if (webview_->ClearCache()) {
      return result->Success();
    }
    return result->Error(kMethodFailed);
  }

  // setCacheDisabled: bool
  if (method_name.compare(kMethodSetCacheDisabled) == 0) {
    if (const auto disabled = std::get_if<bool>(method_call.arguments())) {
      if (webview_->SetCacheDisabled(*disabled)) {
        return result->Success();
      }
    }
    return result->Error(kErrorInvalidArgs);
  }

  // setFpsLimit: int
  if (method_name.compare(kMethodSetFpsLimit) == 0) {
    if (const auto value = std::get_if<int32_t>(method_call.arguments())) {
      texture_bridge_->SetFpsLimit(*value == 0 ? std::nullopt
                                               : std::make_optional(*value));
      return result->Success();
    }
  }

  // setMuted: bool
  if (method_name.compare(kMethodSetMuted) == 0) {
    if (const auto muted = std::get_if<bool>(method_call.arguments())) {
      if (webview_->SetMuted(*muted)) {
        return result->Success();
      }
      return result->Error(kMethodFailed, "Setting muted state failed.");
    }
    return result->Error(kErrorInvalidArgs);
  }

  // setDevToolsEnabled: bool
  if (method_name.compare(kMethodSetDevToolsEnabled) == 0) {
    if (const auto enabled = std::get_if<bool>(method_call.arguments())) {
      if (webview_->SetDevToolsEnabled(*enabled)) {
        return result->Success();
      }

      return result->Error(kMethodFailed,
                           "Setting devtools enabled state failed.");
    }

    return result->Error(kErrorInvalidArgs);
  }

  // setTrackingPreventionLevel: int
  if (method_name.compare(kMethodSetTrackingPreventionLevel) == 0) {
    if (const auto level = std::get_if<int32_t>(method_call.arguments())) {
      if (webview_->SetTrackingPreventionLevel(*level)) {
        return result->Success();
      }

      return result->Error(kMethodFailed,
                           "Setting tracking prevention level failed.");
    }

    return result->Error(kErrorInvalidArgs);
  }

  // setExtraHeaders: map<string, string>
  if (method_name.compare(kMethodSetExtraHeaders) == 0) {
    if (const auto args =
            std::get_if<flutter::EncodableMap>(method_call.arguments())) {
      std::map<std::string, std::string> headers;
      for (const auto& [k, v] : *args) {
        headers[std::get<std::string>(k)] = std::get<std::string>(v);
      }
      webview_->SetExtraHeaders(headers);
      return result->Success();
    }
    return result->Error(kErrorInvalidArgs);
  }

  if (method_name.compare(kMethodSetDomainExtraHeaders) == 0) {
    if (const auto args =
            std::get_if<flutter::EncodableList>(method_call.arguments())) {
      if (args->size() == 2) {
        const auto* domain = std::get_if<std::string>(&(*args)[0]);
        const auto* header_map =
            std::get_if<flutter::EncodableMap>(&(*args)[1]);
        if (domain && header_map) {
          std::map<std::string, std::string> headers;
          for (const auto& [k, v] : *header_map) {
            headers[std::get<std::string>(k)] = std::get<std::string>(v);
          }
          webview_->SetDomainExtraHeaders(*domain, headers);
          return result->Success();
        }
      }
    }
    return result->Error(kErrorInvalidArgs);
  }

  // setTransparencyHitTestingEnabled: bool
  if (method_name.compare(kMethodSetTransparencyHitTestingEnabled) == 0) {
    if (const auto enabled = std::get_if<bool>(method_call.arguments())) {
      transparency_hit_testing_enabled_ = *enabled;

      if (!enabled) {
        last_hit_test_opaque_ = std::nullopt;
      }

      return result->Success();
    }
    return result->Error(kErrorInvalidArgs);
  }

  // setScriptEnabled: bool
  if (method_name.compare(kMethodSetScriptEnabled) == 0) {
    if (const auto enabled = std::get_if<bool>(method_call.arguments())) {
      if (webview_->SetScriptEnabled(*enabled)) {
        return result->Success();
      }
      return result->Error(kMethodFailed, "Setting script enabled failed.");
    }
    return result->Error(kErrorInvalidArgs);
  }

  // setScriptDialogsEnabled: bool
  if (method_name.compare(kMethodSetScriptDialogsEnabled) == 0) {
    if (const auto enabled = std::get_if<bool>(method_call.arguments())) {
      if (webview_->SetScriptDialogsEnabled(*enabled)) {
        return result->Success();
      }
      return result->Error(kMethodFailed,
                           "Setting script dialogs enabled failed.");
    }
    return result->Error(kErrorInvalidArgs);
  }

  // setBuiltInErrorPageEnabled: bool
  if (method_name.compare(kMethodSetBuiltInErrorPageEnabled) == 0) {
    if (const auto enabled = std::get_if<bool>(method_call.arguments())) {
      if (webview_->SetBuiltInErrorPageEnabled(*enabled)) {
        return result->Success();
      }
      return result->Error(kMethodFailed,
                           "Setting built-in error page enabled failed.");
    }
    return result->Error(kErrorInvalidArgs);
  }

  // setZoomControlEnabled: bool
  if (method_name.compare(kMethodSetZoomControlEnabled) == 0) {
    if (const auto enabled = std::get_if<bool>(method_call.arguments())) {
      if (webview_->SetZoomControlEnabled(*enabled)) {
        return result->Success();
      }
      return result->Error(kMethodFailed,
                           "Setting zoom control enabled failed.");
    }
    return result->Error(kErrorInvalidArgs);
  }

  // setBrowserAcceleratorKeysEnabled: bool
  if (method_name.compare(kMethodSetBrowserAcceleratorKeysEnabled) == 0) {
    if (const auto enabled = std::get_if<bool>(method_call.arguments())) {
      if (webview_->SetBrowserAcceleratorKeysEnabled(*enabled)) {
        return result->Success();
      }
      return result->Error(kMethodFailed,
                           "Setting browser accelerator keys enabled failed.");
    }
    return result->Error(kErrorInvalidArgs);
  }

  // setGeneralAutofillEnabled: bool
  if (method_name.compare(kMethodSetGeneralAutofillEnabled) == 0) {
    if (const auto enabled = std::get_if<bool>(method_call.arguments())) {
      if (webview_->SetGeneralAutofillEnabled(*enabled)) {
        return result->Success();
      }
      return result->Error(kMethodFailed,
                           "Setting general autofill enabled failed.");
    }
    return result->Error(kErrorInvalidArgs);
  }

  // setPasswordAutosaveEnabled: bool
  if (method_name.compare(kMethodSetPasswordAutosaveEnabled) == 0) {
    if (const auto enabled = std::get_if<bool>(method_call.arguments())) {
      if (webview_->SetPasswordAutosaveEnabled(*enabled)) {
        return result->Success();
      }
      return result->Error(kMethodFailed,
                           "Setting password autosave enabled failed.");
    }
    return result->Error(kErrorInvalidArgs);
  }

  // setPinchZoomEnabled: bool
  if (method_name.compare(kMethodSetPinchZoomEnabled) == 0) {
    if (const auto enabled = std::get_if<bool>(method_call.arguments())) {
      if (webview_->SetPinchZoomEnabled(*enabled)) {
        return result->Success();
      }
      return result->Error(kMethodFailed, "Setting pinch zoom enabled failed.");
    }
    return result->Error(kErrorInvalidArgs);
  }

  // setSwipeNavigationEnabled: bool
  if (method_name.compare(kMethodSetSwipeNavigationEnabled) == 0) {
    if (const auto enabled = std::get_if<bool>(method_call.arguments())) {
      if (webview_->SetSwipeNavigationEnabled(*enabled)) {
        return result->Success();
      }
      return result->Error(kMethodFailed,
                           "Setting swipe navigation enabled failed.");
    }
    return result->Error(kErrorInvalidArgs);
  }

  // setReputationCheckingEnabled: bool
  if (method_name.compare(kMethodSetReputationCheckingEnabled) == 0) {
    if (const auto enabled = std::get_if<bool>(method_call.arguments())) {
      if (webview_->SetReputationCheckingEnabled(*enabled)) {
        return result->Success();
      }
      return result->Error(kMethodFailed,
                           "Setting reputation checking enabled failed.");
    }
    return result->Error(kErrorInvalidArgs);
  }

  // callDevToolsProtocolMethod: [method, parameters]
  if (method_name.compare(kMethodCallDevToolsProtocolMethod) == 0) {
    if (const auto* list =
            std::get_if<flutter::EncodableList>(method_call.arguments())) {
      if (list->size() == 2) {
        const auto* method_str = std::get_if<std::string>(&(*list)[0]);
        const auto* params_str = std::get_if<std::string>(&(*list)[1]);
        if (method_str && params_str) {
          std::shared_ptr<flutter::MethodResult<flutter::EncodableValue>>
              shared_result = std::move(result);
          webview_->CallDevToolsProtocolMethod(
              *method_str, *params_str,
              [shared_result](bool success, const std::string& json_result) {
                if (success) {
                  shared_result->Success(flutter::EncodableValue(json_result));
                } else {
                  shared_result->Error(
                      kMethodFailed, "CDP method failed.",
                      flutter::EncodableValue(json_result.empty()
                                                  ? std::string("{}")
                                                  : json_result));
                }
              });
          return;
        }
      }
    }
    return result->Error(kErrorInvalidArgs);
  }

  result->NotImplemented();
}
