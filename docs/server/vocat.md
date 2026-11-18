# Vocat

Vocat 是 Quectel EC20/EC25 和中国移动 ML307 蜂窝模组的 Web 控制台。用 NixOS 模块 `nixosModules.vocat` 配置并启动。

## 安装

```nix
{ inputs, ... }:
{
  imports = [ inputs.nur-packages.nixosModules.vocat ];

  nixpkgs.config.allowUnfree = true;

  services.vocat = {
    enable = true;
    initialAdminPasswordFile = "/run/secrets/vocat-admin-password";
  };
}
```

密码文件的首行为初始密码，不要放进 Nix store。已有账号和密码不会改变。初始化后可将 `initialAdminPasswordFile` 设回 `null`，否则每次启动都需要该文件。

## 配置

### 配置项

这些选项都在 `services.vocat` 下。

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `package` | 本仓库 Vocat 包 | 替换软件包 |
| `listenAddress` | `"127.0.0.1"` | 监听地址，IPv6 不带方括号 |
| `port` | `7575` | Web 端口 |
| `openFirewall` | `false` | 放行 Web TCP 端口 |
| `secureCookies` | `false` | Cookie 只通过 HTTPS 发送。模块不配置 HTTPS |
| `sessionTTL` | `"24h"` | 会话有效期，Go duration 格式，允许 5 分钟至 720 小时 |
| `shutdownTimeout` | `"10s"` | 进程退出前等待现有请求结束的时间，Go duration，大于 0 且不超过 5 分钟 |
| `maxRequestBodyBytes` | `1048576` | JSON 请求体上限，允许 1024 字节至 10 MiB |
| `initialAdminUsername` | `"admin"` | 初始管理员用户名 |
| `initialAdminPasswordFile` | `null` | 初始密码文件；不设置时需手工初始化管理员 |
| `enablePCSC` | `false` | 为 USB SIM 读卡器启用 `pcscd` |
| `environment` | `{}` | 附加环境变量，不要放秘密，不能覆盖模块管理的配置和数据库路径 |

## 提示

这个服务里的 sysfs 是只读的。其他系统服务不受影响。QMI Raw-IP 切换、USB 重新授权和驱动重绑要在这个服务外面做。
