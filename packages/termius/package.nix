{
  lib,
  stdenvNoCC,
  fetchurl,
  makeWrapper,
}:
let
  version = "9.43.0";
  waybackTimestamp = "20260810130523";
in
stdenvNoCC.mkDerivation {
  pname = "termius";
  inherit version;

  src = fetchurl {
    url = "https://web.archive.org/web/${waybackTimestamp}id_/https://autoupdate.termius.com/mac-arm64/Termius.zip";
    hash = "sha512-CUzpVCG4DNYsVyiAbvvNtzS0RvCX6g81XUdiORnpiTmf/g1hlAtk7VFrr0jObglVWKMV+V7zgfYSmIfHRkomCA==";
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

  doInstallCheck = true;
  installCheckPhase = ''
    app="$out/Applications/Termius.app"

    test -x "$app/Contents/MacOS/Termius"
    test -x "$out/bin/termius-app"
    test ! -L "$out/bin/termius-app"
    test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist")" = "${version}"
    test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist")" = "com.termius-dmg.mac"
    test "$(/usr/bin/lipo -archs "$app/Contents/MacOS/Termius")" = "arm64"
    /usr/bin/codesign --verify --deep --strict "$app"
    /usr/bin/codesign --display --verbose=2 "$app" 2>&1 \
      | grep -F "TeamIdentifier=6KN952WR85"
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
