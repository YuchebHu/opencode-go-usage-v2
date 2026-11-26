UUID := opencode-go-usage-v2@local
EXT_DIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
BIN_DIR := $(HOME)/.local/bin
CLI_NAME := opencode-go-usage-v2
SHELL_EXTENSIONS := org.gnome.Shell.Extensions

.PHONY: all schemas check test install enable reload uninstall pack clean

all: check

schemas:
	glib-compile-schemas --strict schemas

check: schemas
	@for file in extension.js prefs.js scripts/*.js src/*.js src/widgets/*.js src/ui/*.js; do \
		node --check "$$file" || exit 1; \
	done
	@echo "Syntax OK"

test:
	node --test tests/*.test.mjs

install: schemas
	@mkdir -p "$(EXT_DIR)"
	@rm -rf "$(EXT_DIR)/src" "$(EXT_DIR)/schemas" "$(EXT_DIR)/scripts"
	@cp extension.js prefs.js metadata.json stylesheet.css "$(EXT_DIR)/"
	@cp -r src schemas scripts "$(EXT_DIR)/"
	@glib-compile-schemas "$(EXT_DIR)/schemas"
	@mkdir -p "$(BIN_DIR)"
	@printf '#!/bin/sh\nexec gjs -m "%s/scripts/usage-cli.js" "$$@"\n' "$(EXT_DIR)" > "$(BIN_DIR)/$(CLI_NAME)"
	@chmod 755 "$(BIN_DIR)/$(CLI_NAME)"
	@echo "Installed $(UUID) to $(EXT_DIR)"
	@echo "CLI installed: $(BIN_DIR)/$(CLI_NAME)"
	@echo "On Wayland, log out and back in (or restart GNOME Shell) before enabling."

enable:
	-@gdbus call --session --dest $(SHELL_EXTENSIONS) \
		--object-path /org/gnome/Shell/Extensions \
		--method $(SHELL_EXTENSIONS).ReloadExtension "$(UUID)" >/dev/null 2>&1 || true
	-gnome-extensions enable "$(UUID)"

reload:
	-gnome-extensions disable "$(UUID)"
	-gnome-extensions enable "$(UUID)"

uninstall:
	-gnome-extensions disable "$(UUID)"
	rm -rf "$(EXT_DIR)"
	rm -f "$(BIN_DIR)/$(CLI_NAME)"

pack: schemas
	@mkdir -p dist
	@rm -f "dist/$(UUID).shell-extension.zip"
	gnome-extensions pack . \
		--force \
		--out-dir=dist \
		--extra-source=src \
		--extra-source=schemas \
		--extra-source=scripts \
		--extra-source=docs \
		--extra-source=README.md \
		--extra-source=LICENSE

clean:
	rm -rf dist schemas/gschemas.compiled
