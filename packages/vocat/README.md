# Vocat NixOS 配置

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

## 配置项

以下选项均位于 `services.vocat`：

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `package` | 本仓库 Vocat 包 | 替换软件包 |
| `listenAddress` | `"127.0.0.1"` | 监听地址，IPv6 不带方括号 |
| `port` | `7575` | Web 端口 |
| `openFirewall` | `false` | 放行 Web TCP 端口 |
| `secureCookies` | `false` | Cookie 仅通过 HTTPS 发送，不负责配置 HTTPS |
| `sessionTTL` | `"24h"` | 会话有效期，Go duration 格式，允许 5 分钟至 720 小时 |
| `shutdownTimeout` | `"10s"` | HTTP 优雅退出超时，Go duration 格式，大于 0 且不超过 5 分钟 |
| `maxRequestBodyBytes` | `1048576` | JSON 请求体上限，允许 1024 字节至 10 MiB |
| `initialAdminUsername` | `"admin"` | 初始管理员用户名 |
| `initialAdminPasswordFile` | `null` | 初始密码文件；不设置时需手工初始化管理员 |
| `enablePCSC` | `false` | 为 USB SIM 读卡器启用 `pcscd` |
| `environment` | `{}` | 附加环境变量，不要放秘密，不能覆盖模块管理的配置和数据库路径 |
