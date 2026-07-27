{
  lib,
  buildGoModule,
  fetchFromGitHub,
}:
buildGoModule rec {
  pname = "forge";
  version = "0.7.0";

  src = fetchFromGitHub {
    owner = "git-pkgs";
    repo = "forge";
    rev = "v${version}";
    hash = "sha256-5y6aewFbVbMiJoaGHsgu7YUO0o6TmF6dmXLYmfy9RSY=";
  };

  vendorHash = "sha256-TxnCxsmDC7U/acYQ8VKIYHyHxv2kfitH+oz5I0SfQW4=";

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
