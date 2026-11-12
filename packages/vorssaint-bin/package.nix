{
  lib,
  stdenvNoCC,
  fetchurl,
  _7zz,
  makeBinaryWrapper,
  nix-update-script,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "vorssaint-bin";
  version = "3.4.4";

  src = fetchurl {
    url = "https://github.com/vorssaint/vorssaint-utils/releases/download/v${finalAttrs.version}/Vorssaint-${finalAttrs.version}.dmg";
    hash = "sha256-lSWCRE/mDUYKBFPepzkqW2ZB2Yx51g6Y+fJdMjvbR9M=";
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

  passthru.updateScript = nix-update-script {
    extraArgs = [
      ''--version-regex=^v([0-9]+(?:\.[0-9]+)+)$''
      "--use-github-releases"
    ];
  };

  meta = {
    description = "Menu bar toolkit for macOS";
    homepage = "https://github.com/vorssaint/vorssaint-utils";
    changelog = "https://github.com/vorssaint/vorssaint-utils/releases/tag/v${finalAttrs.version}";
    license = lib.licenses.gpl3Only;
    maintainers = [ lib.maintainers._9bingyin ];
    mainProgram = "vorssaint";
    platforms = lib.platforms.darwin;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
})
