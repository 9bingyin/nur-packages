{
  lib,
  buildGoModule,
  fetchFromGitHub,
  versionCheckHook,
  nix-update-script,
}:
buildGoModule (finalAttrs: {
  pname = "mihomo-smart";
  version = "0-unstable-2026-11-28";

  src = fetchFromGitHub {
    owner = "vernesong";
    repo = "mihomo";
    rev = "d7c67333617e162f698a1339bb0b7fc9aa7547d6";
    hash = "sha256-MdGTZ+uQ5Y8e/DBEQ/I9MoC4/hT5Qy6hjgeMoDcc7DE=";
  };

  vendorHash = "sha256-zvHuyl4NWeZNZhkRxRKTNNCFkVQit02i5B44H66caN8=";

  excludedPackages = [ "./test" ];

  ldflags = [
    "-s"
    "-w"
    "-X github.com/metacubex/mihomo/constant.Version=${finalAttrs.version}"
  ];

  tags = [ "with_gvisor" ];

  # Tests require network access.
  doCheck = false;

  postInstall = ''
    mv "$out/bin/mihomo" "$out/bin/mihomo-smart"
  '';

  nativeInstallCheckInputs = [ versionCheckHook ];
  doInstallCheck = true;
  versionCheckProgramArg = "-v";

  passthru.updateScript = nix-update-script {
    # 仅接受以 0 为基数的分支快照，忽略滚动发布和模型标签。
    extraArgs = [
      "--version=branch=Alpha"
      "--version-regex=^(0-unstable-[0-9]{4}-[0-9]{2}-[0-9]{2})$"
    ];
  };

  meta = {
    description = "Rule-based tunnel with adaptive proxy selection";
    homepage = "https://github.com/vernesong/mihomo/tree/Alpha";
    license = lib.licenses.gpl3Only;
    maintainers = [ lib.maintainers._9bingyin ];
    mainProgram = "mihomo-smart";
    platforms = lib.intersectLists (lib.platforms.linux ++ lib.platforms.darwin) (
      lib.platforms.x86_64 ++ lib.platforms.aarch64
    );
  };
})
