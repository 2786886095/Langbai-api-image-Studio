#include <flutter/dart_project.h>
#include <flutter/flutter_view_controller.h>
#include <windows.h>

#include <algorithm>
#include <string>
#include <vector>

#include "flutter_window.h"
#include "utils.h"

namespace {

constexpr wchar_t kMainInstanceMutex[] =
    L"Local\\LangbaiAIImageGenerator.Main.v1";
constexpr wchar_t kMainWindowProperty[] =
    L"LangbaiAIImageGenerator.MainWindow";

bool HasArgument(const std::vector<std::string>& arguments,
                 const std::string& value) {
  return std::find(arguments.begin(), arguments.end(), value) !=
         arguments.end();
}

bool IsSingleInstanceExempt(const std::vector<std::string>& arguments) {
  return HasArgument(arguments, "--chatgpt-auth-window") ||
         HasArgument(arguments, "--windows-webview-self-test") ||
         HasArgument(arguments, "--windows-webview-input-self-test");
}

BOOL CALLBACK ActivateMainWindow(HWND window, LPARAM) {
  if (::GetPropW(window, kMainWindowProperty) == nullptr) {
    return TRUE;
  }
  if (::IsIconic(window)) {
    ::ShowWindow(window, SW_RESTORE);
  } else {
    ::ShowWindow(window, SW_SHOW);
  }
  ::SetForegroundWindow(window);
  return FALSE;
}

}  // namespace

int APIENTRY wWinMain(_In_ HINSTANCE instance, _In_opt_ HINSTANCE prev,
                      _In_ wchar_t *command_line, _In_ int show_command) {
  // Attach to console when present (e.g., 'flutter run') or create a
  // new console when running with a debugger.
  if (!::AttachConsole(ATTACH_PARENT_PROCESS) && ::IsDebuggerPresent()) {
    CreateAndAttachConsole();
  }

  std::vector<std::string> command_line_arguments =
      GetCommandLineArguments();
  const bool single_instance_exempt =
      IsSingleInstanceExempt(command_line_arguments);
  const bool silent_chatgpt_auth =
      HasArgument(command_line_arguments, "--chatgpt-auth-silent");
  HANDLE instance_mutex = nullptr;
  if (!single_instance_exempt) {
    instance_mutex = ::CreateMutexW(nullptr, TRUE, kMainInstanceMutex);
    if (instance_mutex != nullptr && ::GetLastError() == ERROR_ALREADY_EXISTS) {
      ::EnumWindows(ActivateMainWindow, 0);
      ::CloseHandle(instance_mutex);
      return EXIT_SUCCESS;
    }
  }

  // Initialize COM, so that it is available for use in the library and/or
  // plugins.
  ::CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);

  flutter::DartProject project(L"data");

  project.set_dart_entrypoint_arguments(std::move(command_line_arguments));

  FlutterWindow window(project, !silent_chatgpt_auth);
  Win32Window::Point origin(10, 10);
  Win32Window::Size size(1280, 720);
  if (!window.Create(L"AI Image Generator", origin, size)) {
    if (instance_mutex != nullptr) {
      ::ReleaseMutex(instance_mutex);
      ::CloseHandle(instance_mutex);
    }
    ::CoUninitialize();
    return EXIT_FAILURE;
  }
  if (!single_instance_exempt) {
    ::SetPropW(
        window.GetHandle(),
        kMainWindowProperty,
        reinterpret_cast<HANDLE>(static_cast<INT_PTR>(1)));
  }
  window.SetQuitOnClose(true);

  ::MSG msg;
  while (::GetMessage(&msg, nullptr, 0, 0)) {
    ::TranslateMessage(&msg);
    ::DispatchMessage(&msg);
  }

  ::CoUninitialize();
  if (instance_mutex != nullptr) {
    ::ReleaseMutex(instance_mutex);
    ::CloseHandle(instance_mutex);
  }
  return EXIT_SUCCESS;
}
