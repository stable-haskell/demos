# syntax=docker/dockerfile:1.6
#
# stable-haskell wasm-cross demo image.
#
# Goal: prove that an end-user, starting from a stock Ubuntu container,
# can `ghcup install` our multi-target GHC + dual-compiler cabal and
# build a non-trivial miso wasm app (haskell-miso/chess, haskell-miso/
# solitaire) end-to-end — no nix, no custom shells, just ghcup + apt.
#
# Build:
#   docker build -t stable-haskell/wasm-miso lode/phase8-docker-wasm-miso/
#
# Run a one-shot chess build:
#   docker run --rm -v "$PWD/out:/home/builder/out" stable-haskell/wasm-miso chess
#
# See the sibling Makefile for canonical targets.

FROM ubuntu:24.04

# ---------------------------------------------------------------------
# Toolchain pins. Override at build time with --build-arg MULTI_VER=...
# Both come from https://stable-haskell.github.io/ghc/ghcup-*.yaml.
# ---------------------------------------------------------------------
ARG MULTI_VER=multi-9.14.0.stable.1
ARG CABAL_VER=3.17.0.0.stable.0

# Pinned ghc-wasm-bindists releases. These two tarballs are the *only*
# things we need from ghc-wasm-meta:
#   * wasi-sdk-29.0  — wasm32-unknown-wasi C toolchain (clang/ld/ar/...)
#   * libffi-wasm    — libffi headers + libs for the wasm sysroot
# Everything else in setup.sh (its own GHC, nodejs, binaryen, wasmtime,
# npm modules) is unnecessary because we already have:
#   * a GHC frontend  (multi-target bindist installed below)
#   * node 22          (apt-installed above)
# Skipping setup.sh avoids its FLAVOUR=9.12-on-aarch64-linux path which
# tries to build GHC from source and balloons the image by ~30 GB.
ARG WASI_SDK_RELEASE=20251219T213239
ARG LIBFFI_WASM_RELEASE=20250310T060803

# ---------------------------------------------------------------------
# System packages: ghcup install prerequisites + Node 22 (post-link.mjs
# + TH dynamic-linker shim need import.meta.filename, Node 20.11+).
# ---------------------------------------------------------------------
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential curl git ca-certificates xz-utils file sudo \
      jq unzip zstd patch \
      libffi-dev libffi8 libgmp-dev libgmp10 \
      libncurses-dev libtinfo6 zlib1g-dev libnuma-dev \
      pkg-config \
 && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && node --version | grep -E '^v2[2-9]' \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------
# Non-root build user. ghcup is happiest writing into $HOME.
# ---------------------------------------------------------------------
RUN useradd -m -s /bin/bash builder \
 && echo 'builder ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/builder
USER builder
WORKDIR /home/builder

# ---------------------------------------------------------------------
# ghcup — non-interactive bootstrap. We DO NOT let it install a default
# GHC/cabal here — we want it to fetch only the stable-haskell versions
# from our channels (much smaller closure than vanilla GHC + custom).
# ---------------------------------------------------------------------
ENV BOOTSTRAP_HASKELL_NONINTERACTIVE=1 \
    BOOTSTRAP_HASKELL_MINIMAL=1 \
    BOOTSTRAP_HASKELL_ADJUST_BASHRC=N \
    PATH=/home/builder/.ghcup/bin:/home/builder/.cabal/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

RUN curl -fsSL https://get-ghcup.haskell.org | sh \
 && ghcup --version

# ---------------------------------------------------------------------
# stable-haskell channels:
#   multi-target  -> ghc multi-9.14.0.stable.X (native + wasm + js, one tar)
#   wasm          -> cabal 3.17.0.0.stable.0   (the dual-compiler one)
# Both YAMLs are served from GitHub Pages.
# ---------------------------------------------------------------------
RUN ghcup config add-release-channel \
       https://stable-haskell.github.io/ghc/ghcup-multi-target-0.1.0.yaml \
 && ghcup config add-release-channel \
       https://stable-haskell.github.io/ghc/ghcup-wasm.yaml

# ---------------------------------------------------------------------
# Install + activate multi-target GHC and the dual-compiler cabal.
# These are large downloads (~850 MB GHC tarball + ~50 MB cabal).
# ---------------------------------------------------------------------
RUN ghcup install ghc   "${MULTI_VER}" \
 && ghcup set     ghc   "${MULTI_VER}" \
 && ghc --version \
 && wasm32-unknown-wasi-ghc --version

RUN ghcup install cabal "${CABAL_VER}" \
 && ghcup set     cabal "${CABAL_VER}" \
 && cabal --version

