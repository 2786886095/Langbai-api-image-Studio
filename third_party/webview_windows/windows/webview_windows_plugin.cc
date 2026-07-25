#include "include/webview_windows/webview_windows_plugin.h"

#include <flutter/method_channel.h>
#include <flutter/plugin_registrar_windows.h>
#include <flutter/standard_method_codec.h>
#include <windows.h>

#include <memory>
#include <string>
#include <unordered_map>

#include "util/string_converter.h"
#include "webview_bridge.h"
#include "webview_host.h"
#include "webview_platform.h"

#pragma comment(lib, "dxgi.lib")
#pragma comment(lib, "d3d11.lib")

namespace {

constexpr auto kMethodInitialize = "initialize";
constexpr auto kMethodDispose = "dispose";
constexpr auto kMethodDisposeAll = "disposeAll";
constexpr auto kMethodCreateHost = "createHost";
constexpr auto kMethodDisposeHost = "disposeHost";
constexpr auto kMethodGetWebViewVersion = "getWebViewVersion";
constexpr auto kMethodGetProcessIds = "getProcessIds";

constexpr auto kErrorCodeInvalidId = "invalid_id";
constexpr auto kErrorCodeEnvironmentCreationFailed =
    "environment_creation_failed";
constexpr auto kErrorCodeWebviewCreationFailed = "webview_creation_failed";
constexpr auto kErrorUnsupportedPlatform = "unsupported_platform";

template <typename T>
std::optional<T> GetOptionalValue(const flutter::EncodableMap& map,
                                  const std::string& key) {
  const auto it = map.find(flutter::EncodableValue(key));
  if (it != map.end()) {
    const auto val = std::get_if<T>(&it->second);
    if (val) {
      return *val;
    }
  }
  return std::nullopt;
}

std::optional<int64_t> GetInt64Value(const flutter::EncodableMap& map,
                                     const std::string& key) {
  const auto it = map.find(flutter::EncodableValue(key));
  if (it != map.end()) {
    if (const auto* v = std::get_if<int64_t>(&it->second)) return *v;
    if (const auto* v = std::get_if<int32_t>(&it->second))
      return static_cast<int64_t>(*v);
  }
  return std::nullopt;
}

std::optional<int64_t> GetInt64Arg(const flutter::EncodableValue* val) {
  if (!val) return std::nullopt;
  if (const auto* v = std::get_if<int64_t>(val)) return *v;
  if (const auto* v = std::get_if<int32_t>(val))
    return static_cast<int64_t>(*v);
  return std::nullopt;
}

class WebviewWindowsPlugin : public flutter::Plugin {
 public:
  static void RegisterWithRegistrar(flutter::PluginRegistrarWindows* registrar);

  WebviewWindowsPlugin(flutter::TextureRegistrar* textures,
                       flutter::BinaryMessenger* messenger);

  virtual ~WebviewWindowsPlugin();

 private:
  std::unique_ptr<WebviewPlatform> platform_;
  std::unordered_map<int64_t, std::unique_ptr<WebviewHost>> hosts_;
  std::unordered_map<int64_t, std::unique_ptr<WebviewBridge>> instances_;
  std::unordered_map<int64_t, int64_t> instance_host_;
  int64_t next_host_id_ = 1;

  WNDCLASS window_class_ = {};
  flutter::TextureRegistrar* textures_;
  flutter::BinaryMessenger* messenger_;
  std::shared_ptr<bool> alive_flag_{std::make_shared<bool>(true)};

  bool InitPlatform();

