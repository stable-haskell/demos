# Self-documenting Makefile for the miso-wasm-demo container.
#
# Quick start (after running this once locally to verify):
#     make image      # build the image
#     make chess      # build the chess app inside the image
#     make solitaire  # build the solitaire app inside the image
#     make both       # both apps
#     make shell      # interactive shell in the image
#     make clean      # remove host-side out/
#
# In CI, the image is built once (build-image.yml) and the per-app
# workflows (chess.yml, solitaire.yml) just pull it. Locally, the
# Makefile keeps the dev loop fast.

.DEFAULT_GOAL := help
SHELL := /bin/bash

IMAGE    ?= ghcr.io/stable-haskell/miso-wasm-demo
TAG      ?= latest
PLATFORM ?= $(shell uname -m | sed -e 's/x86_64/linux\/amd64/' -e 's/arm64/linux\/arm64/' -e 's/aarch64/linux\/arm64/')

OUT_DIR  := $(CURDIR)/out

# Docker run flags shared by every container invocation.
RUN_FLAGS = --rm \
            --platform $(PLATFORM) \
            -v $(OUT_DIR):/home/builder/out \
            $(IMAGE):$(TAG)

.PHONY: help image chess solitaire both shell pull clean nuke

help:                       ## Show this help.
	@awk 'BEGIN{FS=":.*##"; printf "\n\033[1mTargets:\033[0m\n"} \
	      /^[a-zA-Z_-]+:.*##/ {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}' \
	      $(MAKEFILE_LIST)
	@echo
	@echo "Vars: IMAGE=$(IMAGE) TAG=$(TAG) PLATFORM=$(PLATFORM)"

image:                      ## Build the docker image locally (one-time, ~5 min).
	@mkdir -p $(OUT_DIR)
	docker build \
	  --platform $(PLATFORM) \
	  -t $(IMAGE):$(TAG) \
	  $(CURDIR)

pull:                       ## Pull the published image from ghcr instead of building.
	docker pull --platform $(PLATFORM) $(IMAGE):$(TAG)

chess:                      ## Build haskell-miso/chess.git → out/chess/.
	@mkdir -p $(OUT_DIR)
	docker run $(RUN_FLAGS) chess

solitaire:                  ## Build haskell-miso/solitaire.git → out/solitaire/.
	@mkdir -p $(OUT_DIR)
	docker run $(RUN_FLAGS) solitaire

both:                       ## Build both apps.
	@mkdir -p $(OUT_DIR)
	docker run $(RUN_FLAGS) both

shell:                      ## Interactive shell in the image (for debugging).
	docker run --rm -it \
	  --platform $(PLATFORM) \
	  -v $(OUT_DIR):/home/builder/out \
	  --entrypoint /bin/bash \
	  $(IMAGE):$(TAG)

serve-chess:                ## Serve out/chess/ at http://localhost:8080/.
	@cd $(OUT_DIR)/chess && python3 -m http.server 8080

serve-solitaire:            ## Serve out/solitaire/ at http://localhost:8080/.
	@cd $(OUT_DIR)/solitaire && python3 -m http.server 8080

clean:                      ## Remove ./out/.
	rm -rf $(OUT_DIR)

nuke: clean                 ## Remove ./out AND the local image.
	-docker image rm $(IMAGE):$(TAG)
