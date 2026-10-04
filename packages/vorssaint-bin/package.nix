{
  lib,
  stdenvNoCC,
  fetchurl,
  _7zz,
  makeBinaryWrapper,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "vorssaint-bin";
  version = "3.4.0";

  src = fetchurl {
    url = "https://github.com/vorssaint/vorssaint-utils/releases/download/v${finalAttrs.version}/Vorssaint-${finalAttrs.version}.dmg";
    hash = "sha256-vsJNkz8rGz2jASPlRGJCbshPEpPtRu33yh8XiIdJZh4=";
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

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/Applications" "$out/bin"
    mv Vorssaint/Vorssaint.app "$out/Applications/"
    makeWrapper "$out/Applications/Vorssaint.app/Contents/MacOS/Vorssaint" "$out/bin/vorssaint"

    runHook postInstall
  '';

  meta = {
    description = "Menu bar toolkit for macOS";
    homepage = "https://github.com/vorssaint/vorssaint-utils";
    changelog = "https://github.com/vorssaint/vorssaint-utils/releases/tag/v${finalAttrs.version}";
    license = lib.licenses.gpl3Only;
    maintainers = [
      {
        name = "Bingyin";
        github = "9bingyin";
      }
    ];
    mainProgram = "vorssaint";
    platforms = [ "aarch64-darwin" ];
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
})
