{
  _7zz,
  lib,
  stdenvNoCC,
  fetchurl,
  makeWrapper,
}:
let
  version = "10.0.6";
  waybackTimestamp = "20260911035500";
in
stdenvNoCC.mkDerivation {
  pname = "termius";
  inherit version;

  src = fetchurl {
    url = "https://web.archive.org/web/${waybackTimestamp}id_/https://autoupdate.termius.com/mac-arm64/Termius.zip";
    hash = "sha512-ocqzWxlMPsqn/S3we68lVwqf9tsyskLlB3wMMbUyzaGm8zIgLW0C5c4DEligMIeCS1yDpwFv4efjh2i0cmXFRQ==";
  };

  nativeBuildInputs = [
    _7zz
    makeWrapper
  ];

  dontUnpack = true;
  dontPatch = true;
  dontConfigure = true;
  dontBuild = true;
  dontFixup = true;
  dontStrip = true;

  installPhase = ''
    runHook preInstall

    unpacked="$TMPDIR/Termius"
    mkdir "$unpacked"
    7zz x -snld -sns- -o"$unpacked" "$src"

    mkdir -p "$out/Applications" "$out/bin"
    cp -R "$unpacked/Termius.app" "$out/Applications/Termius.app"
    makeWrapper \
      "$out/Applications/Termius.app/Contents/MacOS/Termius" \
      "$out/bin/termius-app"

    runHook postInstall
  '';

  passthru.updateScript = ./update.py;

  meta = {
    description = "Cross-platform SSH client with cloud data sync and more";
    homepage = "https://termius.com/";
    downloadPage = "https://termius.com/download/macos";
    license = lib.licenses.unfree;
    maintainers = [
      {
        name = "Bingyin";
        github = "9bingyin";
      }
    ];
    mainProgram = "termius-app";
    platforms = [ "aarch64-darwin" ];
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
}
