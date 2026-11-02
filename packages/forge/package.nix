{
  lib,
  buildGoModule,
  fetchFromGitHub,
  nix-update-script,
}:
buildGoModule rec {
  pname = "forge";
  version = "0.10.1";

  src = fetchFromGitHub {
    owner = "git-pkgs";
    repo = "forge";
    rev = "v${version}";
    hash = "sha256-h4sJdNMopRjE8WmNrcClYxUUlchy2ZgRYsKLNAKDhZM=";
  };

  vendorHash = "sha256-/wGFcszJHNzXlAtUAw7aSDneOhlW9pt4yjH/7P0Syp4=";

  subPackages = [ "cmd/forge" ];

  passthru.updateScript = nix-update-script { };

  ldflags = [
    "-s"
    "-w"
    "-X github.com/git-pkgs/forge/internal/cli.Version=${version}"
  ];

  meta = with lib; {
    description = "CLI for working with GitHub, GitLab, Gitea/Forgejo, and Bitbucket Cloud";
    homepage = "https://github.com/git-pkgs/forge";
    license = licenses.mit;
    maintainers = [ lib.maintainers._9bingyin ];
    mainProgram = "forge";
    platforms = intersectLists (platforms.linux ++ platforms.darwin) (
      platforms.x86_64 ++ platforms.aarch64
    );
  };
}
