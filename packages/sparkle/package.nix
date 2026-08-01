{
  lib,
  stdenvNoCC,
  buildNpmPackage,
  fetchFromGitHub,
  fetchPnpmDeps,
  fetchurl,
  cpio,
  electron_43,
  gzip,
  jq,
  makeWrapper,
  nodejs_26,
  pnpmConfigHook,
  pnpm_11,
  rcodesign,
  xar,
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

  resources = stdenvNoCC.mkDerivation {
    pname = "${pname}-resources";
    inherit version;

    src = fetchurl {
      url = "https://github.com/xishang0128/sparkle/releases/download/${version}/sparkle-macos-${version}-arm64.pkg";
      hash = "sha256-DWgF0kPT/FzhAi2q4cWmG7v8reOc0VXcqFo1X82htzc=";
    };

    nativeBuildInputs = [
      cpio
      gzip
      xar
    ];

    dontConfigure = true;
    dontBuild = true;
    dontFixup = true;

    unpackPhase = ''
      runHook preUnpack

      xar -xf "$src"
      gzip -dc sparkle.app.pkg/Payload | cpio -idm --quiet
      find Sparkle.app -name '._*' -delete

      runHook postUnpack
    '';

    installPhase = ''
      runHook preInstall

      mkdir -p "$out"
      cp -R Sparkle.app/Contents/Resources/{files,sidecar} "$out/"

      runHook postInstall
    '';
  };

  # nodejs_24 crashes while pnpm 11 builds its dependency store on aarch64-darwin.
  # Use the current Node.js release until the fixed nodejs_24 reaches nixpkgs.
  pnpm = pnpm_11.override { nodejs-slim = nodejs_26; };

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
buildNpmPackage {
  inherit pname version src;

  patches = [ ./darwin-sidecar-directory.patch ];

  nodejs = nodejs_26;
  npmConfigHook = pnpmConfigHook;
  npmDeps = null;
  inherit pnpmDeps;

  env = {
    ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
    CSC_IDENTITY_AUTO_DISCOVERY = "false";
  };

  nativeBuildInputs = [
    jq
    makeWrapper
    pnpm
    rcodesign
  ];

  postPatch = ''
    RELEASE_VERSION=${lib.escapeShellArg version}
    jq --arg version "$RELEASE_VERSION" '.version = $version' package.json > tmp.json && mv tmp.json package.json

    mkdir -p extra
    cp -R ${resources}/* extra/
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

  doInstallCheck = true;
  installCheckPhase = ''
    test -x "$out/Applications/Sparkle.app/Contents/MacOS/Sparkle"
    test -x "$out/bin/sparkle"
  '';

  passthru = {
    inherit pnpmDeps resources;
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
