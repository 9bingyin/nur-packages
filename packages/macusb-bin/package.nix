{
  lib,
  stdenvNoCC,
  fetchurl,
  _7zz,
  makeBinaryWrapper,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "macusb-bin";
  version = "2.5";

  src = fetchurl {
    url = "https://github.com/Kruszoneq/macUSB/releases/download/v${finalAttrs.version}/macUSB.${finalAttrs.version}.dmg";
    hash = "sha256-rsAhde0etW0ZZjScP65mMmX4uvvSv+Mo60aisLrGcxw=";
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
    mv macUSB.app "$out/Applications/"
    makeWrapper "$out/Applications/macUSB.app/Contents/MacOS/macUSB" "$out/bin/macusb"

    runHook postInstall
  '';

  meta = {
    description = "All-in-one bootable USB creator for Mac";
    homepage = "https://www.macusb.app/";
    changelog = "https://github.com/Kruszoneq/macUSB/releases/tag/v${finalAttrs.version}";
    license = lib.licenses.mit;
    maintainers = [
      {
        name = "Bingyin";
        github = "9bingyin";
      }
    ];
    mainProgram = "macusb";
    platforms = [ "aarch64-darwin" ];
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
})
