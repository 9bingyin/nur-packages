{
  packages,
}:
final: _prev: {
  nur-packages = packages.${final.stdenv.hostPlatform.system} or { };
}
