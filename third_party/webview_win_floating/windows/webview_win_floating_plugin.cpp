#include "webview_win_floating_plugin.h"

// This must be included before many other Windows headers.
#include <windows.h>

// For getPlatformVersion; remove unless needed for your plugin implementation.
#include <VersionHelpers.h>

#include <flutter/method_channel.h>
#include <flutter/plugin_registrar_windows.h>
#include <flutter/standard_method_codec.h>

#include <memory>
#include <sstream>

// Jacky {
#include "my_webview.h"

// utf8ToUtf16(): convert utf8 to utf16, with MultiByteToWideChar()
std::wstring utf8ToUtf16(const std::string &utf8Str) {
  if (utf8Str.empty())
    return std::wstring();

  int wideLen =
      MultiByteToWideChar(CP_UTF8, 0, utf8Str.c_str(), -1, nullptr, 0);
  if (wideLen == 0) {
    std::cout << "[webview_win_floating][native] MultiByteToWideChar fail"
              << std::endl;
    return std::wstring();
  }

  std::vector<wchar_t> wideBuffer(wideLen);
  int result = MultiByteToWideChar(CP_UTF8, 0, utf8Str.c_str(), -1,
                                   wideBuffer.data(), wideLen);
  if (result == 0)
    return std::wstring();

  return std::wstring(wideBuffer.data(), wideLen - 1);
}

// Jacky }

