{
  lib,
  stdenvNoCC,
  fetchurl,
  makeWrapper,
  unzip,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "grok-bot";
  version = "0.55.0";

  src = fetchurl {
    url = "https://downloads.cursor.com/grokbot/stable/darwin-arm64/${finalAttrs.version}/Grok_Bot_${finalAttrs.version}.zip";
    hash = "sha256-Zu7xFsjjIyIs2BZFQK2jmXG9W/WcxZIjJ1BpryTVxiM=";
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
    cp -R "Grok Bot.app" "$out/Applications/"
    makeWrapper "$out/Applications/Grok Bot.app/Contents/MacOS/Grok Bot" "$out/bin/grok-bot"

    runHook postInstall
  '';

  passthru.updateScript = ./update.ts;

  meta = {
    description = "xAI's official Grok Bot desktop app";
    homepage = "https://x.ai/bot";
    license = lib.licenses.unfree;
    maintainers = [
      {
        name = "Bingyin";
        github = "9bingyin";
      }
    ];
    mainProgram = "grok-bot";
    platforms = [ "aarch64-darwin" ];
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
})