# ---------------------------------------------------------------------
# wasi-sdk: the wasm C toolchain. GHC's wasm32-unknown-wasi-* frontend
# delegates to wasm32-unknown-wasi-clang / wasm-ld / ar for the actual
# wasm linking. We install the same bindist ghc-wasm-meta's setup.sh
# would have fetched (haskell-wasm/ghc-wasm-bindists release) but
# directly, skipping the rest of setup.sh which would otherwise pull a
# whole second GHC + nodejs + binaryen + wasmtime + npm closure (~30 GB
# total, dominated by an aarch64-linux source GHC rebuild we don't
# need).
#
# Naming: bindist installs binaries as `wasm32-wasi-*` (no "unknown").
# GHC's frontend searches for `wasm32-unknown-wasi-*` — so we add the
# alias symlinks the channel-e2e workflow uses.
# ---------------------------------------------------------------------
RUN set -eux \
 && ARCH=$(dpkg --print-architecture) \
 && case "$ARCH" in \
      arm64)  WASI_SDK_TAR=wasi-sdk-aarch64-linux.tar.gz ;; \
      amd64)  WASI_SDK_TAR=wasi-sdk.tar.gz               ;; \
      *) echo "unsupported arch: $ARCH"; exit 1          ;; \
    esac \
 && mkdir -p /home/builder/.ghc-wasm/wasi-sdk \
 && curl -fL --retry 5 \
      "https://github.com/haskell-wasm/ghc-wasm-bindists/releases/download/${WASI_SDK_RELEASE}/${WASI_SDK_TAR}" \
      -o /tmp/wasi-sdk.tar.gz \
 && tar xzf /tmp/wasi-sdk.tar.gz -C /home/builder/.ghc-wasm/wasi-sdk --no-same-owner --strip-components=1 \
 && rm /tmp/wasi-sdk.tar.gz \
 && curl -fL --retry 5 \
      "https://github.com/haskell-wasm/ghc-wasm-bindists/releases/download/${LIBFFI_WASM_RELEASE}/libffi-wasm" \
      -o /tmp/libffi-wasm.zip \
 && unzip -q /tmp/libffi-wasm.zip -d /tmp/libffi-out \
 && cp -a /tmp/libffi-out/out/libffi-wasm/include/. \
      /home/builder/.ghc-wasm/wasi-sdk/share/wasi-sysroot/include/wasm32-wasi/ \
 && cp -a /tmp/libffi-out/out/libffi-wasm/lib/. \
      /home/builder/.ghc-wasm/wasi-sdk/share/wasi-sysroot/lib/wasm32-wasi/ \
 && rm -rf /tmp/libffi-wasm.zip /tmp/libffi-out \
 && WB=/home/builder/.ghc-wasm/wasi-sdk/bin \
 && for t in clang clang++; do ln -sf "$WB/wasm32-wasi-$t"  "$WB/wasm32-unknown-wasi-$t"; done \
 && for t in ar nm ranlib strip; do ln -sf "$WB/llvm-$t" "$WB/wasm32-unknown-wasi-$t" 2>/dev/null || true; done

# ---------------------------------------------------------------------
# `wasm32-wasi-*` aliases for the GHC frontend. The two upstream miso
# repos (chess, solitaire) call `wasm32-wasi-ghc` directly in their
# Makefiles — we ship that name as a symlink to the canonical
# `wasm32-unknown-wasi-*` triple to keep their Makefiles working
# unchanged (we still override cabal.project to use our dual-compiler
# cabal — see build-miso-app.sh).
# ---------------------------------------------------------------------
RUN cd /home/builder/.ghcup/bin \
 && for t in ghc ghc-pkg hsc2hs unlit; do \
      ln -sf "wasm32-unknown-wasi-$t" "wasm32-wasi-$t" 2>/dev/null || true; \
    done

ENV PATH=/home/builder/.ghc-wasm/wasi-sdk/bin:/home/builder/.ghcup/bin:/home/builder/.cabal/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# ---------------------------------------------------------------------
# Pre-warm the cabal Hackage index. Cuts ~30s off every `cabal build`
# in a fresh container.
# ---------------------------------------------------------------------
RUN cabal update

# ---------------------------------------------------------------------
# Entry script + scratch dir for clones. Mount /home/builder/out from
# the host to extract build artefacts.
# ---------------------------------------------------------------------
COPY --chown=builder:builder build-miso-app.sh /home/builder/build-miso-app.sh
COPY --chown=builder:builder index.js.patch    /home/builder/index.js.patch
RUN chmod +x /home/builder/build-miso-app.sh \
 && mkdir -p /home/builder/work /home/builder/out

WORKDIR /home/builder/work
ENTRYPOINT ["/home/builder/build-miso-app.sh"]
CMD ["help"]
