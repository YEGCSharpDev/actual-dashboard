{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  buildInputs = [
    (pkgs.python312.withPackages (ps: with ps; [
      streamlit
      pandas
      altair
      plotly
      python-dateutil
      pytest
      ruff
    ]))
    pkgs.nodejs
  ];

  shellHook = ''
    # Fix npm/npx path issues on Nix
    export NPM_CONFIG_PREFIX=$PWD/.npm-global
    export PATH=$PWD/.npm-global/bin:$PATH
    export NODE_PATH=$PWD/.npm-global/lib/node_modules:$NODE_PATH
    export npm_config_cache=$PWD/.npm-cache
    
    # Ensure the full structure exists
    mkdir -p .npm-global/lib .npm-cache

    echo "Actual Budget Dashboard Dev Shell"
    echo "Python $(python --version)"
    echo "Node $(node --version)"
    
    if ! command -v actual &> /dev/null; then
      echo "Installing sidecar dependencies locally..."
      npm install @actual-app/cli @actual-app/api --quiet
    fi

    echo "Local npm environment initialized in .npm-global"
    echo "Run with: streamlit run app.py"
  '';
}
