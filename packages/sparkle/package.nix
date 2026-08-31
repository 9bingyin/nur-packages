{
  lib,
  stdenvNoCC,
  buildGoModule,
  fetchFromGitHub,
  fetchPnpmDeps,
  dbip-asn-lite,
  dbip-country-lite,
  electron_43,
  jq,
  makeWrapper,
  mihomo,
  mihomo-alpha,
  nodejs,
  pnpm,
  pnpmConfigHook,
  rcodesign,
  sub-store,
  sub-store-frontend,
  v2ray-domain-list-community,
  v2ray-geoip,
}:
let
  pname = "sparkle";
  version = "1.26.7";

  src = fetchFromGitHub {
    owner = "xishang0128";
    repo = "sparkle";
    tag = version;
    hash = "sha256-R9FVlt0rLxgIpeIJbwoIIYPmpP3LKoRWyt7u4ohbN4E=";
  };

  sparkle-service = buildGoModule {
    pname = "sparkle-service";
    version = "0-unstable-2026-08-30";

    src = fetchFromGitHub {
      owner = "xishang0128";
      repo = "sparkle-service";
      rev = "ad37ea5eda34fa665f2fded47999a85f303a0e6e";
      hash = "sha256-64XK5VzxlYe1Fg2ex7WElAc7tiaf/p24Koard5YsGds=";
    };

    vendorHash = "sha256-akHi2v9HeHCF4TlE9IixJdiIbnwswDyJ9uWcjkZUkYE=";

    meta.mainProgram = "sparkle-service";
  };

  pnpmDeps = fetchPnpmDeps {
    inherit
      pname
      version
      src
      pnpm
      ;
    fetcherVersion = 4;
    hash = "sha256-hSozWInESlJhEjNKbVLgRJG+G7dFgFb+834rugHh05c=";
  };
in
stdenvNoCC.mkDerivation {
  inherit
    pname
    version
    src
    pnpmDeps
    ;

  env = {
    ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
    CSC_IDENTITY_AUTO_DISCOVERY = "false";
  };

  nativeBuildInputs = [
    pnpmConfigHook
    pnpm
    nodejs
    jq
    makeWrapper
    rcodesign
  ];

  postPatch = ''
    RELEASE_VERSION=${lib.escapeShellArg version}
    jq --arg version "$RELEASE_VERSION" '.version = $version' package.json > tmp.json && mv tmp.json package.json

    mkdir -p extra/files extra/sidecar
    cp -R ${sub-store-frontend} extra/files/sub-store-frontend
    install -m 0644 ${sub-store}/share/sub-store/sub-store.bundle.js extra/files/sub-store.bundle.js
    install -m 0644 ${dbip-asn-lite.mmdb} extra/files/ASN.mmdb
    install -m 0644 ${dbip-country-lite.mmdb} extra/files/country.mmdb
    install -m 0644 ${v2ray-geoip}/share/v2ray/geoip.dat extra/files/geoip.dat
    install -m 0644 ${v2ray-domain-list-community}/share/v2ray/geosite.dat extra/files/geosite.dat
    install -m 0755 ${lib.getExe sparkle-service} extra/files/sparkle-service
    install -m 0755 ${lib.getExe mihomo} extra/sidecar/mihomo
    install -m 0755 ${lib.getExe mihomo-alpha} extra/sidecar/mihomo-alpha
  '';

  buildPhase = ''
    runHook preBuild

    cp -R ${electron_43.dist} electron-dist
    chmod -R u+w electron-dist

    pnpm exec electron-vite build
    pnpm exec electron-builder \
      --dir \
      -c.electronDist=electron-dist \
      -c.electronVersion=${electron_43.version} \
      -c.mac.identity=null \
      -c.npmRebuild=false

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/Applications" "$out/bin"
    cp -R dist/mac-arm64/Sparkle.app "$out/Applications/"
    makeWrapper "$out/Applications/Sparkle.app/Contents/MacOS/Sparkle" "$out/bin/sparkle"

    runHook postInstall
  '';

  # Sign the complete bundle after fixup so macOS resources are sealed.
  postFixup = ''
    ${lib.getExe rcodesign} sign "$out/Applications/Sparkle.app"
  '';

  passthru = {
    updateScript = {
      command = ./update.py;
      supportedFeatures = [
        "commit"
        "same-version"
      ];
    };
    inherit
      mihomo-alpha
      pnpmDeps
      sparkle-service
      ;
  };

  meta = with lib; {
    description = "A graphical client for Mihomo";
    homepage = "https://github.com/xishang0128/sparkle";
    license = licenses.gpl3Only;
    maintainers = [
      {
        name = "Bingyin";
        github = "9bingyin";
      }
    ];
    mainProgram = "sparkle";
    platforms = [ "aarch64-darwin" ];
    sourceProvenance = with sourceTypes; [
      fromSource
      binaryNativeCode
    ];
  };
}
