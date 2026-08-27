{
  lib,
  buildGoModule,
  fetchFromGitHub,
}:
buildGoModule rec {
  pname = "mihomo-alpha";
  version = "0-unstable-2026-08-27";

  src = fetchFromGitHub {
    owner = "MetaCubeX";
    repo = "mihomo";
    rev = "061966e79798ae1f953b6d96308738a082b394a5";
    hash = "sha256-SQLNNKDoemdvmHwLC0N0c4n/8aR3Rdy5wCxMpC2/vGY=";
  };

  vendorHash = "sha256-993Rn+vXU4AGofjgYE6GauH40qsk0u030oyKSgZmU4A=";

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

  meta = with lib; {
    description = "Alpha build of the rule-based tunnel Mihomo";
    homepage = "https://github.com/MetaCubeX/mihomo/tree/Alpha";
    license = licenses.gpl3Only;
    maintainers = [
      {
        name = "Bingyin";
        github = "9bingyin";
      }
    ];
    mainProgram = "mihomo-alpha";
  };
}
