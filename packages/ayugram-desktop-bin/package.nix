{
  _7zz,
  cctools,
  darwin,
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

  nativeBuildInputs = [
    _7zz
    cctools
    darwin.sigtool
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

    unpacked="$TMPDIR/AyuGram"
    mkdir "$unpacked"
    7zz x -snld -sns- -o"$unpacked" "$src"

    app="$out/Applications/AyuGram.app"
    mkdir -p "$out/Applications" "$out/bin"
    cp -R "$unpacked/AyuGram.app" "$app"
    codesign --force --sign - "$app/Contents/MacOS/AyuGram"
    makeWrapper "$app/Contents/MacOS/AyuGram" "$out/bin/ayugram-desktop"

    runHook postInstall
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
