{
  lib,
  buildGoModule,
  fetchFromGitHub,
  copyDesktopItems,
  makeBinaryWrapper,
  makeDesktopItem,
  alsa-lib,
  cairo,
  fontconfig,
  glib,
  libkrb5,
  libxcb,
  libxcb-cursor,
  pango,
  vulkan-loader,
  xdg-utils,
  zenity,
}:
let
  vivaSrc = fetchFromGitHub {
    owner = "vivaui";
    repo = "viva";
    rev = "5847af799c3621380b108080d0bd49a057b77014";
    hash = "sha256-KZSa7lbB216cBI/k9zEBYWXXCBqa8Hv+t2UZprRUGzE=";
  };

  runtimeLibs = [
    alsa-lib
    cairo
    fontconfig
    glib
    libkrb5
    libxcb
    libxcb-cursor
    pango
    vulkan-loader
  ];
in
buildGoModule (finalAttrs: {
  pname = "motty";
  version = "0.4.42";

  src = fetchFromGitHub {
    owner = "t8y2";
    repo = "motty";
    tag = "v${finalAttrs.version}";
    hash = "sha256-cfolZCMnVwHNlp5iFXGt0tL2ZHLFHndtdeKsyL5eGnE=";
  };

  vendorHash = "sha256-Hqga8Us80C7/yT7yzi2MfH2G4D5WSvUsyUVeW0UghlQ=";

  subPackages = [ "cmd/motty" ];

  # Upstream Linux builds disable cgo and load system libraries via purego.
  env.CGO_ENABLED = 0;

  ldflags = [
    "-s"
    "-w"
  ];

  nativeBuildInputs = [
    copyDesktopItems
    makeBinaryWrapper
  ];

  # go.mod replaces github.com/vivaui/viva with ../viva.
  postPatch = ''
    cp -r --no-preserve=mode ${vivaSrc} ../viva
  '';

  postInstall = ''
    wrapProgram "$out/bin/motty" \
      --suffix LD_LIBRARY_PATH : ${lib.makeLibraryPath runtimeLibs} \
      --suffix PATH : ${
        lib.makeBinPath [
          xdg-utils
          zenity
        ]
      }

    install -Dm644 assets/icon.png "$out/share/icons/hicolor/1024x1024/apps/motty.png"
    install -Dm644 assets/icon.svg "$out/share/icons/hicolor/scalable/apps/motty.svg"
  '';

  desktopItems = [
    (makeDesktopItem {
      name = "dev.motty.app";
      desktopName = "Motty";
      comment = finalAttrs.meta.description;
      exec = "motty %U";
      icon = "motty";
      categories = [ "System" ];
      keywords = [
        "ssh"
        "terminal"
        "sftp"
        "remote"
      ];
      startupWMClass = "motty";
      mimeTypes = [
        "text/markdown"
        "x-scheme-handler/ssh"
        "x-scheme-handler/telnet"
        "x-scheme-handler/sftp"
        "x-scheme-handler/xshell"
        "x-scheme-handler/xftp"
      ];
    })
  ];

  passthru = {
    inherit vivaSrc;
    updateScript = ./update.ts;
  };

  meta = {
    description = "SSH client with terminal, SFTP, port forwarding and an AI assistant";
    homepage = "https://motty.page";
    changelog = "https://github.com/t8y2/motty/releases/tag/${finalAttrs.src.tag}";
    license = lib.licenses.asl20;
    maintainers = [ lib.maintainers._9bingyin ];
    mainProgram = "motty";
    platforms = lib.intersectLists lib.platforms.linux (lib.platforms.x86_64 ++ lib.platforms.aarch64);
  };
})
