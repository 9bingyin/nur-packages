{
  lib,
  buildGoModule,
  fetchFromGitHub,
}:
buildGoModule rec {
  pname = "forge";
  version = "0.10.0";

  src = fetchFromGitHub {
    owner = "git-pkgs";
    repo = "forge";
    rev = "v${version}";
    hash = "sha256-L0n8fROMUUtTSWIgiPzSJKKO9MhfQKh8NtFbhJTZZNw=";
  };

  vendorHash = "sha256-5LY38XYsNXaR9tMeP4Y3CvN7MWbRgoeg1tpIQEVGmzk=";

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
