{
  lib,
  llvmPackages_21,
  fetchgit,
  cmake,
  ninja,
  pkg-config,
  python3,
  ruby,
  bison,
  gawk,
  perl,
  gnutar,
  gzip,
  icu,
  libxml2,
  zlib,
  version,
}:

let
  revision = "0f966e81b78c84bb23213e391bc679c4ef83e56b";
in
llvmPackages_21.stdenv.mkDerivation {
  name = "bun-webkit-${version}.tar.gz";

  # GitHub does not generate source archives for this large repository.
  src = fetchgit {
    url = "https://github.com/oven-sh/WebKit.git";
    rev = revision;
    hash = "sha256-/K32QNye5n128zagGd4AgoiJqCg+HerVgJ/LggF6YjM=";
    sparseCheckout = [
      "Source/bmalloc"
      "Source/WTF"
      "Source/JavaScriptCore"
      "Source/cmake"
      "Source/ThirdParty/gtest"
      "Source/ThirdParty/unifdef"
      "Tools"
    ];
  };

  nativeBuildInputs = [
    cmake
    ninja
    pkg-config
    python3
    ruby
    bison
    gawk
    perl
    gnutar
    gzip
    llvmPackages_21.llvm
    llvmPackages_21.lld
  ];

  buildInputs = [
    icu
    libxml2
    zlib
  ];

  strictDeps = true;
  dontConfigure = true;
  dontFixup = true;
  hardeningDisable = [ "fortify" ];

  buildPhase = ''
    runHook preBuild

    cmake -S . -B build -G Ninja \
      -DPORT=JSCOnly \
      -DENABLE_STATIC_JSC=ON \
      -DUSE_THIN_ARCHIVES=OFF \
      -DUSE_BUN_JSC_ADDITIONS=ON \
      -DUSE_BUN_EVENT_LOOP=ON \
      -DENABLE_BUN_SKIP_FAILING_ASSERTIONS=ON \
      -DALLOW_LINE_AND_COLUMN_NUMBER_IN_BUILTINS=ON \
      -DENABLE_REMOTE_INSPECTOR=ON \
      -DENABLE_FTL_JIT=ON \
      -DENABLE_MEDIA_SOURCE=OFF \
      -DENABLE_MEDIA_STREAM=OFF \
      -DENABLE_WEB_RTC=OFF \
      -DCMAKE_BUILD_TYPE=RelWithDebInfo \
      -DCMAKE_POSITION_INDEPENDENT_CODE=OFF \
      -DCMAKE_C_FLAGS="-march=nehalem -fno-pic -fno-pie -no-pie" \
      -DCMAKE_CXX_FLAGS="-march=nehalem -fno-pic -fno-pie -no-pie" \
      -DCMAKE_AR=${lib.getExe' llvmPackages_21.llvm "llvm-ar"} \
      -DCMAKE_RANLIB=${lib.getExe' llvmPackages_21.llvm "llvm-ranlib"}

    cmake --build build --target jsc -j"$NIX_BUILD_CORES"

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    package="$TMPDIR/package/bun-webkit"
    mkdir -p \
      "$package/lib" \
      "$package/include/JavaScriptCore" \
      "$package/Source/JavaScriptCore"

    install -Dm644 build/lib/libWTF.a "$package/lib/libWTF.a"
    install -Dm644 build/lib/libJavaScriptCore.a "$package/lib/libJavaScriptCore.a"
    install -Dm644 build/lib/libbmalloc.a "$package/lib/libbmalloc.a"

    find build -maxdepth 1 -name '*.h' -exec cp {} "$package/include/" \;
    find build -maxdepth 1 -name '*.json' -exec cp {} "$package/" \;
    find build/JavaScriptCore/DerivedSources -name '*.h' \
      -exec cp {} "$package/include/JavaScriptCore/" \;
    find build/JavaScriptCore/DerivedSources -name '*.json' \
      -exec cp {} "$package/" \;
    find build/JavaScriptCore/Headers/JavaScriptCore -name '*.h' \
      -exec cp {} "$package/include/JavaScriptCore/" \;
    find build/JavaScriptCore/PrivateHeaders/JavaScriptCore -name '*.h' \
      -exec cp {} "$package/include/JavaScriptCore/" \;

    cp -LR build/WTF/Headers/wtf "$package/include/"
    cp -LR build/bmalloc/Headers/bmalloc "$package/include/"
    cp -R Source/JavaScriptCore/Scripts "$package/Source/JavaScriptCore/"
    cp Source/JavaScriptCore/create_hash_table "$package/Source/JavaScriptCore/"

    tar \
      --sort=name \
      --mtime='@1' \
      --owner=0 \
      --group=0 \
      --numeric-owner \
      -C "$TMPDIR/package" \
      -czf "$out" \
      bun-webkit

    runHook postInstall
  '';

  passthru = {
    inherit revision;
  };
}
