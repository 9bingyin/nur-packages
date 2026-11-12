{
  lib,
  buildGoModule,
  fetchFromGitHub,
  versionCheckHook,
  nix-update-script,
}:
buildGoModule (finalAttrs: {
  pname = "mihomo-smart";
  version = "0-unstable-2026-11-11";

  src = fetchFromGitHub {
    owner = "vernesong";
    repo = "mihomo";
    rev = "2e6fc107c403ca607714f1613a758e66f12d16e9";
    hash = "sha256-nTrZ6hPCDSDhOYCv7HX9AGDtbxpPqA1ULZZtA+ttYCE=";
  };

  vendorHash = "sha256-DQPwZEZP4nkgchafiPMdP4nd7oFR6U3O5tJTO8Lei4g=";

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
