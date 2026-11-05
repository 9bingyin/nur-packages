{
  lib,
  buildGoModule,
  fetchFromGitHub,
  nix-update-script,
}:
buildGoModule rec {
  pname = "mihomo-alpha";
  version = "1.19.33-unstable-2026-11-05";

  src = fetchFromGitHub {
    owner = "MetaCubeX";
    repo = "mihomo";
    rev = "9002a4fed399bc77277ceccf9633db1f4a509af7";
    hash = "sha256-RBp4dXMelEKkVGN7h1P2asKIUqS17LGYZ/vOIpXoBoE=";
  };

  vendorHash = "sha256-z4/3MwZ8etQU43YBS47YiZFs87803lt9WY+HPp5FKMY=";

  excludedPackages = [ "./test" ];

  ldflags = [
    "-s"
    "-w"
    "-X github.com/metacubex/mihomo/constant.Version=alpha-${lib.substring 0 7 src.rev}"
  ];

  tags = [ "with_gvisor" ];

  # Tests require network access.
  doCheck = false;

  postInstall = ''
    mv "$out/bin/mihomo" "$out/bin/mihomo-alpha"
  '';

  passthru.updateScript = nix-update-script {
    # Prerelease-Alpha 是跟随 Alpha HEAD 移动的标签，不是版本基数。
    # 仅接受以稳定版本为基数的快照版本，并去掉标签的 v 前缀。
    extraArgs = [
      "--version=branch=Alpha"
      ''--version-regex=^v([0-9]+(?:\.[0-9]+)+-unstable-[0-9]{4}-[0-9]{2}-[0-9]{2})$''
    ];
  };

  meta = with lib; {
    description = "Alpha build of the rule-based tunnel Mihomo";
    homepage = "https://github.com/MetaCubeX/mihomo/tree/Alpha";
    license = licenses.gpl3Only;
    maintainers = [ lib.maintainers._9bingyin ];
    mainProgram = "mihomo-alpha";
    platforms = intersectLists (platforms.linux ++ platforms.darwin) (
      platforms.x86_64 ++ platforms.aarch64
    );
  };
}
