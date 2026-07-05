{
  lib,
  buildGoModule,
  fetchFromGitHub,
}:
buildGoModule rec {
  pname = "forge";
  version = "0.6.0";

  src = fetchFromGitHub {
    owner = "git-pkgs";
    repo = "forge";
    rev = "v${version}";
    hash = "sha256-kVKDHcrtXbOqqZoiKb/SxOKbTy2A7oHomlUImkcnxmA=";
  };

  vendorHash = "sha256-sduEepxhOCLk7/YMJbIwtt78Bo9UJ5olb8po7drxPZw=";

  subPackages = [ "cmd/forge" ];

  ldflags = [
    "-s"
    "-w"
    "-X github.com/git-pkgs/forge/internal/cli.Version=${version}"
  ];

  meta = with lib; {
    description = "CLI for working with GitHub, GitLab, Gitea/Forgejo, and Bitbucket Cloud";
    homepage = "https://github.com/git-pkgs/forge";
    license = licenses.mit;
    maintainers = [
      {
        name = "Bingyin";
        github = "9bingyin";
      }
    ];
    mainProgram = "forge";
    platforms = platforms.unix;
  };
}
