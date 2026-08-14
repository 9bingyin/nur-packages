# Build this repository's packages against the consumer's nixpkgs. This avoids
# evaluating a second nixpkgs instance, but binary cache hits depend on the
# consumer using a compatible nixpkgs revision.
final: _prev:
let
  packageSet = import ../default.nix { pkgs = final; };

  isSupportedPackage =
    _name: package:
    final.lib.isDerivation package
    && (
      (package.meta.platforms or [ ]) == [ ]
      || final.lib.elem final.stdenv.hostPlatform.system package.meta.platforms
    );
in
{
  nur-packages = final.lib.filterAttrs isSupportedPackage packageSet;
}
