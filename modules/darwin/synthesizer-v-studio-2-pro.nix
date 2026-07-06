{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.programs.synthesizer-v-studio-2-pro;

  libraryPaths =
    lib.optionals cfg.installApplicationSupport [
      "Library/Application Support/Dreamtonics/Synthesizer V Studio 2"
    ]
    ++ lib.optionals cfg.plugins.au [
      "Library/Audio/Plug-Ins/Components/Synthesizer V Studio 2 Pro.component"
      "Library/Audio/Plug-Ins/Components/Synthesizer V Studio 2 ARA Plugin.component"
    ]
    ++ lib.optionals cfg.plugins.vst3 [
      "Library/Audio/Plug-Ins/VST3/Synthesizer V Studio 2 Pro.vst3"
      "Library/Audio/Plug-Ins/VST3/Synthesizer V Studio 2 ARA Plugin.vst3"
      "Library/Audio/Plug-Ins/ARA/Synthesizer V Studio 2 ARA Plugin.vst3"
    ]
    ++ lib.optionals cfg.plugins.aax [
      "Library/Application Support/Avid/Audio/Plug-Ins/Synthesizer V Studio 2 Pro.aaxplugin"
      "Library/Application Support/Avid/Audio/Plug-Ins/Synthesizer V Studio 2 ARA Plugin.aaxplugin"
    ];

  installCommands = lib.concatMapStringsSep "\n" (path: ''
    installPath "$package/${path}" "/${path}"
  '') libraryPaths;
in
{
  options.programs.synthesizer-v-studio-2-pro = {
    enable = lib.mkEnableOption "Synthesizer V Studio 2 Pro macOS integration";

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.callPackage ../../packages/synthesizer-v-studio-2-pro { };
      defaultText = lib.literalExpression "pkgs.callPackage ../../packages/synthesizer-v-studio-2-pro { }";
      description = "The Synthesizer V Studio 2 Pro package to integrate.";
    };

    addToSystemPackages = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = ''
        Add the package to environment.systemPackages so nix-darwin manages the
        application bundle under /Applications/Nix Apps.
      '';
    };

    installStandaloneApp = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = ''
        Also install the application bundle directly at
        /Applications/Synthesizer V Studio 2 Pro.app using installMode.
      '';
    };

    installApplicationSupport = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Install shared Dreamtonics support files into /Library/Application Support.";
    };

    installMode = lib.mkOption {
      type = lib.types.enum [
        "copy"
        "symlink"
      ];
      default = "copy";
      description = ''
        How to place bundles in global macOS locations. Copying is slower and
        duplicates data, but works better with Spotlight, DAW plugin scanners,
        code signing, and macOS privacy checks. Symlinking is smaller and easier
        to inspect, but some macOS components may ignore it.
      '';
    };

    plugins = {
      au = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Install AU and AU ARA plugins into /Library/Audio/Plug-Ins/Components.";
      };

      vst3 = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Install VST3 and VST3 ARA plugins into /Library/Audio/Plug-Ins.";
      };

      aax = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Install AAX plugins into /Library/Application Support/Avid/Audio/Plug-Ins.";
      };
    };
  };

  config = lib.mkIf cfg.enable {
    environment.systemPackages = lib.mkIf cfg.addToSystemPackages [ cfg.package ];

    system.activationScripts.extraActivation.text = lib.mkAfter ''
      echo "setting up Synthesizer V Studio 2 Pro..." >&2

      package=${lib.escapeShellArg cfg.package}
      mode=${lib.escapeShellArg cfg.installMode}

      installPath() {
        local source="$1"
        local target="$2"

        if [ ! -e "$source" ]; then
          echo "missing Synthesizer V Studio 2 Pro source: $source" >&2
          exit 1
        fi

        mkdir -p "$(dirname "$target")"

        if [ "$mode" = "symlink" ]; then
          rm -rf "$target"
          ln -s "$source" "$target"
          return
        fi

        if [ -L "$target" ]; then
          rm "$target"
        fi

        if [ -e "$target" ]; then
          chmod -R u+w "$target" 2>/dev/null || true
        fi

        mkdir -p "$target"
        ${lib.getExe pkgs.rsync} \
          --archive \
          --checksum \
          --delete \
          --copy-unsafe-links \
          --chmod=-w \
          --no-owner \
          --no-group \
          "$source/" "$target/"
      }

      ${lib.optionalString cfg.installStandaloneApp ''
        installPath "$package/Applications/Synthesizer V Studio 2 Pro.app" \
          "/Applications/Synthesizer V Studio 2 Pro.app"
      ''}
      ${installCommands}
    '';
  };
}
