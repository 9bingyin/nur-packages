{
  lib,
  buildGoModule,
  fetchFromGitHub,
}:
buildGoModule rec {
  pname = "forge";
  version = "0.8.0";

  src = fetchFromGitHub {
    owner = "git-pkgs";
    repo = "forge";
    rev = "v${version}";
    hash = "sha256-0pdX5jVvoiCmlsdBFFdZnK4kvLJk5YV2MbUObX//Kj4=";
  };

  vendorHash = "sha256-llZ47398Snbfz+bPmM+JO9kQ0sN2zjpCPtwGNkX/9GY=";

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
