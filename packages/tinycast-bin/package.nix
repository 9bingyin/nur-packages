{
  lib,
  stdenvNoCC,
  _7zz,
  fetchurl,
  makeBinaryWrapper,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "tinycast-bin";
  version = "0.10.0";

  src = fetchurl {
    url = "https://github.com/abue-ammar/tinycast/releases/download/v${finalAttrs.version}/Tinycast-${finalAttrs.version}.dmg";
    hash = "sha256-K5fHDW05E3MmS2PEn0Mlf83ATDKja/uW+K4aJjwxcbg=";
  };

  sourceRoot = ".";

  nativeBuildInputs = [
    _7zz
    makeBinaryWrapper
  ];

  unpackPhase = ''
    runHook preUnpack
    7zz x "$src" >/dev/null
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
    mv Tinycast.app "$out/Applications/"
    makeWrapper "$out/Applications/Tinycast.app/Contents/MacOS/Tinycast" "$out/bin/tinycast"

    runHook postInstall
  '';

  meta = {
    description = "Tiny native macOS launcher with hotkeys and clipboard history";
    homepage = "https://github.com/abue-ammar/tinycast";
    changelog = "https://github.com/abue-ammar/tinycast/releases/tag/v${finalAttrs.version}";
    license = lib.licenses.agpl3Only;
    maintainers = [
      {
        name = "Bingyin";
        github = "9bingyin";
      }
    ];
    mainProgram = "tinycast";
    platforms = [ "aarch64-darwin" ];
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
})
