{
  lib,
  stdenvNoCC,
  fetchurl,
  makeWrapper,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "ayugram-desktop-bin";
  version = "7.0.9";

  src = fetchurl {
    url = "https://github.com/AyuGram/AyuGramDesktop/releases/download/v${finalAttrs.version}/AyuGram.dmg";
    hash = "sha256-JEu1AKzPtW8AbVZ4ruzuRTKo6xo9+qolnahzEMs3JB8=";
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

    mountPoint="$TMPDIR/AyuGram"
    mkdir "$mountPoint"
    trap '/usr/bin/hdiutil detach "$mountPoint" -quiet || true' EXIT

    /usr/bin/hdiutil attach -nobrowse -readonly -mountpoint "$mountPoint" "$src" >/dev/null

    app="$out/Applications/AyuGram.app"
    mkdir -p "$out/Applications" "$out/bin"
    /usr/bin/ditto "$mountPoint/AyuGram.app" "$app"
    /usr/bin/codesign --force --deep --sign - "$app"
    makeWrapper "$app/Contents/MacOS/AyuGram" "$out/bin/ayugram-desktop"

    /usr/bin/hdiutil detach "$mountPoint" -quiet
    trap - EXIT

    runHook postInstall
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    app="$out/Applications/AyuGram.app"

    test -x "$app/Contents/MacOS/AyuGram"
    test -x "$out/bin/ayugram-desktop"
    /usr/bin/codesign --verify --deep --strict "$app"
  '';

  meta = {
    description = "Telegram client with ghost mode and message history";
    homepage = "https://github.com/AyuGram/AyuGramDesktop";
    changelog = "https://github.com/AyuGram/AyuGramDesktop/releases/tag/v${finalAttrs.version}";
    license = lib.licenses.gpl3Only;
    maintainers = [
      {
        name = "Bingyin";
        github = "9bingyin";
      }
    ];
    mainProgram = "ayugram-desktop";
    platforms = [ "aarch64-darwin" ];
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
})
