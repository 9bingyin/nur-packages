# nur-packages

[![Build Package Cache](https://github.com/9bingyin/nur-packages/actions/workflows/build-cache.yml/badge.svg)](https://github.com/9bingyin/nur-packages/actions/workflows/build-cache.yml)

## 二进制缓存

使用本仓库的 Flake 时会自动配置二进制缓存。作为 Flake input 使用时，在调用方配置中添加：

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
