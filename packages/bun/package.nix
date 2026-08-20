{
  lib,
  stdenv,
  stdenvNoCC,
  runCommand,
  fetchFromGitHub,
  fetchurl,
  autoPatchelfHook,
  installShellFiles,
  makeBinaryWrapper,
  unzip,
  cacert,
  cmake,
  ninja,
  pkg-config,
  python3,
  go,
  libtool,
  automake,
  autoconf,
  ruby,
  perl,
  git,
  nasm,
  which,
  rustc,
  cargo,
  rustPlatform,
  llvmPackages_21,
  openssl,
}:

let
  version = "1.4.0";
  revision = "34cbb9a40b4bd1bd767d134a7065e66c2432a676";

  src = fetchFromGitHub {
    owner = "oven-sh";
    repo = "bun";
    rev = "bun-v${version}";
    hash = "sha256-2QSQwXhJDb7HQy/WuYgyWOzyS+Ic1V4VgmIE+xlcaL0=";
  };

  downloads = import ./sources.nix { inherit fetchurl; };
  cacheKey = download: builtins.substring 0 32 (builtins.hashString "sha256" download.url);

  bootstrap = stdenvNoCC.mkDerivation {
    pname = "bun-bootstrap";
    inherit version;

    src = fetchurl {
      url = "https://github.com/oven-sh/bun/releases/download/bun-v${version}/bun-linux-x64-baseline.zip";
      hash = "sha256-GE+0WV8NQBohfPfHjBvEMLqDMU2reouUgFurv3+nCX8=";
    };
    sourceRoot = "bun-linux-x64-baseline";

    nativeBuildInputs = [
      unzip
      autoPatchelfHook
    ];
    buildInputs = [ openssl ];

    installPhase = ''
      install -Dm755 bun "$out/bin/bun"
    '';
  };

  nodeModules = stdenvNoCC.mkDerivation {
    pname = "bun-node-modules";
    inherit version src;

    nativeBuildInputs = [
      bootstrap
      cacert
    ];
    dontConfigure = true;
    dontFixup = true;

    buildPhase = ''
      export HOME="$TMPDIR/home"
      export BUN_INSTALL_CACHE_DIR="$TMPDIR/bun-cache"
      mkdir -p "$HOME" "$BUN_INSTALL_CACHE_DIR"

      for packageDir in . packages/bun-error src/node-fallbacks; do
        (cd "$packageDir" && bun install --frozen-lockfile)
      done
    '';

    installPhase = ''
      mkdir -p "$out"
      cp -R --parents \
        node_modules \
        packages/bun-error/node_modules \
        src/node-fallbacks/node_modules \
        "$out"
    '';

    outputHashMode = "recursive";
    outputHashAlgo = "sha256";
    outputHash = "sha256-BhtxdGlzP6J/3R0NlGe107dPrEHz9EcEzzGOe1rqOy8=";
  };

  buildPrefetch = runCommand "bun-build-prefetch-${version}" { } ''
    mkdir -p "$out/by-url"
    ${lib.concatMapStringsSep "\n" (download: ''
      ln -s ${download} "$out/by-url/${cacheKey download}"
    '') downloads}
  '';

  cargoDeps = rustPlatform.fetchCargoVendor {
    pname = "bun-cargo-deps";
    inherit version src;
    hash = "sha256-76wxJIJpq2sqDaE9+IH/oBwvt+iXCgG/g8BxEXhx0Hk=";
  };
