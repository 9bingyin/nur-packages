# Helium

[Helium](https://github.com/imputnet/helium) 的 Nix 打包与 Home Manager 模块。包从上游 macOS DMG 提取已签名的 `Helium.app`，并在安装阶段校验其代码签名。

目前仅支持 Apple Silicon macOS（`aarch64-darwin`）。

使用包或 Home Manager 模块前，先声明 flake 输入：

```nix
inputs.nur-packages.url = "github:9bingyin/nur-packages";
```

## 安装与启动

临时启动：

```sh
nix run github:9bingyin/nur-packages#helium
```

安装到 Nix profile：

```sh
nix profile install github:9bingyin/nur-packages#helium
```

也可以将 `packages.${pkgs.stdenv.hostPlatform.system}.helium` 加入 Home Manager 的 `home.packages` 或 nix-darwin 的 `environment.systemPackages`。

## Home Manager

模块通过 `homeModules.helium` 导出。在独立 Home Manager 配置中导入：

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

在 nix-darwin 中，应将模块加入 Home Manager 的 `sharedModules`：

```nix
{ config, inputs, ... }:
{
  home-manager = {
    sharedModules = [ inputs.nur-packages.homeModules.helium ];

    users.${config.local.host.primaryUser}.programs.helium = {
      enable = true;
      autoUpdate = false;
    };
  };
}
```

## 配置项

模块会将 Helium Services 偏好写入指定 Chromium profile 的 `Preferences`，并保留文件中未由模块管理的其他偏好。默认扩展更新地址为当前 Helium Services origin 的 `/ext`；配置 `extensions` 时，`services.enable` 与 `services.extensionProxy` 必须同时开启。

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `package` | 本仓库的 Helium 包 | 使用的 Helium 包。 |
| `commandLineArgs` | `[]` | 通过 `helium` CLI 启动时追加的参数，例如 `--helium-update-channel=beta`。 |
| `profileDirectory` | `"Default"` | 要管理 Services 偏好的 Chromium profile 目录。 |
| `autoUpdate` | `false` | 是否允许 Helium 下载浏览器和组件更新。Nix 管理版本时应保持关闭。 |
| `services.enable` | `true` | 是否允许访问 Helium Services。 |
| `services.bangs` | `true` | 是否下载和使用 `!bangs` 列表。 |
| `services.extensionProxy` | `true` | 是否通过 Helium Services 代理扩展下载请求。 |
| `services.spellcheck` | `true` | 是否通过 Helium Services 下载拼写检查词典。 |
| `services.origin` | `null` | 可选的 Helium Services 地址覆盖。 |
| `extensions` | `[]` | 外部安装的 Chromium 扩展。 |
| `dictionaries` | `[]` | 要安装的 Chromium 词典包。 |
| `nativeMessagingHosts` | `[]` | 提供给 Helium 的 Native Messaging Host 包。 |

示例：

```nix
programs.helium = {
  enable = true;
  autoUpdate = false;

  commandLineArgs = [
    "--helium-update-channel=beta"
  ];

  services = {
    enable = true;
    bangs = true;
    extensionProxy = true;
    spellcheck = true;
    origin = null;
  };

  extensions = [
    "cjpalhdlnbpafiamejdnhcphjbkeiagm" # uBlock Origin
  ];

  nativeMessagingHosts = [
    pkgs.keepassxc
  ];
};
```

`extensions` 中的字符串是 Chrome Web Store 扩展 ID，也可使用属性集指定外部更新 URL，或指定本地 CRX 文件及其版本：

```nix
programs.helium.extensions = [
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
```

`commandLineArgs` 只影响通过 `helium` 命令启动的实例。Finder、Dock、Spotlight 或 `Home Manager Apps/Helium.app` 直接启动 App Bundle，不会经过该 shell wrapper。

## 更新

应用版本由 Nix 管理。更新 flake input 或包版本后，执行相应的 `darwin-rebuild switch`、`home-manager switch` 或 profile 升级即可。

维护包版本时运行：

```sh
python3 packages/helium/update.py
nix fmt
```

脚本从 Helium macOS 最新 GitHub Release 获取版本和 ARM64 DMG 的固定哈希。若 GitHub API 限流，可设置 `GITHUB_TOKEN` 后再运行。
