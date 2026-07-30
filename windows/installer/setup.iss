#define MyAppName "AI 图片生成器"
#define MyAppNameEn "AI Image Generator"
#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif
#define MyAppPublisher "Langbai"
#define MyAppExeName "ai_image_generator.exe"
#define MyGatewayExeName "langbai_chatgpt_gateway.exe"

[Setup]
AppId={{83D775F4-F8FD-418B-B3AF-5C4397ABF5E0}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\{#MyAppNameEn}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=Output
OutputBaseFilename=AI-Image-Generator-Setup
SetupIconFile=..\runner\resources\app_icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "chinesesimp"; MessagesFile: "ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式(&D)"; GroupDescription: "附加图标："

[Files]
Source: "..\..\build\windows\x64\runner\Release\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion
Source: "..\..\THIRD_PARTY_NOTICES.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\THIRD_PARTY_LICENSES\*"; DestDir: "{app}\THIRD_PARTY_LICENSES"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\卸载 {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Code]
function IsLangbaiLaunchRequested(): Boolean;
var
  Index: Integer;
begin
  Result := False;
  for Index := 1 to ParamCount do
  begin
    if CompareText(ParamStr(Index), '/LANGBAILAUNCH') = 0 then
    begin
      Result := True;
      exit;
    end;
  end;
end;

function ShouldOfferInteractiveLaunch(): Boolean;
begin
  Result := (not WizardSilent) and (not IsLangbaiLaunchRequested());
end;

function GatewayExecutablePath(): String;
begin
  Result := ExpandConstant('{app}\chatgpt_gateway\{#MyGatewayExeName}');
end;

function StopBundledGateway(): String;
var
  TargetPath: String;
  EscapedTarget: String;
  ScriptPath: String;
  Script: String;
  ResultCode: Integer;
begin
  Result := '';
  TargetPath := GatewayExecutablePath();
  if not FileExists(TargetPath) then
    exit;

  EscapedTarget := TargetPath;
  StringChangeEx(EscapedTarget, '''', '''''', True);
  ScriptPath := ExpandConstant('{tmp}\langbai-stop-bundled-gateway.ps1');
  Script :=
    '$ErrorActionPreference = ''Stop''' + #13#10 +
    '$target = [IO.Path]::GetFullPath(''' + EscapedTarget + ''')' + #13#10 +
    '$deadline = [DateTime]::UtcNow.AddSeconds(12)' + #13#10 +
    'do {' + #13#10 +
    '  $matches = @(Get-CimInstance Win32_Process -Filter "Name=''{#MyGatewayExeName}''" | ' +
      'Where-Object { $_.ExecutablePath -and ([IO.Path]::GetFullPath($_.ExecutablePath) -eq $target) })' + #13#10 +
    '  foreach ($item in $matches) { Stop-Process -Id $item.ProcessId -Force -ErrorAction Stop }' + #13#10 +
    '  if ($matches.Count -eq 0) {' + #13#10 +
    '    try {' + #13#10 +
    '      $stream = [IO.File]::Open($target, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)' + #13#10 +
    '      $stream.Dispose()' + #13#10 +
    '      exit 0' + #13#10 +
    '    } catch {}' + #13#10 +
    '  }' + #13#10 +
    '  Start-Sleep -Milliseconds 200' + #13#10 +
    '} while ([DateTime]::UtcNow -lt $deadline)' + #13#10 +
    'exit 23' + #13#10;

  if not SaveStringToFile(ScriptPath, Script, False) then
  begin
    Result := '无法创建内置网关停止脚本。';
    exit;
  end;
  if not Exec(
    ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + ScriptPath + '"',
    '',
    SW_HIDE,
    ewWaitUntilTerminated,
    ResultCode
  ) then
  begin
    Result := '无法启动内置网关停止检查。';
    exit;
  end;
  if ResultCode <> 0 then
  begin
    Result := '内置生图网关仍在运行，请关闭软件后重试。';
    exit;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := StopBundledGateway();
end;

[Run]
; 普通交互安装可由用户选择启动。普通 /SILENT 或 /VERYSILENT 部署不启动。
Filename: "{app}\{#MyAppExeName}"; Description: "启动 {#MyAppName}"; Flags: nowait postinstall skipifsilent; Check: ShouldOfferInteractiveLaunch
; 软件内更新显式传入 /LANGBAILAUNCH，因此静默覆盖安装完成后仍会启动新版。
Filename: "{app}\{#MyAppExeName}"; Flags: nowait; Check: IsLangbaiLaunchRequested

[UninstallRun]
Filename: "{cmd}"; Parameters: "/C taskkill /F /IM ""{#MyAppExeName}"""; Flags: runhidden; RunOnceId: "KillAppBeforeUninstall"
