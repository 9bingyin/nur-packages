{
  lib,
  stdenvNoCC,
  fetchurl,
  _7zz,
  makeBinaryWrapper,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "ladybird-bin";
  version = "2026.47.8";

  src = fetchurl {
    url = "https://download.ladybird.org/macos/${finalAttrs.version}/ladybird-${finalAttrs.version}-macOS-arm64.dmg";
    hash = "sha256-p9m4PpALEAGkrK9ZJpAqbZojnHwmXgHs79JQgxxEmzA=";
  };

  sourceRoot = ".";

  nativeBuildInputs = [
    _7zz
    makeBinaryWrapper
  ];

  unpackPhase = ''
    runHook preUnpack
    7zz x -snld -sns- "$src" >/dev/null
    runHook postUnpack
  '';

  dontPatch = true;
  dontConfigure = true;
  dontBuild = true;
  dontFixup = true;
  dontStrip = true;

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/Applications" "$out/bin"
    cp -R Ladybird.app "$out/Applications/Ladybird.app"
    makeWrapper "$out/Applications/Ladybird.app/Contents/MacOS/Ladybird" "$out/bin/Ladybird"

    runHook postInstall
  '';

  passthru.updateScript = ./update.ts;

  meta = {
    description = "Truly independent web browser";
    homepage = "https://ladybird.org";
    downloadPage = "https://ladybird.org/download/";
    changelog = "https://github.com/LadybirdBrowser/ladybird/releases/tag/${finalAttrs.version}";
    license = lib.licenses.bsd2;
    maintainers = [ lib.maintainers._9bingyin ];
    mainProgram = "Ladybird";
    platforms = lib.platforms.darwin;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
})
