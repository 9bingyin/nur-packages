{
  lib,
  stdenv,
  stdenvNoCC,
  fetchFromGitHub,
  jdk25,
  makeWrapper,
  gradle_9,
  nodejs,
  pnpm_10,
  fetchPnpmDeps,
  pnpmConfigHook,
}:
stdenv.mkDerivation (finalAttrs: {
  gradle = gradle_9;

  pname = "peerbanhelper";
  version = "9.3.10";

  src = fetchFromGitHub {
    owner = "PBH-BTN";
    repo = "PeerBanHelper";
    rev = "v${finalAttrs.version}";
    hash = "sha256-8QakLztjyIhPfdaPAcL/+ZNzcir4LSzYTwrG8e8IpE8=";
  };

  frontend = stdenvNoCC.mkDerivation {
    pname = "peerbanhelper-webui";
    inherit (finalAttrs) version src;

    sourceRoot = "source/webui";

    nativeBuildInputs = [
      nodejs
      pnpmConfigHook
      pnpm_10
    ];

    pnpmDeps = fetchPnpmDeps {
      pname = "peerbanhelper-webui";
      version = finalAttrs.version;
      src = finalAttrs.src;
      sourceRoot = "source/webui";
      pnpm = pnpm_10;
      fetcherVersion = 1;
      hash = "sha256-1JQBxJ4UcjXssNTC8veoFqgLpE+R4kRv4wCfewn899E=";
    };

    buildPhase = ''
      runHook preBuild

      pnpm build

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      mkdir -p $out
      cp -r dist $out/

      runHook postInstall
    '';
  };

  nativeBuildInputs = [
    finalAttrs.gradle
    makeWrapper
  ];

  buildInputs = [ jdk25 ];

  mitmCache = finalAttrs.gradle.fetchDeps {
    pkg = finalAttrs.finalPackage;
    data = ./deps.json;
  };

  __darwinAllowLocalNetworking = true;

  gradleBuildTask = "jar";

  gradleFlags = [
    "-Dorg.gradle.java.home=${jdk25}"
    "-Dfile.encoding=utf-8"
    "-x"
    "generateGitProperties"
  ];

  preBuild = ''
    mkdir -p src/main/resources/static
    cp -r ${finalAttrs.frontend}/dist/* src/main/resources/static/
    chmod -R u+w src/main/resources/static
  '';

  doCheck = false;

  installPhase = ''
    runHook preInstall

    install -Dm644 build/libs/PeerBanHelper.jar $out/lib/peerbanhelper/PeerBanHelper.jar
    cp -r build/libraries $out/lib/peerbanhelper/

    makeWrapper ${jdk25}/bin/java $out/bin/peerbanhelper \
      --add-flags "-jar $out/lib/peerbanhelper/PeerBanHelper.jar"

    runHook postInstall
  '';

  meta = with lib; {
    description = "Automatically block unwanted and abnormal BT peers";
    homepage = "https://github.com/PBH-BTN/PeerBanHelper";
    license = licenses.gpl3Only;
    maintainers = [
      {
        name = "Bingyin";
        github = "9bingyin";
      }
    ];
    mainProgram = "peerbanhelper";
    platforms = platforms.linux;
    sourceProvenance = with sourceTypes; [
      fromSource
      binaryBytecode
    ];
  };
})
