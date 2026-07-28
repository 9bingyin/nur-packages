# UU Remote

[网易 UU 远程](https://uuyc.163.com/) 的 Nix 打包版本。从官方 macOS `pkg` 提取 `UURemote.app` 与 launchd 单元，产物哈希固定。

目前仅支持 Apple Silicon macOS（`aarch64-darwin`）。上游安装包为 universal binary。

在 flake 中使用模块或包之前，先声明输入：

```nix
inputs.nur-packages.url = "github:9bingyin/nur-packages";
```

## 安装与启动

临时启动：

```sh
nix run github:9bingyin/nur-packages#uuremote
```

安装到 Nix profile：

```sh
nix profile install github:9bingyin/nur-packages#uuremote
```

也可以将 `packages.${pkgs.stdenv.hostPlatform.system}.uuremote` 加入 Home Manager 的 `home.packages` 或 nix-darwin 的 `environment.systemPackages`。

仅安装应用本身时，后台服务、setuid helper 与系统级 CLI 链接不会生效。完整远程控制能力需要导入本仓库的 **nix-darwin 系统模块**。

## 在 nix-darwin 中启用系统集成

官方安装器会把应用装到 `/Applications`，注册 LaunchAgent / LaunchDaemon，给 helper 设置 setuid，并创建 `/usr/local/bin/uuyc-cli`。这些步骤依赖 root，Home Manager 无法安全管理。

推荐配置：

```nix
{ inputs, pkgs, ... }:

let
  uuremote = inputs.nur-packages.packages.${pkgs.stdenv.hostPlatform.system}.uuremote;
in
{
  imports = [
    inputs.nur-packages.darwinModules.uuremote
  ];

  services.uuremote = {
    enable = true;
    package = uuremote;
    # 默认 true：把 CLI wrapper 加入 PATH
    # addToSystemPackages = true;
    # 默认 false：不在 rebuild 时自动打开应用
    # openOnActivation = false;
  };
}
```

执行 `darwin-rebuild switch` 后，模块会：

1. 将 `UURemote.app` 同步到 `/Applications/UURemote.app`
2. 安装并 bootstrap：
   - `/Library/LaunchAgents/com.netease.uuremote.agent.plist`
   - `/Library/LaunchDaemons/com.netease.uuremote.daemon.plist`
3. 给以下 helper 设置 `root:wheel`、`4755`：
   - `.../XPCServices/UURemoteHelper.xpc/Contents/MacOS/UURemoteHelper`
   - `.../Helpers/UURemoteUpdater.app/.../UURemoteHelper`
4. 创建 `/usr/local/bin/uuyc-cli` 指向 `/Applications` 中的官方 CLI

launchd 单元硬编码 `/Applications/UURemote.app`，因此不能只把 store 路径里的 app 挂到 `Nix Apps`。

## 更新

应用与系统集成由 Nix generation 管理：更新 flake input 或包版本后，执行 `darwin-rebuild switch`（或升级 profile）即可同步。不要使用应用内更新覆盖 Nix 管理的 `/Applications/UURemote.app`。

设置 `services.uuremote.enable = false` 并执行 `darwin-rebuild switch` 后，模块只会清理带有自身管理标记的安装：

- `/Applications/UURemote.app`
- 对应 LaunchAgent / LaunchDaemon
- `/usr/local/bin/uuyc-cli`

不会删除用户手动安装的 UU Remote。
