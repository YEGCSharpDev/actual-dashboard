{
  description = "Actual Budget Dashboard Dev Shell";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, utils }:
    utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
        };
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs
            git
          ];

          shellHook = ''
            # Fix npm/npx path issues on Nix and isolate from HOME
            export NPM_CONFIG_PREFIX=$PWD/.npm-global
            export PATH=$PWD/.npm-global/bin:$PATH
            export NODE_PATH=$PWD/.npm-global/lib/node_modules:$NODE_PATH
            export npm_config_cache=$PWD/.npm-cache
            export NPM_CONFIG_USERCONFIG=$PWD/.npmrc
            
            # Ensure the full structure exists
            mkdir -p .npm-global/lib .npm-cache

            echo "-------------------------------------------------------"
            echo "🚀 Actual Budget Dashboard Dev Shell Active"
            echo "-------------------------------------------------------"
            echo "✅ Node: $(node --version)"
            echo "✅ NPM:  $(npm --version)"
            echo "-------------------------------------------------------"
          '';
        };
      }
    );
}
