# Sparkle

Sparkle 是 Mihomo 图形客户端，仅支持 `aarch64-darwin`。

## 安装

不用 TUN 时，安装包即可。TUN 需要 nix-darwin 模块 `darwinModules.sparkle`。

模块把包里的 `Sparkle.app` 复制到 `/Applications/Sparkle.app`，并把下面两个 mihomo 内核设为属主 `root:admin`、权限 `4755`：

```text
/Applications/Sparkle.app/Contents/Resources/sidecar/mihomo
/Applications/Sparkle.app/Contents/Resources/sidecar/mihomo-alpha
```

不要对 Nix store 里的内核执行 chmod 或 setuid。使用 TUN 时打开 `/Applications/Sparkle.app`。不要打开 Nix store 或 Home Manager 里的副本。

## 配置

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

### 配置项

这些选项都在 `services.sparkle` 下。

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `package` | 本仓库 Sparkle 包 | 复制到 `/Applications` 的源包 |
| `addToSystemPackages` | `false` | 是否添加启动 `/Applications/Sparkle.app` 的 `sparkle` 命令 |

## 提示

关掉模块后，只有 App 里的管理标记匹配时，模块才删除 `/Applications/Sparkle.app`。这个路径上如果已经有不是本模块安装的 App，激活会失败，模块不会覆盖它。
