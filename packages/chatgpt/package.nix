{
  lib,
  stdenvNoCC,
  fetchurl,
  makeWrapper,
  unzip,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "chatgpt";
  version = "26.1016.62342";

  src = fetchurl {
    url = "https://persistent.oaistatic.com/codex-app-prod/ChatGPT-darwin-arm64-${finalAttrs.version}.zip";
    hash = "sha256-s+jYC7WtT2I0IW+B5hXbvwQ72a83dOn8qL5Y7k0N8xc=";
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

  passthru.updateScript = ./update.ts;

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
