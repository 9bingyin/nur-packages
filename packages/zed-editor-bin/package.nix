{
  lib,
  stdenvNoCC,
  fetchurl,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "zed-editor-bin";
  version = "1.14.2";

  src = fetchurl {
    url = "https://github.com/zed-industries/zed/releases/download/v${finalAttrs.version}/Zed-aarch64.dmg";
    hash = "sha256-+d9QH0McDiugKPtvNk1jMvLTFGQXWhHWVn4/WZkP4NI=";
  };

  dontUnpack = true;
  dontPatch = true;
  dontConfigure = true;
  dontBuild = true;
  dontFixup = true;
  dontStrip = true;

  installPhase = ''
    runHook preInstall

    mountPoint="$TMPDIR/Zed"
    mkdir "$mountPoint"
    trap '/usr/bin/hdiutil detach "$mountPoint" -quiet || true' EXIT

    /usr/bin/hdiutil attach -nobrowse -readonly -mountpoint "$mountPoint" "$src" >/dev/null

    mkdir -p "$out/Applications" "$out/bin"
    /usr/bin/ditto "$mountPoint/Zed.app" "$out/Applications/Zed.app"
    ln -s "$out/Applications/Zed.app/Contents/MacOS/cli" "$out/bin/zeditor"

    /usr/bin/hdiutil detach "$mountPoint" -quiet
    trap - EXIT

    runHook postInstall
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    test -x "$out/Applications/Zed.app/Contents/MacOS/zed"
    test -x "$out/Applications/Zed.app/Contents/MacOS/cli"
    test -L "$out/bin/zeditor"
    test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$out/Applications/Zed.app/Contents/Info.plist")" = "${finalAttrs.version}"
    /usr/bin/codesign --verify --deep --strict "$out/Applications/Zed.app"
    /usr/bin/codesign --display --verbose=2 "$out/Applications/Zed.app" 2>&1 \
      | grep -F "TeamIdentifier=MQ55VZLNZQ"
  '';

  meta = {
    description = "High-performance, multiplayer code editor from the creators of Atom and Tree-sitter";
    homepage = "https://zed.dev";
    changelog = "https://zed.dev/releases/stable/${finalAttrs.version}";
    license = lib.licenses.gpl3Only;
    maintainers = [
      {
        name = "Bingyin";
        github = "9bingyin";
      }
    ];
    mainProgram = "zeditor";
    platforms = [ "aarch64-darwin" ];
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
})
