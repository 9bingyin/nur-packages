{
  lib,
  stdenvNoCC,
  fetchurl,
  makeWrapper,
  undmg,
  nix-update-script,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "zen-browser-bin";
  version = "1.24.2b";

  src = fetchurl {
    url = "https://github.com/zen-browser/desktop/releases/download/${finalAttrs.version}/zen.macos-universal.dmg";
    hash = "sha256-BO4zwukGtS+Q9zOEqlDoCpJTCuSzQU+yagqYLiV/Fyw=";
  };

  sourceRoot = ".";

  nativeBuildInputs = [
    makeWrapper
    undmg
  ];

  dontConfigure = true;
  dontBuild = true;
  # Preserve the upstream application signature.
  dontFixup = true;

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/Applications" "$out/bin"
    cp -R Zen.app "$out/Applications/"
    makeWrapper "$out/Applications/Zen.app/Contents/MacOS/zen" "$out/bin/zen"

    runHook postInstall
  '';

  passthru.updateScript = nix-update-script { };

  meta = {
    description = "Firefox-based browser aimed at a calmer internet";
    homepage = "https://zen-browser.app/";
    changelog = "https://github.com/zen-browser/desktop/releases/tag/${finalAttrs.version}";
    license = lib.licenses.mpl20;
    maintainers = [ lib.maintainers._9bingyin ];
    mainProgram = "zen";
    platforms = lib.platforms.darwin;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
})
