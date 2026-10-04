{
  lib,
  stdenvNoCC,
  fetchurl,
  unzip,
  makeBinaryWrapper,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "macpacker-bin";
  version = "1.0.0";

  src = fetchurl {
    url = "https://github.com/sarensw/MacPacker/releases/download/v${finalAttrs.version}/MacPacker_v${finalAttrs.version}.zip";
    hash = "sha256-8jNarrdhcl4je9y/Mx88gGijIssFlHRu1ikdwMLAeFI=";
  };

  sourceRoot = ".";

  nativeBuildInputs = [
    unzip
    makeBinaryWrapper
  ];

  dontPatch = true;
  dontConfigure = true;
  dontBuild = true;
  dontFixup = true;

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/Applications" "$out/bin"
    mv MacPacker.app "$out/Applications/"
    makeWrapper "$out/Applications/MacPacker.app/Contents/MacOS/MacPacker" "$out/bin/macpacker"

    runHook postInstall
  '';

  meta = {
    description = "Archive manager and 7zip replacement for macOS";
    homepage = "https://macpacker.app/";
    changelog = "https://github.com/sarensw/MacPacker/releases/tag/v${finalAttrs.version}";
    license = lib.licenses.gpl3Only;
    maintainers = [
      {
        name = "Bingyin";
        github = "9bingyin";
      }
    ];
    mainProgram = "macpacker";
    platforms = [ "aarch64-darwin" ];
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
})
