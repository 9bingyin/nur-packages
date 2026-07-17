# nur-packages

面向 NixOS、nix-darwin 和独立 Flake 使用的个人 [NUR](https://github.com/nix-community/NUR) 软件包仓库。

[![Build and populate cache](https://github.com/9bingyin/nur-packages/actions/workflows/build.yml/badge.svg)](https://github.com/9bingyin/nur-packages/actions/workflows/build.yml)
[![Cachix Cache](https://img.shields.io/badge/cachix-9bingyin-blue.svg)](https://9bingyin.cachix.org)

仓库持续在 `x86_64-linux`、`aarch64-linux` 与 `aarch64-darwin` 上评估；主分支会构建并推送可缓存的软件包。

## 软件包

| 名称 | 说明 | 支持平台 |
| --- | --- | --- |
| [`forge`](packages/forge/package.nix) | GitHub、GitLab、Gitea/Forgejo 和 Bitbucket Cloud 的统一 CLI | 所有已支持平台 |
| [`longbridge`](packages/longbridge/package.nix) | 长桥证券桌面交易平台 | `x86_64-linux`、`aarch64-darwin` |
| [`longbridge-terminal`](packages/longbridge-terminal/package.nix) | 长桥证券的 AI 原生 CLI | 所有已支持平台 |
| [`synthesizer-v-studio-2-pro`](packages/synthesizer-v-studio-2-pro/package.nix) | Synthesizer V Studio 2 Pro | `aarch64-darwin` |
| [`warp`](packages/warp/package.nix) | 为 mihomo 注册 Cloudflare WARP 设备的工具 | Linux |

软件包的描述、主页、许可证、维护者和入口程序均由 Flake 检查强制校验。可用软件包会按当前系统自动筛选：

```bash
nix flake show github:9bingyin/nur-packages
```

## 使用

### 临时运行

不安装即可运行交互式软件包选择器：

```bash
nix run github:9bingyin/nur-packages
```

也可以直接运行指定 CLI：

```bash
nix run github:9bingyin/nur-packages#forge -- --help
nix run github:9bingyin/nur-packages#longbridge-terminal -- --help
```

### 作为 Flake 输入

这是最稳定的方式：软件包使用本仓库锁定的 nixpkgs 构建，可命中本仓库的二进制缓存。

```nix
{
  inputs.nur-packages.url = "github:9bingyin/nur-packages";

  outputs = { nixpkgs, nur-packages, ... }: {
    nixosConfigurations.host = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        ({ pkgs, ... }: {
          environment.systemPackages = with nur-packages.packages.${pkgs.stdenv.hostPlatform.system}; [
            forge
            longbridge-terminal
          ];
        })
      ];
    };
  };
}
```

### 作为 Overlay

`overlays.shared-nixpkgs` 复用使用方的 nixpkgs，避免额外求值；但只有使用与本仓库相同或兼容的 nixpkgs 版本时才能命中缓存。

```nix
{
  inputs.nur-packages.url = "github:9bingyin/nur-packages";

  outputs = { nixpkgs, nur-packages, ... }: {
    nixosConfigurations.host = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        ({ pkgs, ... }: {
          nixpkgs.overlays = [ nur-packages.overlays.shared-nixpkgs ];

          environment.systemPackages = with pkgs.nur-packages; [
            forge
            longbridge-terminal
          ];
        })
      ];
    };
  };
}
```

`overlays.default` 使用本仓库锁定的 nixpkgs 构建；需要优先复用本仓库缓存时可选用它。

### 模块

Flake 同时提供以下模块：

- `nixosModules.mihomo-warp`：`services.mihomo-warp`
- `nixosModules.usque`：`services.usque`
- `darwinModules.synthesizer-v-studio-2-pro`：`programs.synthesizer-v-studio-2-pro`

例如启用 mihomo WARP：

```nix
{
  imports = [ nur-packages.nixosModules.mihomo-warp ];

  services.mihomo-warp.enable = true;
}
```

`usque` 的完整 NixOS 配置示例见 [`modules/nixos/README.md`](modules/nixos/README.md)。

## 二进制缓存

直接通过 `nix run` 使用本仓库时会提示信任 Flake 配置。若作为输入使用，可在使用方显式配置缓存：

```nix
{
  nixConfig = {
    extra-substituters = [
      "https://9bingyin.cachix.org"
      "https://cache.bingyin.org"
    ];
    extra-trusted-public-keys = [
      "9bingyin.cachix.org-1:uXB+kYLEeHo6kpX8NIZtRwwPozYR/JRNRMeFaObkvDo="
      "cache.bingyin.org-1:PU5qCuJfhYPKSIRdOMCndVB6Dn9rRRIRVZAnG2uAPSI="
    ];
  };
}
```

## 开发

```bash
nix develop
nix fmt
nix flake check --impure
```
