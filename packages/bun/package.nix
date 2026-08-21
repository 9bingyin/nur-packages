{
  lib,
  stdenv,
  symlinkJoin,
  makeBinaryWrapper,
  bun-unwrapped,
}:

let
  unwrapped = bun-unwrapped;
in
symlinkJoin {
  pname = "bun";
  inherit (unwrapped) version;

  paths = [ unwrapped ];

  nativeBuildInputs = lib.optionals stdenv.hostPlatform.isLinux [ makeBinaryWrapper ];

  postBuild = lib.optionalString stdenv.hostPlatform.isLinux ''
    wrapProgram "$out/bin/bun" \
      --prefix C_INCLUDE_PATH : "${lib.getDev stdenv.cc.libc}/include" \
      --prefix LIBRARY_PATH : "${lib.getLib stdenv.cc.libc}/lib"

    rm "$out/bin/bunx"
    ln -s bun "$out/bin/bunx"
  '';

  passthru = {
    inherit unwrapped;
    inherit (unwrapped)
      bootstrap
      nodeModules
      buildPrefetch
      cargoDeps
      ;
  };

  meta = unwrapped.meta // {
    priority = (unwrapped.meta.priority or lib.meta.defaultPriority) - 1;
  };
}
