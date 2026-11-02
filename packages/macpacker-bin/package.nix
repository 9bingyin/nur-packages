{
  lib,
  stdenvNoCC,
  fetchurl,
  unzip,
  makeBinaryWrapper,
  nix-update-script,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "macpacker-bin";
  version = "1.2.0";

  src = fetchurl {
    url = "https://github.com/sarensw/MacPacker/releases/download/v${finalAttrs.version}/MacPacker_v${finalAttrs.version}.zip";
    hash = "sha256-NjSpBaHpsdKiakjwzGuf2kkQHm5iPGP4UTdPqIa2VqQ=";
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

  passthru.updateScript = nix-update-script {
    extraArgs = [
      ''--version-regex=^v([0-9]+(?:\.[0-9]+)+)$''
      "--use-github-releases"
    ];
  };

  meta = {
    description = "Archive manager and 7zip replacement for macOS";
    homepage = "https://macpacker.app/";
    changelog = "https://github.com/sarensw/MacPacker/releases/tag/v${finalAttrs.version}";
    license = lib.licenses.gpl3Only;
    maintainers = [ lib.maintainers._9bingyin ];
    mainProgram = "macpacker";
    platforms = lib.platforms.darwin;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
})
