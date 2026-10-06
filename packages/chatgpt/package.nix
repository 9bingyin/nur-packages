{
  lib,
  stdenvNoCC,
  fetchurl,
  makeWrapper,
  unzip,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "chatgpt";
  version = "26.930.61225";

  src = fetchurl {
    url = "https://persistent.oaistatic.com/codex-app-prod/ChatGPT-darwin-arm64-${finalAttrs.version}.zip";
    hash = "sha256-TZJ7bea0df8kzhX/6x98P1lCihcV48QEhmEEci8a6aM=";
  };

  nativeBuildInputs = [
    makeWrapper
    unzip
  ];

  sourceRoot = ".";
  dontFixup = true;

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/Applications" "$out/bin"
    cp -R ChatGPT.app "$out/Applications/"
    makeWrapper "$out/Applications/ChatGPT.app/Contents/MacOS/ChatGPT" "$out/bin/chatgpt"

    runHook postInstall
  '';

  passthru.updateScript = ./update.py;

  meta = {
    description = "OpenAI's official ChatGPT desktop app";
    homepage = "https://chatgpt.com/";
    license = lib.licenses.unfree;
    maintainers = [
      {
        name = "Bingyin";
        github = "9bingyin";
      }
    ];
    mainProgram = "chatgpt";
    platforms = [ "aarch64-darwin" ];
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
})
