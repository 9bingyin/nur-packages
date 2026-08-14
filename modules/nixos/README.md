# NixOS 模块

## usque

Cloudflare WARP MASQUE 客户端。包来自 nixpkgs。

自动注册会改 `/var/lib/usque/config.json`，这时必须 `acceptTerms = true`。已经手动放好有效配置时，可以不触发自动注册。

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

### 配置项

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `package` | `pkgs.usque` | usque 包 |
| `acceptTerms` | `false` | 自动注册时是否传 `--accept-tos` |
| `mode` | `"socks"` | `socks` / `http-proxy` / `nativetun` / `portfw` |
| `listen` | `"127.0.0.1"` | 代理监听地址。仅 socks / http-proxy |
| `port` | `1080` | 代理端口。仅 socks / http-proxy |
| `dns` | Quad9 | netstack 模式 DNS，逗号分隔 |
| `deviceName` | `null` | 注册设备名 |
| `locale` | `"en_US"` | 注册语言 |
| `model` | `"PC"` | 注册设备型号 |
| `jwtFile` | `null` | ZeroTrust JWT 文件 |
| `proxyCredentialsFile` | `null` | 代理认证，文件内容 `username:password`。仅 socks / http-proxy |
| `connectPort` | `443` | MASQUE 连接端口 |
| `ipv6` | `false` | 用 IPv6 连 MASQUE |
| `noTunnelIPv4` | `false` | 关掉隧道 IPv4 |
| `noTunnelIPv6` | `false` | 关掉隧道 IPv6 |
| `sni` | Cloudflare consumer SNI | MASQUE SNI |
| `keepalivePeriod` | `"30s"` | keepalive |
| `mtu` | `1280` | MTU |
| `initialPacketSize` | `null` | 自定义初始包大小。`null` 用 usque v3 自动 PMTU |
| `reconnectDelay` | `"1s"` | 重连间隔 |
| `alwaysReconnect` | `null` | 隧道断开后是否总是重连。`null` 用上游默认 |
| `http2` | `false` | 用 HTTP/2 over TCP+TLS，不用 HTTP/3 over QUIC |
| `insecure` | `false` | 关闭证书 pinning |
| `localDNS` | `false` | 代理 DNS 不走隧道 |
| `systemDNS` | `false` | 配合 `localDNS`，用系统解析器 |
| `udpTimeout` | `"60s"` | SOCKS5 UDP 空闲超时 |
| `interfaceName` | `null` | nativetun 接口名 |
| `noIproute2` | `false` | nativetun 下不设地址、不拉起链路 |
| `persist` | `false` | nativetun 退出后保留接口 |
| `localPorts` | `[]` | portfw 本地映射 |
| `remotePorts` | `[]` | portfw 远端映射 |
| `onConnect` | `null` | 连上后执行的脚本 |
| `onDisconnect` | `null` | 断开后执行的脚本 |
| `extraArgs` | `[]` | 追加原始 usque 参数 |

`portfw` 至少要有一条 `localPorts` 或 `remotePorts`。`nativetun` 会拿 `CAP_NET_ADMIN`，只允许访问 `/dev/net/tun`。路由和 DNS 仍要自己配，需要时用 `onConnect` / `onDisconnect`。
