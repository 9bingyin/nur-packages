# Sparkle

Mihomo 图形客户端。仅 `aarch64-darwin`。

普通代理不需要模块。TUN 需要 nix-darwin 模块 `darwinModules.sparkle`。Home Manager 管不了这项特权配置。

```nix
{ inputs, pkgs, ... }:
let
  sparkle = inputs.nur-packages.packages.${pkgs.stdenv.hostPlatform.system}.sparkle;
in
{
  imports = [ inputs.nur-packages.darwinModules.sparkle ];

  services.sparkle = {
    enable = true;
    package = sparkle;
  };

  home-manager.users.<用户名>.home.packages = [ sparkle ];
}
```

## 配置项

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `package` | 本仓库 Sparkle 包 | 提供内置 Mihomo 内核的包。和 Home Manager 装的包保持一致 |
| `addToSystemPackages` | `false` | 是否把应用加入 `environment.systemPackages`。默认关闭，避免和 Home Manager 重复 |

模块会把 `mihomo` / `mihomo-alpha` 装到：

```text
/Library/Application Support/com.github.9bingyin.nur-packages.sparkle/sidecar/
```

两个文件都是 `root:wheel`、`4755`。Sparkle 优先用这个目录；找不到再回退到 App Bundle 里的 `Resources/sidecar`。

不要对 store 里的 `mihomo` 做 chmod / setuid。关掉模块后，只会清带自身管理标记的目录。
