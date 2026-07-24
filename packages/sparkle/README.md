# Sparkle

[Sparkle](https://github.com/xishang0128/sparkle) 的 Nix 打包版本。应用从上游 Git tag 源码构建；Electron、PNPM 依赖和随应用分发的 Mihomo 运行时资源均由固定哈希锁定。

目前仅支持 Apple Silicon macOS（`aarch64-darwin`）。

在 flake 中使用模块或包之前，先声明输入：

```nix
inputs.nur-packages.url = "github:9bingyin/nur-packages";
```

## 安装与启动

临时启动：

```sh
nix run github:9bingyin/nur-packages#sparkle
```

安装到 Nix profile：

```sh
nix profile install github:9bingyin/nur-packages#sparkle
```

也可以将 `packages.${pkgs.stdenv.hostPlatform.system}.sparkle` 加入 Home Manager 的 `home.packages` 或 nix-darwin 的 `environment.systemPackages`。

普通系统代理模式不需要额外配置。不要对 `/nix/store` 中的 `mihomo` 文件执行 `chmod`、`chown` 或设置 SetUID 位。

## 在 nix-darwin 中启用 TUN

TUN 模式需要以 root 权限创建 `utun` 设备和配置路由，因此需导入本仓库提供的 **nix-darwin 系统模块**。Home Manager 无法安全管理这项特权配置。

下面的配置将应用交给 Home Manager 安装，同时由 nix-darwin 部署其内置 Mihomo Core：

```nix
{ inputs, pkgs, ... }:

let
  sparkle = inputs.nur-packages.packages.${pkgs.stdenv.hostPlatform.system}.sparkle;
in
{
  imports = [
    inputs.nur-packages.darwinModules.sparkle
  ];

  services.sparkle = {
    enable = true;
    package = sparkle;
  };

  home-manager.users.<用户名>.home.packages = [
    sparkle
  ];
}
```

执行 `darwin-rebuild switch` 后，模块会将应用内置的 `mihomo` 和 `mihomo-alpha` 原子部署到：

```text
/Library/Nix/Sparkle/sidecar/
```

两个文件均为 `root:wheel`、`4755`，并在替换前验证代码签名。Sparkle 会优先使用这个受 Nix 管理的目录；找不到该目录时则回退到 App Bundle 中的 `Resources/sidecar`。因此通过 Finder、Dock、Spotlight 或 Home Manager profile 启动应用时，都不依赖环境变量或应用的实际安装目录。

如果不使用 Home Manager，可由模块安装应用本身：

```nix
services.sparkle = {
  enable = true;
  addToSystemPackages = true;
};
```

`addToSystemPackages` 默认是 `false`，以避免与 Home Manager 的应用安装重复。

## 更新

应用及内核由 Nix generation 管理：更新 flake input 或包版本后，执行 `darwin-rebuild switch`（或升级 profile）即可同步更新应用和特权内核副本。不要使用 Sparkle 的应用内更新来替换 Nix 管理的文件。

设置 `services.sparkle.enable = false` 并执行 `darwin-rebuild switch` 后，模块只会移除带有自身管理标记的 `/Library/Nix/Sparkle` 目录。