namespace webview_win_floating {

void WebviewWinFloatingPlugin::RegisterWithRegistrar(
    flutter::PluginRegistrarWindows *registrar) {
  auto channel =
      std::make_unique<flutter::MethodChannel<flutter::EncodableValue>>(
          registrar->messenger(), "webview_win_floating",
          &flutter::StandardMethodCodec::GetInstance());

  auto plugin = std::make_unique<WebviewWinFloatingPlugin>();

  channel->SetMethodCallHandler(
      [plugin_pointer = plugin.get()](const auto &call, auto result) {
        plugin_pointer->HandleMethodCall(call, std::move(result));
      });

  // Jacky {
  plugin->m_flutterHWND = registrar->GetView()->GetNativeWindow();
  plugin->m_registrar = registrar;
  plugin->m_windowProcDelegateId =
      registrar->RegisterTopLevelWindowProcDelegate(
          [plugin_pointer = plugin.get()](HWND hwnd, UINT message,
                                          WPARAM wparam, LPARAM lparam) {
            return plugin_pointer->HandleTopLevelWindowProc(hwnd, message,
                                                            wparam, lparam);
          });
  plugin->m_MethodChannel = std::move(channel);
  // Jacky }

  registrar->AddPlugin(std::move(plugin));
}

WebviewWinFloatingPlugin::WebviewWinFloatingPlugin() {}

WebviewWinFloatingPlugin::~WebviewWinFloatingPlugin() {
  std::cout << "[webview_win_floating] ~WebviewWinFloatingPlugin(): plugin "
               "disposing now"
            << std::endl;
  if (m_registrar != nullptr && m_windowProcDelegateId >= 0) {
    m_registrar->UnregisterTopLevelWindowProcDelegate(m_windowProcDelegateId);
    m_windowProcDelegateId = -1;
  }
  destroyAllWebViews();
}

void WebviewWinFloatingPlugin::updateTopLevelHostedBounds() {
  if (m_topLevelHWND == nullptr || m_webViewHostHWND == nullptr)
    return;
  RECT bounds{};
  if (!GetClientRect(m_topLevelHWND, &bounds))
    return;
  const int width = bounds.right - bounds.left;
  const int height = bounds.bottom - bounds.top;
  SetWindowPos(m_webViewHostHWND, HWND_TOP, 0, 0, width, height,
               SWP_NOACTIVATE | SWP_SHOWWINDOW);
  RECT webviewBounds{0, 0, width, height};
  for (const int webviewId : m_topLevelHostedWebviews) {
    const auto it = m_webviewMap.find(webviewId);
    if (it != m_webviewMap.end() && it->second != nullptr) {
      it->second->updateBounds(webviewBounds);
    }
  }
}

bool WebviewWinFloatingPlugin::ensureTopLevelHost() {
  if (m_webViewHostHWND != nullptr && IsWindow(m_webViewHostHWND))
    return true;
  m_topLevelHWND = GetAncestor(m_flutterHWND, GA_ROOT);
  if (m_topLevelHWND == nullptr || m_topLevelHWND == m_flutterHWND) {
    return false;
  }
  RECT bounds{};
  if (!GetClientRect(m_topLevelHWND, &bounds))
    return false;
  m_webViewHostHWND = CreateWindowExW(
      0, L"STATIC", L"",
      WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN | WS_CLIPSIBLINGS, 0, 0,
      bounds.right - bounds.left, bounds.bottom - bounds.top, m_topLevelHWND,
      nullptr, GetModuleHandleW(nullptr), nullptr);
  if (m_webViewHostHWND == nullptr)
    return false;
  SetWindowPos(m_webViewHostHWND, HWND_TOP, 0, 0, bounds.right - bounds.left,
               bounds.bottom - bounds.top, SWP_NOACTIVATE | SWP_SHOWWINDOW);
  return true;
}

void WebviewWinFloatingPlugin::destroyTopLevelHostIfUnused() {
  if (!m_topLevelHostedWebviews.empty())
    return;
  if (m_webViewHostHWND != nullptr && IsWindow(m_webViewHostHWND)) {
    DestroyWindow(m_webViewHostHWND);
  }
  m_webViewHostHWND = nullptr;
  m_topLevelHWND = nullptr;
}

void WebviewWinFloatingPlugin::focusTopLevelHostedWebView() {
  for (auto it = m_topLevelHostedWebviews.rbegin();
       it != m_topLevelHostedWebviews.rend(); ++it) {
    const auto webview = m_webviewMap.find(*it);
    if (webview != m_webviewMap.end() && webview->second != nullptr) {
      webview->second->requestFocus(false);
      return;
    }
  }
}

std::optional<LRESULT> WebviewWinFloatingPlugin::HandleTopLevelWindowProc(
    HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) {
  (void)hwnd;
  (void)lparam;
  if (m_topLevelHostedWebviews.empty())
    return std::nullopt;
  switch (message) {
  case WM_SIZE:
    if (wparam == SIZE_MINIMIZED) {
      if (m_webViewHostHWND != nullptr)
        ShowWindow(m_webViewHostHWND, SW_HIDE);
      return std::nullopt;
    }
    updateTopLevelHostedBounds();
    return std::nullopt;
  case WM_DPICHANGED:
  case WM_MOVE:
    updateTopLevelHostedBounds();
    return std::nullopt;
  case WM_ACTIVATE:
    if (LOWORD(wparam) != WA_INACTIVE) {
      focusTopLevelHostedWebView();
      // Prevent the stock runner from immediately moving focus back to the
      // hidden Flutter surface after WebView2 has accepted activation.
      return LRESULT{0};
    }
    return std::nullopt;
  case WM_SETFOCUS:
    focusTopLevelHostedWebView();
    return LRESULT{0};
  default:
    return std::nullopt;
  }
}

void WebviewWinFloatingPlugin::createWebview(
    const flutter::MethodCall<flutter::EncodableValue> &method_call,
    std::unique_ptr<flutter::MethodResult<flutter::EncodableValue>> &result,
    int webviewId, std::string url, std::string userDataFolder,
    std::string profileName) {

  std::shared_ptr<flutter::MethodResult<flutter::EncodableValue>>
      shared_result = std::move(result);
  MyWebViewCreateParams params;

  params.onCreated = [=](HRESULT hr, MyWebView *webview) -> void {
    if (webview != NULL) {
      auto pending = m_pendingWebviewMap.find(webviewId);
      if (pending == m_pendingWebviewMap.end() ||
          pending->second.get() != webview) {
        shared_result->Error("[webview] native create was cancelled.");
        return;
      }
      m_webviewMap[webviewId] = pending->second;
      m_pendingWebviewMap.erase(pending);
      std::cout << "[webview] native create: id = " << webviewId << std::endl;
      if (m_topLevelHostedWebviews.count(webviewId) != 0) {
        updateTopLevelHostedBounds();
        focusTopLevelHostedWebView();
      }
      if (!url.empty())
        webview->loadUrl(utf8ToUtf16(url).c_str());
      shared_result->Success(flutter::EncodableValue(true));
    } else {
      auto pending = m_pendingWebviewMap.find(webviewId);
      if (pending != m_pendingWebviewMap.end()) {
        // Keep the object alive until plugin shutdown. The failure callback is
        // currently running from inside that object, so erasing the final
        // owner here would destroy it before its callback returns.
        m_retiredWebviews.push_back(pending->second);
        m_pendingWebviewMap.erase(pending);
      }
      m_topLevelHostedWebviews.erase(webviewId);
      destroyTopLevelHostIfUnused();
      std::cerr << "[webview] native create failed. result = " << hr
                << std::endl;
      shared_result->Error("[webview] native create failed.");
    }
  };

  params.onNavigationRequest = [=](int requestId, std::string url,
                                   bool isNewWindow) -> void {
    flutter::EncodableMap arguments;
    arguments[flutter::EncodableValue("webviewId")] =
        flutter::EncodableValue(webviewId);
    arguments[flutter::EncodableValue("requestId")] =
        flutter::EncodableValue(requestId);
    arguments[flutter::EncodableValue("url")] = flutter::EncodableValue(url);
    arguments[flutter::EncodableValue("isNewWindow")] =
        flutter::EncodableValue(isNewWindow);
    m_MethodChannel->InvokeMethod(
        "onNavigationRequest",
        std::make_unique<flutter::EncodableValue>(arguments));
  };

  params.onPageStarted = [=](std::string url) -> void {
    flutter::EncodableMap arguments;
    arguments[flutter::EncodableValue("webviewId")] =
        flutter::EncodableValue(webviewId);
    arguments[flutter::EncodableValue("url")] = flutter::EncodableValue(url);
    m_MethodChannel->InvokeMethod(
        "onPageStarted", std::make_unique<flutter::EncodableValue>(arguments));
  };

  params.onPageFinished = [=](std::string url) -> void {
    flutter::EncodableMap arguments;
    arguments[flutter::EncodableValue("webviewId")] =
        flutter::EncodableValue(webviewId);
    arguments[flutter::EncodableValue("url")] = flutter::EncodableValue(url);
    m_MethodChannel->InvokeMethod(
        "onPageFinished", std::make_unique<flutter::EncodableValue>(arguments));
  };

  params.onHttpError = [=](std::string url, int errCode) -> void {
    flutter::EncodableMap arguments;
    arguments[flutter::EncodableValue("webviewId")] =
        flutter::EncodableValue(webviewId);
    arguments[flutter::EncodableValue("url")] = flutter::EncodableValue(url);
    arguments[flutter::EncodableValue("errCode")] =
        flutter::EncodableValue(errCode);
    m_MethodChannel->InvokeMethod(
        "onHttpError", std::make_unique<flutter::EncodableValue>(arguments));
  };

  params.onSslAuthError = [=](std::string url) -> void {
    flutter::EncodableMap arguments;
    arguments[flutter::EncodableValue("webviewId")] =
        flutter::EncodableValue(webviewId);
    arguments[flutter::EncodableValue("url")] = flutter::EncodableValue(url);
    m_MethodChannel->InvokeMethod(
        "onSslAuthError", std::make_unique<flutter::EncodableValue>(arguments));
  };

  params.onWebResourceError = [=](std::string url, int errCode,
                                  std::string errType) -> void {
    flutter::EncodableMap arguments;
    arguments[flutter::EncodableValue("webviewId")] =
        flutter::EncodableValue(webviewId);
    arguments[flutter::EncodableValue("url")] = flutter::EncodableValue(url);
    arguments[flutter::EncodableValue("errCode")] =
        flutter::EncodableValue(errCode);
    arguments[flutter::EncodableValue("errType")] =
        flutter::EncodableValue(errType);
    m_MethodChannel->InvokeMethod(
        "onWebResourceError",
        std::make_unique<flutter::EncodableValue>(arguments));
  };

  params.onProcessFailed = [=](int kind) -> void {
    flutter::EncodableMap arguments;
    arguments[flutter::EncodableValue("webviewId")] =
        flutter::EncodableValue(webviewId);
    arguments[flutter::EncodableValue("kind")] = flutter::EncodableValue(kind);
    m_MethodChannel->InvokeMethod(
        "onProcessFailed",
        std::make_unique<flutter::EncodableValue>(arguments));
  };

  params.onUrlChange = [=](std::string url) -> void {
    flutter::EncodableMap arguments;
    arguments[flutter::EncodableValue("webviewId")] =
        flutter::EncodableValue(webviewId);
    arguments[flutter::EncodableValue("url")] = flutter::EncodableValue(url);
    m_MethodChannel->InvokeMethod(
        "onUrlChange", std::make_unique<flutter::EncodableValue>(arguments));
  };

  params.onPageTitleChanged = [=](std::string title) -> void {
    flutter::EncodableMap arguments;
    arguments[flutter::EncodableValue("webviewId")] =
        flutter::EncodableValue(webviewId);
    arguments[flutter::EncodableValue("title")] =
        flutter::EncodableValue(title);
    m_MethodChannel->InvokeMethod(
        "onPageTitleChanged",
        std::make_unique<flutter::EncodableValue>(arguments));
  };

  params.onWebMessageReceived = [=](std::string message) -> void {
    flutter::EncodableMap arguments;
    arguments[flutter::EncodableValue("webviewId")] =
        flutter::EncodableValue(webviewId);
    arguments[flutter::EncodableValue("message")] =
        flutter::EncodableValue(message);
    m_MethodChannel->InvokeMethod(
        "OnWebMessageReceived",
        std::make_unique<flutter::EncodableValue>(arguments));
  };

  params.onMoveFocusRequest = [=](bool isNext) -> void {
    flutter::EncodableMap arguments;
    arguments[flutter::EncodableValue("webviewId")] =
        flutter::EncodableValue(webviewId);
    arguments[flutter::EncodableValue("isNext")] =
        flutter::EncodableValue(isNext);
    m_MethodChannel->InvokeMethod(
        "onMoveFocusRequest",
        std::make_unique<flutter::EncodableValue>(arguments));
  };

  params.onFullScreenChanged = [=](BOOL isFullScreen) -> void {
    // TODO: Android webview does'n support fullscreen listener... should we
    // support ONLY in windows ???
    flutter::EncodableMap arguments;
    arguments[flutter::EncodableValue("webviewId")] =
        flutter::EncodableValue(webviewId);
    arguments[flutter::EncodableValue("isFullScreen")] =
        flutter::EncodableValue(isFullScreen ? true : false);
    m_MethodChannel->InvokeMethod(
        "OnFullScreenChanged",
        std::make_unique<flutter::EncodableValue>(arguments));
  };

  params.onHistoryChanged = [=]() -> void {
    flutter::EncodableMap arguments;
    arguments[flutter::EncodableValue("webviewId")] =
        flutter::EncodableValue(webviewId);
    m_MethodChannel->InvokeMethod(
        "onHistoryChanged",
        std::make_unique<flutter::EncodableValue>(arguments));
  };

  params.onAskPermission = [=](std::string url, int kind,
                               int deferralId) -> void {
    flutter::EncodableMap arguments;
    arguments[flutter::EncodableValue("webviewId")] =
        flutter::EncodableValue(webviewId);
    arguments[flutter::EncodableValue("url")] = flutter::EncodableValue(url);
    arguments[flutter::EncodableValue("kind")] = flutter::EncodableValue(kind);
    arguments[flutter::EncodableValue("deferralId")] =
        flutter::EncodableValue(deferralId);
    m_MethodChannel->InvokeMethod(
        "onAskPermission",
        std::make_unique<flutter::EncodableValue>(arguments));
  };

  const auto wideUserDataFolder = utf8ToUtf16(userDataFolder);
  const auto wideProfileName = utf8ToUtf16(profileName);
  const auto &arguments =
      std::get<flutter::EncodableMap>(*method_call.arguments());
  const auto hostArgument =
      arguments.find(flutter::EncodableValue("useTopLevelWindowHost"));
  const bool useTopLevelWindowHost =
      hostArgument != arguments.end() && std::get<bool>(hostArgument->second);
  if (useTopLevelWindowHost && !ensureTopLevelHost()) {
    shared_result->Error("[webview] top-level native host creation failed.");
    return;
  }
  HWND hostWindow = useTopLevelWindowHost ? m_webViewHostHWND : m_flutterHWND;
  auto pending =
      std::shared_ptr<MyWebView>(MyWebView::Create(hostWindow, params));
  if (!pending) {
    shared_result->Error("[webview] native allocation failed.");
    return;
  }
  m_pendingWebviewMap[webviewId] = pending;
  if (useTopLevelWindowHost)
    m_topLevelHostedWebviews.insert(webviewId);
  pending->initialize(wideUserDataFolder.c_str(), wideProfileName.c_str());
}

void WebviewWinFloatingPlugin::destroyAllWebViews() {
  for (const auto &entry : m_webviewMap) {
    std::cout << "[webview_win_floating] old webview found, deleting id = "
              << entry.first << std::endl;
  }
  m_webviewMap.clear();
  for (const auto &entry : m_pendingWebviewMap) {
    m_retiredWebviews.push_back(entry.second);
  }
  m_pendingWebviewMap.clear();
  m_topLevelHostedWebviews.clear();
  destroyTopLevelHostIfUnused();
  if (m_flutterHWND != nullptr)
    ShowWindow(m_flutterHWND, SW_SHOWNA);
}

void WebviewWinFloatingPlugin::HandleMethodCall(
    const flutter::MethodCall<flutter::EncodableValue> &method_call,
    std::unique_ptr<flutter::MethodResult<flutter::EncodableValue>> result) {

  // std::cout << "native HandleMethodCall(): " << method_call.method_name() <<
  // std::endl;

  if (method_call.method_name().compare("init") == 0) {
    // called when hot-restart in debug mode, and clear all the old webviews
    // which created before hot-restart
    destroyAllWebViews();
    result->Success();
    return;
  }

  flutter::EncodableMap arguments =
      std::get<flutter::EncodableMap>(*method_call.arguments());
  auto webviewId =
      std::get<int>(arguments[flutter::EncodableValue("webviewId")]);

  bool isCreateCall = method_call.method_name().compare("create") == 0;
  auto webviewIt = m_webviewMap.find(webviewId);
  std::shared_ptr<MyWebView> webview =
      webviewIt == m_webviewMap.end() ? nullptr : webviewIt->second;
  if (webview == NULL && !isCreateCall) {
    result->Error("webview hasn't created");
    return;
  }

  if (isCreateCall) {
    auto url = std::get<std::string>(arguments[flutter::EncodableValue("url")]);
    auto userDataFolder = std::get<std::string>(
        arguments[flutter::EncodableValue("userDataFolder")]);
    auto profileName = std::get<std::string>(
        arguments[flutter::EncodableValue("profileName")]);
    createWebview(method_call, result, webviewId, url, userDataFolder,
                  profileName);
  } else if (method_call.method_name().compare("setHasNavigationDecision") ==
             0) {
    auto hasNavigationDecision = std::get<bool>(
        arguments[flutter::EncodableValue("hasNavigationDecision")]);
    webview->setHasNavigationDecision(hasNavigationDecision);
    result->Success();
  } else if (method_call.method_name().compare("allowNavigationRequest") == 0) {
    auto requestId =
        std::get<int>(arguments[flutter::EncodableValue("requestId")]);
    auto isAllowed =
        std::get<bool>(arguments[flutter::EncodableValue("isAllowed")]);
    webview->allowNavigationRequest(requestId, isAllowed);
    result->Success();
  } else if (method_call.method_name().compare("updateBounds") == 0) {
    if (m_topLevelHostedWebviews.count(webviewId) != 0) {
      updateTopLevelHostedBounds();
      result->Success(flutter::EncodableValue(true));
      return;
    }
    RECT bounds;
    bounds.left = std::get<int>(arguments[flutter::EncodableValue("left")]);
    bounds.top = std::get<int>(arguments[flutter::EncodableValue("top")]);
    bounds.right = std::get<int>(arguments[flutter::EncodableValue("right")]);
    bounds.bottom = std::get<int>(arguments[flutter::EncodableValue("bottom")]);
    const HRESULT hr = webview->updateBounds(bounds);
    if (FAILED(hr))
      result->Error("updateBounds() error");
    else
      result->Success(flutter::EncodableValue(true));
  } else if (method_call.method_name().compare("loadUrl") == 0) {
    auto url = std::get<std::string>(arguments[flutter::EncodableValue("url")]);
    auto hr = webview->loadUrl(utf8ToUtf16(url).c_str());
    result->Success(flutter::EncodableValue(SUCCEEDED(hr)));
  } else if (method_call.method_name().compare("loadHtmlString") == 0) {
    auto html =
        std::get<std::string>(arguments[flutter::EncodableValue("html")]);
    auto hr = webview->loadHtmlString(utf8ToUtf16(html).c_str());
    result->Success(flutter::EncodableValue(SUCCEEDED(hr)));

    if (!arguments[flutter::EncodableValue("baseUrl")].IsNull()) {
      static bool g_isPrompted_baseUrl = false;
      if (!g_isPrompted_baseUrl) {
        std::cout
            << "[win_webview_floating] loadHtmlString() ignore 'baseUrl' "
               "parameter in Windows. WebView2 doesn't support. ref: "
               "https://github.com/MicrosoftEdge/WebView2Feedback/issues/530"
            << std::endl;
        g_isPrompted_baseUrl = true;
      }
    }

  } else if (method_call.method_name().compare("runJavascript") == 0) {
    std::shared_ptr<flutter::MethodResult<flutter::EncodableValue>>
        shared_result = std::move(result);
    auto javaScriptString = std::get<std::string>(
        arguments[flutter::EncodableValue("javaScriptString")]);
    auto ignoreResult =
        std::get<bool>(arguments[flutter::EncodableValue("ignoreResult")]);
    auto hr = webview->runJavascript(
        utf8ToUtf16(javaScriptString).c_str(), ignoreResult,
        [shared_result, ignoreResult](std::string result) -> void {
          if (ignoreResult) {
            shared_result->Success();
          } else {
            shared_result->Success(flutter::EncodableValue(result));
          }
        });
    if (FAILED(hr))
      shared_result->Error("runJavascript() error");
  } else if (method_call.method_name().compare(
                 "addScriptToExecuteOnDocumentCreated") == 0) {
    std::shared_ptr<flutter::MethodResult<flutter::EncodableValue>>
        shared_result = std::move(result);
    auto javaScriptString = std::get<std::string>(
        arguments[flutter::EncodableValue("javaScriptString")]);
    webview->addScriptToExecuteOnDocumentCreated(
        utf8ToUtf16(javaScriptString).c_str(), [shared_result](HRESULT hr) {
          if (FAILED(hr))
            shared_result->Error("addScriptToExecuteOnDocumentCreated() error");
          else
            shared_result->Success();
        });
  } else if (method_call.method_name().compare("addScriptChannelByName") == 0) {
    auto channelName = std::get<std::string>(
        arguments[flutter::EncodableValue("channelName")]);
    auto hr = webview->addScriptChannelByName(utf8ToUtf16(channelName).c_str());
    if (FAILED(hr))
      result->Error("addScriptChannelByName() error");
    else
      result->Success();
  } else if (method_call.method_name().compare("removeScriptChannelByName") ==
             0) {
    auto channelName = std::get<std::string>(
        arguments[flutter::EncodableValue("channelName")]);
    webview->removeScriptChannelByName(utf8ToUtf16(channelName).c_str());
    result->Success();
  } else if (method_call.method_name().compare("setFullScreen") == 0) {
    auto isFullScreen =
        std::get<bool>(arguments[flutter::EncodableValue("isFullScreen")]);
    if (isFullScreen) {
      RECT bounds;
      GetClientRect(m_topLevelHostedWebviews.count(webviewId) != 0
                        ? m_webViewHostHWND
                        : m_flutterHWND,
                    &bounds);
      const HRESULT hr = webview->updateBounds(bounds);
      if (FAILED(hr)) {
        result->Error("setFullScreen() bounds error");
        return;
      }
    }
    result->Success(flutter::EncodableValue(true));
  } else if (method_call.method_name().compare("setVisibility") == 0) {
    auto isVisible =
        std::get<bool>(arguments[flutter::EncodableValue("isVisible")]);
    if (m_topLevelHostedWebviews.count(webviewId) != 0 &&
        m_webViewHostHWND != nullptr) {
      ShowWindow(m_webViewHostHWND, isVisible ? SW_SHOWNA : SW_HIDE);
      if (isVisible)
        updateTopLevelHostedBounds();
    }
    const HRESULT hr = webview->setVisible(isVisible);
    if (FAILED(hr))
      result->Error("setVisibility() error");
    else
      result->Success(flutter::EncodableValue(true));
  } else if (method_call.method_name().compare("enableJavascript") == 0) {
    auto isEnable =
        std::get<bool>(arguments[flutter::EncodableValue("isEnable")]);
    webview->enableJavascript(isEnable);
    result->Success(flutter::EncodableValue(true));
  } else if (method_call.method_name().compare("enableStatusBar") == 0) {
    auto isEnable =
        std::get<bool>(arguments[flutter::EncodableValue("isEnable")]);
    webview->enableStatusBar(isEnable);
    result->Success(flutter::EncodableValue(true));
  } else if (method_call.method_name().compare("enableIsZoomControl") == 0) {
    auto isEnable =
        std::get<bool>(arguments[flutter::EncodableValue("isEnable")]);
    webview->enableIsZoomControl(isEnable);
    result->Success(flutter::EncodableValue(true));
  } else if (method_call.method_name().compare("setUserAgent") == 0) {
    auto userAgent =
        std::get<std::string>(arguments[flutter::EncodableValue("userAgent")]);
    HRESULT hr = webview->setUserAgent(utf8ToUtf16(userAgent).c_str());
    result->Success(flutter::EncodableValue(SUCCEEDED(hr) ? true : false));
  } else if (method_call.method_name().compare("canGoBack") == 0) {
    bool allow = webview->canGoBack();
    result->Success(flutter::EncodableValue(allow));
  } else if (method_call.method_name().compare("canGoForward") == 0) {
    bool allow = webview->canGoForward();
    result->Success(flutter::EncodableValue(allow));
  } else if (method_call.method_name().compare("goBack") == 0) {
    webview->goBack();
    result->Success();
  } else if (method_call.method_name().compare("goForward") == 0) {
    webview->goForward();
    result->Success();
  } else if (method_call.method_name().compare("reload") == 0) {
    webview->reload();
    result->Success();
  } else if (method_call.method_name().compare("cancelNavigate") == 0) {
    webview->cancelNavigate();
    result->Success();

  } else if (method_call.method_name().compare("clearCache") == 0) {
    webview->clearCache();
    result->Success();
  } else if (method_call.method_name().compare("clearCookies") == 0) {
    HRESULT hr = webview->clearCookies();
    result->Success(flutter::EncodableValue(SUCCEEDED(hr)));

  } else if (method_call.method_name().compare("requestFocus") == 0) {
    const HRESULT hr = webview->requestFocus(true);
    if (FAILED(hr))
      result->Error("requestFocus() error");
    else
      result->Success();

  } else if (method_call.method_name().compare("setBackgroundColor") == 0) {
    auto color = std::get<int64_t>(arguments[flutter::EncodableValue("color")]);
    const HRESULT hr = webview->setBackgroundColor((int32_t)color);
    if (FAILED(hr))
      result->Error("setBackgroundColor() error");
    else
      result->Success();

  } else if (method_call.method_name().compare("suspend") == 0) {
    if (m_topLevelHostedWebviews.count(webviewId) != 0 &&
        m_webViewHostHWND != nullptr) {
      ShowWindow(m_webViewHostHWND, SW_HIDE);
    }
    webview->setVisible(false);
    webview->suspend();
    result->Success();
  } else if (method_call.method_name().compare("resume") == 0) {
    webview->resume();
    webview->setVisible(true);
    if (m_topLevelHostedWebviews.count(webviewId) != 0 &&
        m_webViewHostHWND != nullptr) {
      updateTopLevelHostedBounds();
      ShowWindow(m_webViewHostHWND, SW_SHOWNA);
      focusTopLevelHostedWebView();
    }
    result->Success();

  } else if (method_call.method_name().compare("dispose") == 0) {
    if (webview != NULL) {
      m_webviewMap.erase(webviewId);
      m_topLevelHostedWebviews.erase(webviewId);
      destroyTopLevelHostIfUnused();
      std::cout << "[webview] native dispose: id = " << webviewId << std::endl;
    }
    result->Success(flutter::EncodableValue(true));
  } else if (method_call.method_name().compare("grantPermission") == 0) {
    auto deferralId =
        std::get<int>(arguments[flutter::EncodableValue("deferralId")]);
    auto isGranted =
        std::get<bool>(arguments[flutter::EncodableValue("isGranted")]);
    webview->grantPermission(deferralId, isGranted);
    result->Success();
  } else if (method_call.method_name().compare("openDevTools") == 0) {
    webview->openDevTools();
    result->Success();
  } else {
    result->NotImplemented();
  }
}

} // namespace webview_win_floating
