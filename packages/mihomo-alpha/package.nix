{
  lib,
  buildGoModule,
  fetchFromGitHub,
}:
buildGoModule rec {
  pname = "mihomo-alpha";
  version = "1.19.30-unstable-2026-09-02";

  src = fetchFromGitHub {
    owner = "MetaCubeX";
    repo = "mihomo";
    rev = "810b014ee9c2a577fbda8ecf20deafd53d62566b";
    hash = "sha256-dUm1EUjV9wVzlWc8hpQ5jMv8UoVNWOKpfMrvUw7l4RQ=";
  };

  vendorHash = "sha256-cMdA04mO/xobX6n8b6rrrnX9UsSKDzrtLi8YdwVIRbI=";

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
