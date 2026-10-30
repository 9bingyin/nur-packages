{
  _7zz,
  lib,
  stdenvNoCC,
  fetchurl,
  makeWrapper,
}:
let
  version = "10.3.0";
  waybackTimestamp = "20261030221201";
in
stdenvNoCC.mkDerivation {
  pname = "termius";
  inherit version;

  src = fetchurl {
    url = "https://web.archive.org/web/${waybackTimestamp}if_/https://autoupdate.termius.com/mac-arm64/Termius.zip";
    hash = "sha512-8cglSUsWW1tWiNMOH5H24H9QOBH53KcJrzlWX3/a16G2PAstsJ+BTB8gdE4FaPBi3Yo7Ut+NFToy7l38bKPKjw==";
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

  passthru.updateScript = ./update.ts;

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
