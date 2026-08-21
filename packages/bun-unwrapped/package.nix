{
  lib,
  stdenv,
  stdenvNoCC,
  runCommand,
  fetchFromGitHub,
  fetchurl,
  autoPatchelfHook,
  installShellFiles,
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
  isMusl = stdenv.hostPlatform.isMusl;

  bootstrapAsset =
    if isMusl then
      {
        name = "bun-linux-x64-musl-baseline";
        hash = "sha256-YYxLwflLAjN+4hAAPAt8Bm8RVIqM3FEJ3xDbBD3EfKI=";
      }
    else
      {
        name = "bun-linux-x64-baseline";
        hash = "sha256-GE+0WV8NQBohfPfHjBvEMLqDMU2reouUgFurv3+nCX8=";
      };

  src = fetchFromGitHub {
    owner = "oven-sh";
    repo = "bun";
    rev = "bun-v${version}";
    hash = "sha256-2QSQwXhJDb7HQy/WuYgyWOzyS+Ic1V4VgmIE+xlcaL0=";
  };

  downloads = import ./sources.nix { inherit fetchurl isMusl; };

  # Bun stores prefetched archives under the first 32 characters of SHA-256(url).
  cacheKey = download: builtins.substring 0 32 (builtins.hashString "sha256" download.url);

  bootstrap = stdenvNoCC.mkDerivation {
    pname = "bun-bootstrap";
    inherit version;

    src = fetchurl {
      url = "https://github.com/oven-sh/bun/releases/download/bun-v${version}/${bootstrapAsset.name}.zip";
      inherit (bootstrapAsset) hash;
    };
    sourceRoot = bootstrapAsset.name;

    nativeBuildInputs = [
      unzip
      autoPatchelfHook
    ];
    buildInputs = [
      openssl
      stdenv.cc.cc.lib
    ];

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
  pname = "bun-unwrapped";
  inherit version src;

  # Bun 1.4.0 accepts only LLVM 21.1.x. Recheck this pin when updating Bun.
  nativeBuildInputs = [
    bootstrap
    installShellFiles
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
  dontPatchELF = true;
  hardeningDisable = [ "fortify" ];

  GIT_SHA = revision;
  BUN_NIX_RPATH = "${lib.getLib stdenv.cc.cc}/lib";
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

    # Add the GCC runtime search path while linking so the build-time smoke test
    # and the installed binary use the same path. DT_RPATH also applies to addons.
    substituteInPlace scripts/build/flags.ts \
      --replace-fail \
        '  return { cflags, cxxflags, defines: defs, ldflags, stripflags };' \
        '  const nixRpath = process.env.BUN_NIX_RPATH;
    if (nixRpath) {
      ldflags.push("-Wl,--disable-new-dtags", "-Wl,-rpath," + nixRpath);
    }

    return { cflags, cxxflags, defines: defs, ldflags, stripflags };'

    ${lib.optionalString isMusl ''
      # Bun detects musl through Alpine's marker, which is absent in Nix sandboxes.
      substituteInPlace scripts/build/config.ts \
        --replace-fail 'return existsSync("/etc/alpine-release") ? "musl" : "gnu";' \
                       'return "musl";'
    ''}
  '';

  preBuild = ''
    cp -R "${nodeModules}/node_modules" node_modules
    cp -R "${nodeModules}/packages/bun-error/node_modules" packages/bun-error/node_modules
    cp -R "${nodeModules}/src/node-fallbacks/node_modules" src/node-fallbacks/node_modules
    chmod -R u+w \
      node_modules \
      packages/bun-error/node_modules \
      src/node-fallbacks/node_modules

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
      --abi=${if isMusl then "musl" else "gnu"} \
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

    runHook postInstall
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck

    "$out/bin/bun" --version | grep -Fx '${version}'

    # Runtime, TypeScript and module loading.
    CI=1 "$out/bin/bun" test test/cli/run/run-eval.test.ts

    # Offline workspace installation.
    CI=1 "$out/bin/bun" test test/regression/issue/3192.test.ts

    # Bundling with code splitting.
    CI=1 "$out/bin/bun" test test/regression/issue/5344.test.ts

    # TinyCC compilation and signal handling through bun:ffi.
    CI=1 \
      C_INCLUDE_PATH="${lib.getDev stdenv.cc.libc}/include" \
      LIBRARY_PATH="${lib.getLib stdenv.cc.libc}/lib" \
      "$out/bin/bun" test test/regression/issue/20144/20144.test.ts

    runHook postInstallCheck
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
  };
}
