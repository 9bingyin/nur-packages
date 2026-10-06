# Helium

隐私向 Chromium 浏览器。支持 `x86_64-linux`、`aarch64-linux` 和 `aarch64-darwin`。包名 `helium-bin`。

Linux 使用 `imputnet/helium-linux` 的归档，macOS 使用 `imputnet/helium-macos` 的 DMG。两平台独立更新，版本可以不同。`sources.json` 保存版本和各架构哈希。

Home Manager 模块：`homeModules.helium`。启用后会写入 Helium Services 偏好，并跳过首次 `helium://setup`。

```nix
{ inputs, ... }:
{
  imports = [ inputs.nur-packages.homeModules.helium ];

  programs.helium = {
    enable = true;
    autoUpdate = false;
  };
}
```

在 NixOS 和 nix-darwin 中，也可通过 Home Manager 的 `sharedModules` 引入模块。

扩展、词典和 Native Messaging Host 使用以下配置目录：

- Linux：`${xdg.configHome}/helium`，默认 `~/.config/helium`。
- macOS：`~/Library/Application Support/net.imput.helium`。

## 配置项

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `package` | 本仓库 `helium-bin` | 使用的 Helium 包 |
| `commandLineArgs` | `[]` | 命令行和 Linux 桌面启动时追加的参数 |
| `profileDirectory` | `"Default"` | 要写 Services 偏好的 Chromium profile |
| `autoUpdate` | `false` | 是否允许 Helium 自己更新。Nix 管理版本时保持关闭 |
| `services.enable` | `true` | 是否访问 Helium Services |
| `services.bangs` | `true` | 是否下载 `!bangs` 列表 |
| `services.extensionProxy` | `true` | 是否通过 Helium Services 代理扩展下载 |
| `services.spellcheck` | `true` | 是否通过 Helium Services 下载拼写词典 |
| `services.ublockAssets` | `true` | 是否通过 Helium Services 下载 uBlock Origin 过滤列表 |
| `services.origin` | `null` | 覆盖 Helium Services 地址 |
| `extensions` | `[]` | 外部 Chromium 扩展 |
| `dictionaries` | `[]` | Chromium 词典包 |
| `nativeMessagingHosts` | `[]` | Native Messaging Host 包 |

配置 `extensions` 时，`services.enable` 和 `services.extensionProxy` 必须同时开启。

```nix
programs.helium = {
  enable = true;
  autoUpdate = false;

  commandLineArgs = [
    "--helium-update-channel=beta"
  ];

  extensions = [
    "cjpalhdlnbpafiamejdnhcphjbkeiagm" # uBlock Origin
    {
      id = "aaaaaaaaaabbbbbbbbbbcccccccccccc";
      updateUrl = "https://example.org/updates.xml";
    }
    {
      id = "ddddddddddeeeeeeeeeeffffffffffff";
      crxPath = /path/to/extension.crx;
      version = "1.0";
    }
  ];

  nativeMessagingHosts = [
    pkgs.keepassxc
  ];
};
```

`commandLineArgs` 对 `helium` 命令和 Linux 桌面启动器生效。macOS 的 Finder、Dock、Spotlight 直接启动应用，不使用这些参数。

Linux 包含桌面文件、图标、GTK/Qt 集成和运行库。在 Wayland 会话中设置 `NIXOS_OZONE_WL=1` 可启用原生后端。
