# Helium

Helium 是注重隐私的 Chromium 浏览器，包名 `helium-bin`。支持 `x86_64-linux`、`aarch64-linux` 和 `aarch64-darwin`。

## 安装

`helium-bin` 带 Nix 启动 wrapper。`helium-bin.unwrapped` 是去掉 wrapper 的二进制包，对应 nixpkgs 里 Chromium 的 unwrapped 包。覆盖 `commandLineArgs` 只会重建 wrapper。

Linux 使用 `imputnet/helium-linux` 的归档，macOS 使用 `imputnet/helium-macos` 的 DMG。两个平台独立更新，版本可以不同。版本和各架构哈希写在 `packages/helium-bin/sources.json`。

## 配置

Home Manager 模块是 `homeModules.helium`。启用后会写入 Helium Services 偏好，并跳过首次打开 `helium://setup`。

NixOS 和 nix-darwin 用 Home Manager 的 `sharedModules` 引入这个模块。

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

### 配置项

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

`commandLineArgs` 会传给 `helium` 命令和 Linux 桌面启动器。macOS 的 Finder、Dock 和 Spotlight 直接启动应用，不读这些参数。Home Manager 调用 `package.override { commandLineArgs = ...; }` 重建 wrapper，不再在外面加一层启动脚本。自定义 `package` 必须接受 `commandLineArgs`。

扩展、词典和 Native Messaging Host 使用以下配置目录：

- Linux：`${xdg.configHome}/net.imput.helium`，默认 `~/.config/net.imput.helium`。
- macOS：`~/Library/Application Support/net.imput.helium`。

## 提示

Linux 包包含桌面文件、图标、GTK/Qt 集成和运行库。Wayland 会话里把 `NIXOS_OZONE_WL` 设为 `1`，浏览器会使用 Wayland 后端。
