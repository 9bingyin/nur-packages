{
  lib,
  stdenvNoCC,
  fetchurl,
  makeWrapper,
  undmg,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "zen-browser-bin";
  version = "1.22b";

  src = fetchurl {
    url = "https://github.com/zen-browser/desktop/releases/download/${finalAttrs.version}/zen.macos-universal.dmg";
    hash = "sha256-Od0PxAUj/+R0nD6XfhD9bJAF1tEShUIYmRFNrbu/3Zs=";
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

  meta = {
    description = "Zen is a firefox-based browser with the aim of pushing your productivity to a new level!";
    homepage = "https://zen-browser.app/";
    changelog = "https://github.com/zen-browser/desktop/releases/tag/${finalAttrs.version}";
    license = lib.licenses.mpl20;
    maintainers = [
      {
        name = "Bingyin";
        github = "9bingyin";
      }
    ];
    mainProgram = "zen";
    platforms = lib.platforms.darwin;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
})
