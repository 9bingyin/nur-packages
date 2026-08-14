{
  lib,
  stdenvNoCC,
  fetchurl,
  makeWrapper,
}:
let
  version = "9.43.1";
  waybackTimestamp = "20260812184427";
in
stdenvNoCC.mkDerivation {
  pname = "termius";
  inherit version;

  src = fetchurl {
    url = "https://web.archive.org/web/${waybackTimestamp}id_/https://autoupdate.termius.com/mac-arm64/Termius.zip";
    hash = "sha512-w3b8pZD4Hb8fp4mqdKq2bOH4jp6k7T1WEpVJH8WivQoCM3dyluI8M0agiPxvy/NE97WOYIh0/kmPBjXQQ4r6PA==";
  };

  nativeBuildInputs = [ makeWrapper ];

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
    /usr/bin/ditto -x -k "$src" "$unpacked"

    mkdir -p "$out/Applications" "$out/bin"
    /usr/bin/ditto "$unpacked/Termius.app" "$out/Applications/Termius.app"
    makeWrapper \
      "$out/Applications/Termius.app/Contents/MacOS/Termius" \
      "$out/bin/termius-app"

    runHook postInstall
  '';

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
