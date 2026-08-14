# Synthesizer V Studio 2 Pro

歌声合成软件。仅 `aarch64-darwin`。

插件和 `/Library` 支持文件需要 nix-darwin 模块 `darwinModules.synthesizer-v-studio-2-pro`。

```nix
{
  imports = [ inputs.nur-packages.darwinModules.synthesizer-v-studio-2-pro ];
  programs.synthesizer-v-studio-2-pro.enable = true;
}
```

## 配置项

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `package` | 本仓库包 | 要集成的 Synthesizer V 包 |
| `addToSystemPackages` | `true` | 是否加入 `environment.systemPackages`，由 nix-darwin 管理 `/Applications/Nix Apps` |
| `installStandaloneApp` | `false` | 是否再按 `installMode` 装一份到 `/Applications` |
| `installApplicationSupport` | `true` | 是否安装 Dreamtonics 支持文件到 `/Library/Application Support` |
| `installMode` | `"copy"` | 全局路径用 `copy` 还是 `symlink`。`copy` 更兼容 Spotlight、DAW 扫描和签名检查 |
| `plugins.au` | `true` | 安装 AU / AU ARA |
| `plugins.vst3` | `true` | 安装 VST3 / VST3 ARA |
| `plugins.aax` | `true` | 安装 AAX |
