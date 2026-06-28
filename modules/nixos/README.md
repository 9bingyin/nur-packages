# NixOS 模块

## usque

`services.usque` 用于以 systemd 服务方式运行
[`usque`](https://github.com/Diniboy1123/usque)。usque 是 MIT 许可证的开源
Cloudflare WARP MASQUE 客户端。模块直接使用 nixpkgs 中的 `pkgs.usque`，不在本仓库
维护单独的 usque 包。

模块运行状态保存在 `/var/lib/usque`：

- `/var/lib/usque/config.json`：usque 账号与隧道配置
- `/var/lib/usque/registration-state`：用于判断是否需要重新自动注册的状态哈希

自动注册由 `usque-register.service` 处理，主服务是 `usque.service`。

### 基础 SOCKS 代理

```nix
{
  services.usque = {
    enable = true;
    acceptTerms = true;
    mode = "socks";
    listen = "127.0.0.1";
    port = 1080;
  };
}
```

当模块需要自动创建或替换 `/var/lib/usque/config.json` 时，必须设置
`acceptTerms = true`。如果你已经手动放置了有效的 `config.json`，服务可以在不触发自动
注册的情况下启动。

### HTTP 代理

```nix
{
  services.usque = {
    enable = true;
    acceptTerms = true;
    mode = "http-proxy";
    listen = "127.0.0.1";
    port = 8000;
  };
}
```

### 代理认证与 ZeroTrust

把 ZeroTrust JWT token 放进文件，然后通过 `jwtFile` 引入：

```nix
{
  services.usque = {
    enable = true;
    acceptTerms = true;
    jwtFile = "/run/secrets/usque-jwt";
  };
}
```

代理认证使用 `proxyCredentialsFile`，文件内容格式为 `username:password`：

```nix
{
  services.usque = {
    enable = true;
    acceptTerms = true;
    proxyCredentialsFile = "/run/secrets/usque-proxy";
  };
}
```

`/run/secrets/usque-proxy` 示例：

```sh
proxy-user:proxy-password
```

### HTTP/2 回退

usque v3 支持使用 HTTP/2 over TCP+TLS，而不是 HTTP/3 over QUIC：

```nix
{
  services.usque = {
    enable = true;
    acceptTerms = true;
    http2 = true;
  };
}
```

### Native TUN 模式

Native TUN 模式会创建内核 TUN 接口，需要 `CAP_NET_ADMIN`。模块只会在
`mode = "nativetun"` 时授予这个 capability，并只允许访问 `/dev/net/tun`。

```nix
{
  services.usque = {
    enable = true;
    acceptTerms = true;
    mode = "nativetun";
    interfaceName = "usque0";
  };
}
```

usque 会创建接口并分配隧道地址，但路由和 DNS 策略仍然需要你自行处理。需要自动设置
路由或 DNS 时，可以使用 `onConnect` 和 `onDisconnect` 指向幂等脚本。

### 端口转发模式

`portfw` 至少需要一个本地或远端映射：

```nix
{
  services.usque = {
    enable = true;
    acceptTerms = true;
    mode = "portfw";
    localPorts = [
      "127.0.0.1:8080:100.96.0.2:8080"
    ];
  };
}
```

### 常用选项

- `dns`：netstack 模式使用的 DNS 服务器，逗号分隔
- `sni`：MASQUE SNI，默认是 `consumer-masque.cloudflareclient.com`
- `ipv6`：使用 IPv6 连接 MASQUE endpoint
- `noTunnelIPv4` 和 `noTunnelIPv6`：禁用隧道内对应地址族
- `http2`：使用 HTTP/2 over TCP+TLS
- `localDNS`：代理 DNS 不走隧道
- `systemDNS`：配合 `localDNS` 使用系统解析器，而不是 `dns` 指定的服务器
- `alwaysReconnect`：设置为 `true` 或 `false` 以覆盖上游默认重连行为
- `extraArgs`：追加模块尚未建模的 usque 原始参数

### 运维命令

查看注册日志：

```sh
journalctl -u usque-register.service
```

查看主服务日志：

```sh
journalctl -u usque.service
```

重启隧道：

```sh
systemctl restart usque.service
```

删除状态文件并强制重新自动注册：

```sh
systemctl stop usque.service usque-register.service
rm -f /var/lib/usque/config.json /var/lib/usque/registration-state
systemctl start usque.service
```