  void HandleCreateHost(
      const flutter::EncodableMap& args,
      std::unique_ptr<flutter::MethodResult<flutter::EncodableValue>> result);
  void HandleDisposeHost(
      int64_t host_id,
      std::unique_ptr<flutter::MethodResult<flutter::EncodableValue>> result);
  void CreateWebviewInstance(
      int64_t host_id,
      std::unique_ptr<flutter::MethodResult<flutter::EncodableValue>> result);
  // Called when a method is called on this plugin's channel from Dart.
  void HandleMethodCall(
      const flutter::MethodCall<flutter::EncodableValue>& method_call,
      std::unique_ptr<flutter::MethodResult<flutter::EncodableValue>> result);
};

// static
void WebviewWindowsPlugin::RegisterWithRegistrar(
    flutter::PluginRegistrarWindows* registrar) {
  auto channel =
      std::make_unique<flutter::MethodChannel<flutter::EncodableValue>>(
          registrar->messenger(), "io.jns.webview.win",
          &flutter::StandardMethodCodec::GetInstance());

  auto plugin = std::make_unique<WebviewWindowsPlugin>(
      registrar->texture_registrar(), registrar->messenger());

  channel->SetMethodCallHandler(
      [plugin_pointer = plugin.get()](const auto& call, auto result) {
        plugin_pointer->HandleMethodCall(call, std::move(result));
      });

  registrar->AddPlugin(std::move(plugin));
}

WebviewWindowsPlugin::WebviewWindowsPlugin(flutter::TextureRegistrar* textures,
                                           flutter::BinaryMessenger* messenger)
    : textures_(textures), messenger_(messenger) {
  window_class_.lpszClassName = L"FlutterWebviewMessage";
  window_class_.lpfnWndProc = &DefWindowProc;
  RegisterClass(&window_class_);
}

WebviewWindowsPlugin::~WebviewWindowsPlugin() {
  instances_.clear();
  instance_host_.clear();
  hosts_.clear();
  UnregisterClass(window_class_.lpszClassName, nullptr);
}

void WebviewWindowsPlugin::HandleMethodCall(
    const flutter::MethodCall<flutter::EncodableValue>& method_call,
    std::unique_ptr<flutter::MethodResult<flutter::EncodableValue>> result) {
  if (method_call.method_name().compare(kMethodCreateHost) == 0) {
    if (!InitPlatform()) {
      return result->Error(kErrorUnsupportedPlatform,
                           "The platform is not supported");
    }
    const auto& map = std::get<flutter::EncodableMap>(*method_call.arguments());
    return HandleCreateHost(map, std::move(result));
  }

  if (method_call.method_name().compare(kMethodDisposeHost) == 0) {
    if (const auto host_id = GetInt64Arg(method_call.arguments())) {
      return HandleDisposeHost(*host_id, std::move(result));
    }
    return result->Error(kErrorCodeInvalidId, "Invalid host id");
  }

  if (method_call.method_name().compare(kMethodGetWebViewVersion) == 0) {
    LPWSTR version_info = nullptr;
    auto hr =
        GetAvailableCoreWebView2BrowserVersionString(nullptr, &version_info);
    if (SUCCEEDED(hr) && version_info != nullptr) {
      return result->Success(
          flutter::EncodableValue(util::Utf8FromUtf16(version_info)));
    } else {
      return result->Success();
    }
  }

  if (method_call.method_name().compare(kMethodGetProcessIds) == 0) {
    const auto* args_map =
        std::get_if<flutter::EncodableMap>(method_call.arguments());
    if (!args_map) {
      return result->Error(kErrorCodeInvalidId, "Expected map argument");
    }
    auto host_id_opt = GetInt64Value(*args_map, "hostId");
    if (!host_id_opt) {
      return result->Error(kErrorCodeInvalidId, "Missing hostId");
    }
    const auto host_it = hosts_.find(*host_id_opt);
    if (host_it == hosts_.end()) {
      return result->Error(kErrorCodeInvalidId, "Unknown hostId");
    }

    auto env13 =
        host_it->second->environment().try_query<ICoreWebView2Environment13>();
    if (!env13) {
      return result->Error("not_supported",
                           "ICoreWebView2Environment13 is not available");
    }

    std::shared_ptr<flutter::MethodResult<flutter::EncodableValue>>
        shared_result = std::move(result);
    HRESULT hr = env13->GetProcessExtendedInfos(
        Microsoft::WRL::Callback<
            ICoreWebView2GetProcessExtendedInfosCompletedHandler>(
            [shared_result](HRESULT error,
                            ICoreWebView2ProcessExtendedInfoCollection*
                                collection) -> HRESULT {
              if (FAILED(error) || !collection) {
                shared_result->Error("process_info_failed",
                                     "GetProcessExtendedInfos failed");
                return S_OK;
              }

              UINT32 count = 0;
              collection->get_Count(&count);

              flutter::EncodableList pids;
              pids.reserve(count);

              for (UINT32 i = 0; i < count; i++) {
                wil::com_ptr<ICoreWebView2ProcessExtendedInfo> extended;
                if (FAILED(collection->GetValueAtIndex(i, &extended))) continue;

                wil::com_ptr<ICoreWebView2ProcessInfo> info;
                if (FAILED(extended->get_ProcessInfo(&info))) continue;

                INT32 pid = 0;
                if (SUCCEEDED(info->get_ProcessId(&pid)) && pid != 0) {
                  pids.push_back(flutter::EncodableValue(pid));
                }
              }

              shared_result->Success(flutter::EncodableValue(std::move(pids)));
              return S_OK;
            })
            .Get());

    if (FAILED(hr)) {
      shared_result->Error("process_info_failed",
                           "GetProcessExtendedInfos call failed");
    }

    return;
  }

  if (method_call.method_name().compare(kMethodInitialize) == 0) {
    const auto* args_map =
        std::get_if<flutter::EncodableMap>(method_call.arguments());
    if (!args_map) {
      return result->Error(kErrorCodeInvalidId, "Expected map argument");
    }
    auto host_id_opt = GetInt64Value(*args_map, "hostId");
    if (!host_id_opt) {
      return result->Error(kErrorCodeInvalidId, "Missing hostId");
    }
    return CreateWebviewInstance(*host_id_opt, std::move(result));
  }

  if (method_call.method_name().compare(kMethodDisposeAll) == 0) {
    instances_.clear();
    instance_host_.clear();
    hosts_.clear();

    return result->Success();
  }

  if (method_call.method_name().compare(kMethodDispose) == 0) {
    if (const auto texture_id = GetInt64Arg(method_call.arguments())) {
      const auto it = instances_.find(*texture_id);
      if (it != instances_.end()) {
        instances_.erase(it);
        instance_host_.erase(*texture_id);
        return result->Success();
      }
    }
    return result->Error(kErrorCodeInvalidId);
  } else {
    result->NotImplemented();
  }
}

void WebviewWindowsPlugin::HandleCreateHost(
    const flutter::EncodableMap& args,
    std::unique_ptr<flutter::MethodResult<flutter::EncodableValue>> result) {
  std::optional<std::wstring> browser_exe_wpath = std::nullopt;
  auto browser_exe_path = GetOptionalValue<std::string>(args, "browserExePath");
  if (browser_exe_path) {
    browser_exe_wpath = util::Utf16FromUtf8(*browser_exe_path);
  }

  std::optional<std::wstring> user_data_wpath = std::nullopt;
  auto user_data_path = GetOptionalValue<std::string>(args, "userDataPath");
  if (user_data_path) {
    user_data_wpath = util::Utf16FromUtf8(*user_data_path);
  }

  auto additional_args =
      GetOptionalValue<std::string>(args, "additionalArguments");

  auto extensions_enabled =
      GetOptionalValue<bool>(args, "areBrowserExtensionsEnabled");
  auto tracking_prevention_enabled =
      GetOptionalValue<bool>(args, "enableTrackingPrevention");

  auto host = WebviewHost::Create(
      platform_.get(), user_data_wpath, browser_exe_wpath, additional_args,
      extensions_enabled, tracking_prevention_enabled);
  if (!host) {
    return result->Error(kErrorCodeEnvironmentCreationFailed,
                         "Failed to create WebView2 environment");
  }

  int64_t host_id = next_host_id_++;
  hosts_[host_id] = std::move(host);

  auto response = flutter::EncodableValue(flutter::EncodableMap{
      {flutter::EncodableValue("hostId"), flutter::EncodableValue(host_id)},
  });
  result->Success(response);
}

void WebviewWindowsPlugin::HandleDisposeHost(
    int64_t host_id,
    std::unique_ptr<flutter::MethodResult<flutter::EncodableValue>> result) {
  const auto host_it = hosts_.find(host_id);
  if (host_it == hosts_.end()) {
    return result->Error(kErrorCodeInvalidId, "Unknown hostId");
  }

  // Erase all webview bridges belonging to this host first, so the
  // Webview objects are released before the environment is destroyed.
  std::vector<int64_t> to_remove;
  for (const auto& [texture_id, owner_host_id] : instance_host_) {
    if (owner_host_id == host_id) {
      to_remove.push_back(texture_id);
    }
  }
  for (int64_t texture_id : to_remove) {
    instances_.erase(texture_id);
    instance_host_.erase(texture_id);
  }

  hosts_.erase(host_it);
  result->Success();
}

void WebviewWindowsPlugin::CreateWebviewInstance(
    int64_t host_id,
    std::unique_ptr<flutter::MethodResult<flutter::EncodableValue>> result) {
  if (!InitPlatform()) {
    return result->Error(kErrorUnsupportedPlatform,
                         "The platform is not supported");
  }

  const auto host_it = hosts_.find(host_id);
  if (host_it == hosts_.end()) {
    return result->Error(kErrorCodeInvalidId, "Unknown hostId");
  }

  auto hwnd =
      CreateWindowEx(0, window_class_.lpszClassName, L"", 0, 0, 0, 0, 0,
                     HWND_MESSAGE, nullptr, window_class_.hInstance, nullptr);

  std::shared_ptr<flutter::MethodResult<flutter::EncodableValue>>
      shared_result = std::move(result);
  host_it->second->CreateWebview(
      hwnd, true, true,
      [shared_result, host_id, alive = std::weak_ptr<bool>(alive_flag_), this](
          std::unique_ptr<Webview> webview,
          std::unique_ptr<WebviewCreationError> error) {
        if (!alive.lock()) return;

        if (!webview) {
          if (error) {
            return shared_result->Error(
                kErrorCodeWebviewCreationFailed,
                std::format(
                    "Creating the webview failed: {} (HRESULT: {:#010x})",
                    error->message, error->hr));
          }
          return shared_result->Error(kErrorCodeWebviewCreationFailed,
                                      "Creating the webview failed.");
        }

        auto bridge = std::make_unique<WebviewBridge>(
            messenger_, textures_, platform_->graphics_context(),
            std::move(webview));
        auto texture_id = bridge->texture_id();
        instances_[texture_id] = std::move(bridge);
        instance_host_[texture_id] = host_id;

        auto response = flutter::EncodableValue(flutter::EncodableMap{
            {flutter::EncodableValue("textureId"),
             flutter::EncodableValue(texture_id)},
        });

        shared_result->Success(response);
      });
}

bool WebviewWindowsPlugin::InitPlatform() {
  if (!platform_) {
    platform_ = std::make_unique<WebviewPlatform>();
  }
  return platform_->IsSupported();
}

}  // namespace

void WebviewWindowsPluginRegisterWithRegistrar(
    FlutterDesktopPluginRegistrarRef registrar) {
  WebviewWindowsPlugin::RegisterWithRegistrar(
      flutter::PluginRegistrarManager::GetInstance()
          ->GetRegistrar<flutter::PluginRegistrarWindows>(registrar));
}
