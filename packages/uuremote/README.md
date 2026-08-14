# UU Remote

网易 UU 远程。仅 `aarch64-darwin`。

只装包没有后台服务。完整能力需要 nix-darwin 模块 `darwinModules.uuremote`。模块还需要 `system.primaryUser`，方便升级后重启用户级 Agent。

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

## 配置项

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `package` | 本仓库 UU Remote 包 | 提供已签名 App 和 launchd plist 的包 |

启用后模块会：

1. 把 `UURemote.app` 同步到 `/Applications/UURemote.app`
2. 安装并重载 LaunchAgent / LaunchDaemon
3. 给 helper 设 `root:wheel`、`4755`
4. 只把 `uuyc-cli` 放进系统 PATH

启用模块后不要再把完整包装进 `environment.systemPackages`。vendor plist 写死了 `/Applications/UURemote.app`，不能只靠 `Nix Apps`。

关掉模块后，只会清带自身管理标记的安装，不会删手动装的 UU Remote。
