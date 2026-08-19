{
  lib,
  buildGoModule,
  fetchFromGitHub,
}:
buildGoModule rec {
  pname = "mihomo-alpha";
  version = "0-unstable-2026-08-17";

  src = fetchFromGitHub {
    owner = "MetaCubeX";
    repo = "mihomo";
    rev = "fe22fdd2ccd37915676af3be41434e832e541872";
    hash = "sha256-LuXqvjMS5xzU0RxzKN0NWw4+DeaherliyE8gd6ZLMgU=";
  };

  vendorHash = "sha256-zgZ8ROJMUOUNHsP/NBedhMXBNRXTHrsfua53fIksPgY=";

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
