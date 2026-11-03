{
  lib,
  stdenvNoCC,
  fetchurl,
  installAgentSkills,
  installShellFiles,
  makeBinaryWrapper,
  openssh,
  versionCheckHook,
  writableTmpDirAsHomeHook,
  nix-update-script,
}:
let
  platform =
    {
      x86_64-linux = "linux-amd64";
      aarch64-linux = "linux-arm64";
      aarch64-darwin = "darwin-arm64";
    }
    .${stdenvNoCC.hostPlatform.system} or (throw "Unsupported platform for instabox-bin");
in
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "instabox-bin";
  version = "0.8.143";

  src = fetchurl {
    url = "https://registry.npmjs.org/instabox/-/instabox-${finalAttrs.version}.tgz";
    hash = "sha256-9bJ81g1mRDZVo6oz9eg1u1stlzGLzzLo5qBco3pip0Y=";
  };

  nativeBuildInputs = [
    installAgentSkills
    installShellFiles
    makeBinaryWrapper
  ];

  dontBuild = true;
  dontStrip = true;

  env.INSTABOX_NO_TELEMETRY = "1";

  installPhase = ''
    runHook preInstall

    install -Dm755 cli/instabox-${platform} "$out/bin/instabox"
    wrapProgram "$out/bin/instabox" \
      --prefix PATH : ${lib.makeBinPath [ openssh ]}

    runHook postInstall
  '';

  postInstall = lib.optionalString (stdenvNoCC.buildPlatform.canExecute stdenvNoCC.hostPlatform) ''
    installShellCompletion --cmd instabox \
      --bash <("$out/bin/instabox" completion bash) \
      --fish <("$out/bin/instabox" completion fish) \
      --zsh <("$out/bin/instabox" completion zsh)
  '';

  nativeInstallCheckInputs = [
    versionCheckHook
    writableTmpDirAsHomeHook
  ];
  doInstallCheck = true;
  versionCheckKeepEnvironment = [
    "HOME"
    "INSTABOX_NO_TELEMETRY"
  ];

  passthru.updateScript = nix-update-script { };

  meta = {
    description = "Cloud box for your coding agent";
    homepage = "https://instabox.sh";
    license = lib.licenses.asl20;
    maintainers = [ lib.maintainers._9bingyin ];
    mainProgram = "instabox";
    platforms = lib.intersectLists (lib.platforms.linux ++ lib.platforms.darwin) (
      lib.platforms.x86_64 ++ lib.platforms.aarch64
    );
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
})