in
stdenv.mkDerivation {
  pname = "bun";
  inherit version src;

  # Bun 1.4.0 accepts only LLVM 21.1.x. Recheck this pin when updating Bun.
  nativeBuildInputs = [
    bootstrap
    installShellFiles
    makeBinaryWrapper
    cmake
    ninja
    pkg-config
    python3
    go
    libtool
    automake
    autoconf
    ruby
    perl
    git
    unzip
    nasm
    which
    llvmPackages_21.clang
    llvmPackages_21.llvm
    llvmPackages_21.lld
    rustc
    cargo
  ];

  strictDeps = true;
  dontConfigure = true;
  hardeningDisable = [ "fortify" ];

  GIT_SHA = revision;
  RUSTC_BOOTSTRAP = 1;
  BUN_BUILD_PREFETCH_DIR = buildPrefetch;
  CC = lib.getExe llvmPackages_21.clang;
  CXX = lib.getExe' llvmPackages_21.clang "clang++";
  AR = lib.getExe' llvmPackages_21.llvm "llvm-ar";
  RANLIB = lib.getExe' llvmPackages_21.llvm "llvm-ranlib";
  LD = lib.getExe' llvmPackages_21.lld "ld.lld";

  postPatch = ''
    # Dependencies are already provided by the fixed-output nodeModules.
    substituteInPlace scripts/build/codegen.ts \
      --replace-fail 'cd $dir && ''${bun} install --frozen-lockfile && ''${touch} $stamp' \
                     'touch $stamp'
    # nixpkgs Rust uses its prebuilt standard library and supports a different lint set.
    substituteInPlace scripts/build/rust.ts \
      --replace-fail 'if (tier3 || cfg.release || cfg.asan)' 'if (tier3 || cfg.asan)' \
      --replace-fail 'const rustflags: string[] = [];' 'const rustflags: string[] = ["-Aunknown-lints"];'
    # nixpkgs LLVM 21 does not support zstd-compressed debug information.
    substituteInPlace scripts/build/flags.ts \
      --replace-fail '"-gz=zstd"' '"-gz=zlib"'
  '';

  preBuild = ''
    for nodeModulesDir in node_modules packages/bun-error/node_modules src/node-fallbacks/node_modules; do
      cp -R "${nodeModules}/$nodeModulesDir" "$nodeModulesDir"
      chmod -R u+w "$nodeModulesDir"
    done

    export HOME="$TMPDIR/home"
    export BUN_INSTALL="$TMPDIR/bun-install"
    export CARGO_HOME="$TMPDIR/cargo-home"
    export RUSTUP_HOME="$TMPDIR/rustup-home"
    mkdir -p "$HOME" "$BUN_INSTALL" "$CARGO_HOME" "$RUSTUP_HOME"

    substitute ${cargoDeps}/.cargo/config.toml "$CARGO_HOME/config.toml" \
      --replace-fail '@vendor@' '${cargoDeps}'
    cat >> "$CARGO_HOME/config.toml" <<EOF

    [net]
    offline = true
    EOF
  '';

  buildPhase = ''
    runHook preBuild
    bun scripts/build.ts \
      --profile=release \
      --canary=off \
      --static-libatomic=off \
      --cache-dir="$TMPDIR/bun-build-cache" \
      -j"$NIX_BUILD_CORES"
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    install -Dm755 build/release/bun "$out/bin/bun"
    ln -s bun "$out/bin/bunx"
    installShellCompletion --cmd bun \
      --bash completions/bun.bash \
      --fish completions/bun.fish \
      --zsh completions/bun.zsh
    # Support TinyCC and prebuilt native addons on non-FHS systems.
    wrapProgram "$out/bin/bun" \
      --prefix C_INCLUDE_PATH : "${lib.getDev stdenv.cc.libc}/include" \
      --prefix LIBRARY_PATH : "${lib.getLib stdenv.cc.libc}/lib" \
      --prefix LD_LIBRARY_PATH : "${lib.getLib stdenv.cc.cc}/lib"

    runHook postInstall
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    "$out/bin/bun" --version | grep -Fx '${version}'
    "$out/bin/bun" -e 'console.log("bun-ok")' | grep -Fx 'bun-ok'
  '';

  passthru = {
    inherit
      bootstrap
      nodeModules
      buildPrefetch
      cargoDeps
      ;
  };

  meta = {
    homepage = "https://bun.sh";
    changelog = "https://bun.sh/blog/bun-v${version}";
    description = "Incredibly fast JavaScript runtime, bundler, transpiler and package manager – all in one";
    longDescription = ''
      All in one fast and easy-to-use tool. Instead of 1,000 node_modules for development, you only need Bun.
    '';
    sourceProvenance = with lib.sourceTypes; [ binaryNativeCode ];
    license = with lib.licenses; [
      mit # Bun core
      lgpl21Only # JavaScriptCore and WebKit
    ];
    maintainers = [
      {
        name = "Bingyin";
        github = "9bingyin";
      }
    ];
    mainProgram = "bun";
    platforms = [ "x86_64-linux" ];
    # https://github.com/NixOS/nixpkgs/issues/280716
    broken = stdenvNoCC.hostPlatform.isMusl;
  };
}
