{
  lib,
  buildGoModule,
  fetchFromGitHub,
  nix-update-script,
}:
buildGoModule rec {
  pname = "mihomo-alpha";
  version = "1.19.34-unstable-2026-11-11";

  src = fetchFromGitHub {
    owner = "MetaCubeX";
    repo = "mihomo";
    rev = "0455d0d28c4526937380505153e65a843d8612e8";
    hash = "sha256-5sdl+Zodfvo/qaa5zLlj2PaaFoOf3xFScyRLw5a2Oqo=";
  };

  vendorHash = "sha256-29dWXUPyrlzHIxhss8aYuVmb8Wx4rPyNxjT2mmUI/LI=";

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
