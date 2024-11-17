{
	inputs = {
		nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable-small";
		flake-utils.url = "github:numtide/flake-utils";
	};

	outputs = { self, nixpkgs, flake-utils }:
		flake-utils.lib.eachDefaultSystem (system:
			let pkgs = import nixpkgs { inherit system; config = { allowUnfree = true; }; };
			in {
				devShells.default = pkgs.mkShell {
					buildInputs = with pkgs; [
						nodejs_23
						yt-dlp
						google-chrome
					];
					
					shellHook = ''
						export PUPPETEER_EXECUTABLE_PATH="${pkgs.google-chrome}/bin/google-chrome-stable"
						export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1
    				'';
				};
			}
		);
}
