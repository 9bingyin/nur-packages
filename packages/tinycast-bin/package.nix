{
  lib,
  stdenvNoCC,
  _7zz,
  fetchurl,
  makeBinaryWrapper,
  nix-update-script,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "tinycast-bin";
  version = "0.12.1";

  src = fetchurl {
    url = "https://github.com/abue-ammar/tinycast/releases/download/v${finalAttrs.version}/Tinycast-${finalAttrs.version}.dmg";
    hash = "sha256-6dPaLAobs7gTzkHM5Sk0+9B8BJQWic9Ojli6MoT3lsU=";
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

  passthru.updateScript = nix-update-script {
    extraArgs = [
      ''--version-regex=^v([0-9]+(?:\.[0-9]+)+)$''
      "--use-github-releases"
    ];
  };

  meta = {
    description = "Beta release of Tinycast, a native macOS launcher, hotkeys, and clipboard history";
    homepage = "https://github.com/abue-ammar/tinycast";
    changelog = "https://github.com/abue-ammar/tinycast/releases/tag/v${finalAttrs.version}";
    license = lib.licenses.agpl3Only;
    maintainers = [ lib.maintainers._9bingyin ];
    mainProgram = "tinycast";
    platforms = lib.platforms.darwin;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
})
