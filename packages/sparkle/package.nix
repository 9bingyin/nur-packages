{
  lib,
  stdenvNoCC,
  buildNpmPackage,
  fetchFromGitHub,
  fetchPnpmDeps,
  fetchurl,
  fetchzip,
  cpio,
  gzip,
  makeWrapper,
  nodejs_26,
  pnpmConfigHook,
  pnpm_11,
  rcodesign,
  xar,
}:
let
  pname = "sparkle";
  version = "1.26.6";

  src = fetchFromGitHub {
    owner = "xishang0128";
    repo = "sparkle";
    tag = version;
    hash = "sha256-IFK7rhT3i+Qct0FIEYFbgQpJ5cjS7JMKd2tmOq5ZSNg=";
  };

  electronVersion = "42.4.0";

  electronDist = fetchzip {
    url = "https://github.com/electron/electron/releases/download/v${electronVersion}/electron-v${electronVersion}-darwin-arm64.zip";
    hash = "sha256-tk5uDrymIkA1r0MZ8ROXbUTgB730HJh69FdxzONZczo=";
    stripRoot = false;
  };

  resources = stdenvNoCC.mkDerivation {
    pname = "${pname}-resources";
    inherit version;

    src = fetchurl {
      url = "https://github.com/xishang0128/sparkle/releases/download/${version}/sparkle-macos-${version}-arm64.pkg";
      hash = "sha256-rED86lxwDgURj7ZIk5UKyaQstEhfRNdJkdbfcx/ic18=";
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
    hash = "sha256-+OHO0Rvp33QUDRFjKwDpaIzdciwbsjEwoQxmqd4TouA=";
  };
in
buildNpmPackage {
  inherit pname version src;

  nodejs = nodejs_26;
  npmConfigHook = pnpmConfigHook;
  npmDeps = null;
  inherit pnpmDeps;

  env = {
    ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
    CSC_IDENTITY_AUTO_DISCOVERY = "false";
  };

  nativeBuildInputs = [
    makeWrapper
    pnpm
    rcodesign
  ];

  postPatch = ''
    mkdir -p extra
    cp -R ${resources}/* extra/

    # The optional nix-darwin module installs SetUID copies of the built-in
    # cores outside the Nix store. Keep working without that module installed.
    substituteInPlace src/main/utils/dirs.ts \
      --replace-fail "return path.join(resourcesDir(), 'sidecar')" \
      "return existsSync('/Library/Nix/Sparkle/sidecar') ? '/Library/Nix/Sparkle/sidecar' : path.join(resourcesDir(), 'sidecar')"
  '';

  buildPhase = ''
    runHook preBuild

    cp -R ${electronDist} electron-dist
    chmod -R u+w electron-dist

    pnpm exec electron-vite build
    pnpm exec electron-builder \
      --dir \
      -c.electronDist=electron-dist \
      -c.electronVersion=${electronVersion} \
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
    test ! -L "$out/bin/sparkle"
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
    platforms = platforms.darwin;
    sourceProvenance = with sourceTypes; [
      fromSource
      binaryNativeCode
    ];
  };
}
