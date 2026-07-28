{
  lib,
  stdenvNoCC,
  fetchurl,
  makeWrapper,
  undmg,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "teamspeak6-client";
  version = "6.0.0-beta4.1";

  src = fetchurl {
    url = "https://files.teamspeak-services.com/pre_releases/client/${finalAttrs.version}/teamspeak-client-arm.dmg";
    hash = "sha256-cQf+X1JMLIwoCvf7Ff775B7PtcobbR/pSUNe1UFOfyc=";
    # Cloudflare challenges plain curl/HTTP2; browser-like HTTP/1.1 works.
    curlOptsList = [
      "--http1.1"
      "-A"
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
      "-e"
      "https://www.teamspeak.com/en/downloads/"
    ];
  };

  sourceRoot = ".";

  nativeBuildInputs = [
    makeWrapper
    undmg
  ];

  dontConfigure = true;
  dontBuild = true;
  dontFixup = true;

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/Applications" "$out/bin"
    cp -R TeamSpeak.app "$out/Applications/"
    makeWrapper "$out/Applications/TeamSpeak.app/Contents/MacOS/TeamSpeak" "$out/bin/TeamSpeak"

    runHook postInstall
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    test -x "$out/Applications/TeamSpeak.app/Contents/MacOS/TeamSpeak"
    test ! -L "$out/bin/TeamSpeak"
  '';

  meta = {
    description = "TeamSpeak voice communication tool (beta version)";
    homepage = "https://teamspeak.com/";
    license = lib.licenses.teamspeak;
    mainProgram = "TeamSpeak";
    maintainers = [
      {
        name = "Bingyin";
        github = "9bingyin";
      }
    ];
    platforms = [ "aarch64-darwin" ];
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
})
