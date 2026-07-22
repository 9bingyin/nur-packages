{
  lib,
  stdenvNoCC,
  fetchurl,
  makeWrapper,
  unzip,
}:
let
  version = "26.715.72359";
  sources = {
    aarch64-darwin = {
      arch = "arm64";
      hash = "sha256-u1mbwiMxvrtsqF6OlJNDOkldRPRh787ePnBU8yawR+8=";
    };
    x86_64-darwin = {
      arch = "x64";
      hash = "sha256-hAYbCwwURCSx+B2jb7VpZKaoF4b2E6gk2Vkuz3mxRgk=";
    };
  };
  source =
    sources.${stdenvNoCC.hostPlatform.system}
      or (throw "chatgpt: unsupported system ${stdenvNoCC.hostPlatform.system}");
in
stdenvNoCC.mkDerivation {
  pname = "chatgpt";
  inherit version;

  src = fetchurl {
    url = "https://persistent.oaistatic.com/codex-app-prod/ChatGPT-darwin-${source.arch}-${version}.zip";
    inherit (source) hash;
  };

  nativeBuildInputs = [
    makeWrapper
    unzip
  ];

  sourceRoot = ".";
  dontFixup = true;
  doInstallCheck = true;

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/Applications" "$out/bin"
    cp -R ChatGPT.app "$out/Applications/"
    makeWrapper "$out/Applications/ChatGPT.app/Contents/MacOS/ChatGPT" "$out/bin/chatgpt"

    runHook postInstall
  '';

  installCheckPhase = ''
    test ! -L "$out/bin/chatgpt"
  '';

  meta = with lib; {
    description = "OpenAI's official ChatGPT desktop app";
    homepage = "https://chatgpt.com/";
    license = licenses.unfree;
    maintainers = [
      {
        name = "Bingyin";
        github = "9bingyin";
      }
    ];
    mainProgram = "chatgpt";
    platforms = platforms.darwin;
    sourceProvenance = [ sourceTypes.binaryNativeCode ];
  };
}
