{
  lib,
  stdenvNoCC,
  fetchurl,
  makeWrapper,
  unzip,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "chatgpt";
  version = "26.1029.70936";

  src = fetchurl {
    url = "https://persistent.oaistatic.com/codex-app-prod/ChatGPT-darwin-arm64-${finalAttrs.version}.zip";
    hash = "sha256-LM/4A3LvH/Kv2ywUW3CblL1ePfzreahDnhyadYZXNzA=";
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
    description = "Desktop application for ChatGPT";
    homepage = "https://chatgpt.com/";
    license = lib.licenses.unfree;
    maintainers = [ lib.maintainers._9bingyin ];
    mainProgram = "chatgpt";
    platforms = lib.platforms.darwin;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
})
