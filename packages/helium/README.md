# Helium

隐私向 Chromium 浏览器。仅 `aarch64-darwin`。

Home Manager 模块：`homeModules.helium`

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

nix-darwin 里把模块放进 Home Manager 的 `sharedModules`。

## 配置项

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `package` | 本仓库 Helium 包 | 使用的 Helium 包 |
| `commandLineArgs` | `[]` | 通过 `helium` 命令启动时追加的参数 |
| `profileDirectory` | `"Default"` | 要写 Services 偏好的 Chromium profile |
| `autoUpdate` | `false` | 是否允许 Helium 自己更新。Nix 管理版本时保持关闭 |
| `services.enable` | `true` | 是否访问 Helium Services |
| `services.bangs` | `true` | 是否下载 `!bangs` 列表 |
| `services.extensionProxy` | `true` | 是否通过 Helium Services 代理扩展下载 |
| `services.spellcheck` | `true` | 是否通过 Helium Services 下载拼写词典 |
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

`commandLineArgs` 只对 `helium` 命令生效。Finder、Dock、Spotlight 直接启动 App Bundle，不会经过 wrapper。
