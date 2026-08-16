# Sparkle

Mihomo 图形客户端。仅支持 `aarch64-darwin`。

普通代理不需要模块。TUN 使用 `darwinModules.sparkle`。模块把包里的 `Sparkle.app` 复制到 `/Applications/Sparkle.app`，再给上游原路径里的内核授权：

```text
/Applications/Sparkle.app/Contents/Resources/sidecar/mihomo
/Applications/Sparkle.app/Contents/Resources/sidecar/mihomo-alpha
```

这两个文件是 `root:admin`、`4755`。不要对 Nix store 里的内核做 chmod / setuid。TUN 时打开 `/Applications/Sparkle.app`，不要打开 store 或 Home Manager 里的那份。

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
}
```

## 配置项

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `package` | 本仓库 Sparkle 包 | 复制到 `/Applications` 的源包 |
| `addToSystemPackages` | `false` | 是否添加启动 `/Applications/Sparkle.app` 的 `sparkle` 命令 |

关掉模块后，只有 App 内管理标记匹配时，才会删除 `/Applications/Sparkle.app`。如果该路径已有不是本模块安装的 App，激活会失败，不会覆盖。
