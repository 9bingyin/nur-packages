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
}:
let
  vivaSrc = fetchFromGitHub {
    owner = "vivaui";
    repo = "viva";
    rev = "467d79a8a53f251cf5d44d09b320739733af36c2";
    hash = "sha256-PbJSU/GfQ0IEh+R6IBYoHgUnhDjw1eJnvx3fpCl37gQ=";
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
  version = "0.4.41";

  src = fetchFromGitHub {
    owner = "t8y2";
    repo = "motty";
    tag = "v${finalAttrs.version}";
    hash = "sha256-FljwN6YKjfZxwy0Bn50DMyEHeKa80VZ7Khsp2UhsSLs=";
  };

  vendorHash = "sha256-TxwNG5ztnkEGfdz6LehhIbz1I8qJ9cr5FuvIfaKBZrc=";

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
      --suffix LD_LIBRARY_PATH : ${lib.makeLibraryPath runtimeLibs}

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
