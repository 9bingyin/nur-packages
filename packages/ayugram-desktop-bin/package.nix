{
  _7zz,
  cctools,
  darwin,
  lib,
  stdenvNoCC,
  fetchurl,
  makeWrapper,
  nix-update-script,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "ayugram-desktop-bin";
  version = "7.2.9";

  src = fetchurl {
    url = "https://github.com/AyuGram/AyuGramDesktop/releases/download/v${finalAttrs.version}/AyuGram.dmg";
    hash = "sha256-tjTkS2R9GJ9lbVTpcOldiv3INx3UtBJJM3MtO5GQels=";
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

  passthru.updateScript = nix-update-script { };

  meta = {
    description = "Desktop Telegram client with good customization and Ghost mode";
    homepage = "https://github.com/AyuGram/AyuGramDesktop";
    changelog = "https://github.com/AyuGram/AyuGramDesktop/releases/tag/v${finalAttrs.version}";
    license = lib.licenses.gpl3Only;
    maintainers = [ lib.maintainers._9bingyin ];
    mainProgram = "ayugram-desktop";
    platforms = lib.platforms.darwin;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
})
