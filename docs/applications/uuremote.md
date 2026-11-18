# UU Remote

UU Remote 是网易 UU 远程，仅支持 `aarch64-darwin`。

## 安装

只安装软件包时没有后台服务。后台服务用 nix-darwin 模块 `darwinModules.uuremote`。模块读取 `system.primaryUser`，升级后重启这个用户的 Agent。

## 配置

```nix
{ inputs, pkgs, ... }:
{
  imports = [ inputs.nur-packages.darwinModules.uuremote ];

  services.uuremote = {
    enable = true;
    package = inputs.nur-packages.packages.${pkgs.stdenv.hostPlatform.system}.uuremote;
  };
}
```

### 配置项

这些选项都在 `services.uuremote` 下。

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `package` | 本仓库 UU Remote 包 | 提供已签名 App 和 launchd plist 的包 |

启用后模块会：

1. 把 `UURemote.app` 同步到 `/Applications/UURemote.app`。
2. 安装并重载 LaunchAgent / LaunchDaemon。
3. 给 helper 设 `root:wheel`、`4755`。
4. 只把 `uuyc-cli` 放进系统 PATH。

## 提示

启用模块后，不要再把完整包装进 `environment.systemPackages`。上游 plist 把路径写成 `/Applications/UURemote.app`，只放进 Nix Apps 不够。

关掉模块后，模块只删除自己标记过的安装，不删除手动安装的 UU Remote。
