# This file defines tests for all packages in the repository
{ pkgs ? import <nixpkgs> { } }:

let
  nurPkgs = import ./default.nix { inherit pkgs; };

  # Test that a package builds and has correct metadata
  testPackage = name: pkg:
    pkgs.runCommand "test-${name}" { } ''
      # Check that package exists and is a valid derivation
      test -n "${pkg}"

      # Check that package has required metadata
      ${if pkg.meta ? description then ''
        echo "✓ ${name}: has description"
      '' else ''
        echo "✗ ${name}: missing description"
        exit 1
      ''}

      ${if pkg.meta ? license then ''
        echo "✓ ${name}: has license"
      '' else ''
        echo "✗ ${name}: missing license"
        exit 1
      ''}

      ${if pkg.meta ? mainProgram then ''
        echo "✓ ${name}: has mainProgram"
      '' else ''
        echo "✓ ${name}: no mainProgram (might be a library)"
      ''}

      ${if pkg.meta ? platforms then ''
        echo "✓ ${name}: has platforms"
      '' else ''
        echo "✗ ${name}: missing platforms"
        exit 1
      ''}

      mkdir -p $out
      echo "All metadata tests passed for ${name}" > $out/result
    '';

  # Test that a binary package can be executed
  testBinary = name: pkg:
    pkgs.runCommand "test-binary-${name}" {
      buildInputs = [ pkg ];
    } ''
      # Check that the main program exists
      MAIN_PROG="${pkg.meta.mainProgram or name}"

      if command -v "$MAIN_PROG" &> /dev/null; then
        echo "✓ ${name}: binary '$MAIN_PROG' is available in PATH"

        # Try to get version or help (non-critical, some programs might not support it)
        if "$MAIN_PROG" --version &> /dev/null || "$MAIN_PROG" --help &> /dev/null || "$MAIN_PROG" -h &> /dev/null; then
          echo "✓ ${name}: binary responds to --version, --help, or -h"
        else
          echo "⚠ ${name}: binary doesn't respond to common flags (might be expected)"
        fi
      else
        echo "✗ ${name}: binary '$MAIN_PROG' not found in PATH"
        exit 1
      fi

      mkdir -p $out
      echo "Binary tests passed for ${name}" > $out/result
    '';

  # Test installation
  testInstall = name: pkg:
    pkgs.runCommand "test-install-${name}" { } ''
      # Check that key paths exist
      test -d "${pkg}"
      echo "✓ ${name}: package output directory exists"

      ${if pkg.meta ? mainProgram then ''
        test -f "${pkg}/bin/${pkg.meta.mainProgram}"
        echo "✓ ${name}: main program binary exists at ${pkg}/bin/${pkg.meta.mainProgram}"
      '' else ''
        echo "⚠ ${name}: no mainProgram defined, skipping binary check"
      ''}

      mkdir -p $out
      echo "Installation tests passed for ${name}" > $out/result
    '';

in
{
  # Metadata tests for all packages
  metadata = {
    longbridge = testPackage "longbridge" nurPkgs.longbridge;
    ccline = testPackage "ccline" nurPkgs.ccline;
    mfkey-desktop = testPackage "mfkey-desktop" nurPkgs.mfkey-desktop;
  };

  # Binary execution tests
  binaries = {
    # Skip longbridge as it's a GUI app that requires X11
    # longbridge = testBinary "longbridge" nurPkgs.longbridge;
    ccline = testBinary "ccline" nurPkgs.ccline;
    mfkey-desktop = testBinary "mfkey-desktop" nurPkgs.mfkey-desktop;
  };

  # Installation tests
  install = {
    longbridge = testInstall "longbridge" nurPkgs.longbridge;
    ccline = testInstall "ccline" nurPkgs.ccline;
    mfkey-desktop = testInstall "mfkey-desktop" nurPkgs.mfkey-desktop;
  };

  # Combine all tests
  all = pkgs.symlinkJoin {
    name = "all-package-tests";
    paths =
      (pkgs.lib.attrValues metadata) ++
      (pkgs.lib.attrValues binaries) ++
      (pkgs.lib.attrValues install);
  };
}
