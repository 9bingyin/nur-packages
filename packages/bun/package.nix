{
  lib,
  stdenv,
  stdenvNoCC,
  runCommand,
  callPackage,
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
  gnutar,
  gzip,
  nasm,
  which,
  rustc,
  cargo,
  rustPlatform,
  llvmPackages_21,
  openssl,
  zlib,
  libxml2,
  libiconv,
  icu,
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

  sources = import ./sources.nix { inherit fetchurl; };
  webkit = callPackage ./webkit.nix { inherit version; };
  webkitDownload = {
    name = "webkit";
    url = "https://github.com/oven-sh/WebKit/releases/download/autobuild-${webkit.revision}/bun-webkit-linux-amd64.tar.gz";
    file = webkit;
  };
  downloads = sources.downloads ++ [ webkitDownload ];
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
      ln -s ${download.file} "$out/by-url/${cacheKey download}"
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
    gnutar
    gzip
    unzip
    nasm
    which
    llvmPackages_21.clang
    llvmPackages_21.llvm
    llvmPackages_21.lld
    rustc
    cargo
  ];

  buildInputs = [
    openssl
    zlib
    libxml2
    libiconv
    icu
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
    substituteInPlace scripts/build/codegen.ts \
      --replace-fail 'cd $dir && ''${bun} install --frozen-lockfile && ''${touch} $stamp' \
                     'touch $stamp'
    substituteInPlace scripts/build/rust.ts \
      --replace-fail 'if (tier3 || cfg.release || cfg.asan)' 'if (tier3 || cfg.asan)' \
      --replace-fail 'const rustflags: string[] = [];' 'const rustflags: string[] = ["-Aunknown-lints"];'
    substituteInPlace scripts/build/flags.ts \
      --replace-fail '"-gz=zstd"' '"-gz=zlib"'
    # The source-built WebKit uses nixpkgs ICU instead of bundled static ICU.
    substituteInPlace scripts/build/deps/webkit.ts \
      --replace-fail 'return ["lib/libicudata.a", "lib/libicui18n.a", "lib/libicuuc.a"];' 'return [];'
    substituteInPlace scripts/build/bun.ts \
      --replace-fail 'if (cfg.webkit === "local" && cfg.abi !== "android")' 'if (cfg.abi !== "android")' \
      --replace-fail 'libs.push("-licudata", "-licui18n", "-licuuc");' 'libs.push("-Wl,-rpath,${lib.getLib icu}/lib", "-licudata", "-licui18n", "-licuuc");'
  '';

  preBuild = ''
    cp -R ${nodeModules}/node_modules ./node_modules
    cp -R ${nodeModules}/packages/bun-error/node_modules packages/bun-error/node_modules
    cp -R ${nodeModules}/src/node-fallbacks/node_modules src/node-fallbacks/node_modules
    chmod -R u+w node_modules packages/bun-error/node_modules src/node-fallbacks/node_modules

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
      webkit
      ;
  };

  meta = {
    description = "Fast all-in-one JavaScript runtime, bundler, transpiler, and package manager";
    homepage = "https://bun.sh";
    changelog = "https://bun.sh/blog/bun-v${version}";
    license = with lib.licenses; [
      mit
      lgpl21Only
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
