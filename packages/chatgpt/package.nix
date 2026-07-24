{
  lib,
  stdenvNoCC,
  fetchurl,
  makeWrapper,
  unzip,
}:
let
  version = "26.721.41059";
  sources = {
    aarch64-darwin = {
      arch = "arm64";
      hash = "sha256-4rRQVvPR+KuQ9/FiSb+1pA0J0PgJnxLKDY16j9+RCM4=";
    };
    x86_64-darwin = {
      arch = "x64";
      hash = "sha256-8AsJ2eH1E48FX6ly5SQ5kbSTQjxB9deJUdwuIahAifQ=";
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
