# stable-haskell demos

Working demonstrations of the **stable-haskell** Haskell-to-WebAssembly
toolchain — a multi-target [GHC](https://github.com/stable-haskell/ghc)
+ dual-compiler [cabal](https://github.com/stable-haskell/cabal),
installable via `ghcup`, that lets you build browser-ready wasm apps
without a custom shell.

## What's here

```
demos/
├── miso-wasm-demo/         the docker container
│   ├── Dockerfile           ubuntu + ghcup + multi-target GHC + cabal + wasi-sdk
│   ├── build-miso-app.sh    in-container builder for haskell-miso/<app>.git
│   └── Makefile             local dev wrapper (make image, make chess, ...)
└── .github/workflows/
    ├── build-image.yml      builds + publishes ghcr.io/stable-haskell/miso-wasm-demo
    ├── chess.yml            builds + smoke-tests https://github.com/haskell-miso/chess
    └── solitaire.yml        builds + smoke-tests https://github.com/haskell-miso/solitaire
```

The per-app workflows are chained off `build-image` via `workflow_run`,
so a single push to `main` produces:

```
push -> build-image.yml -> success -> chess.yml + solitaire.yml (parallel)
```

PRs run only `build-image` (no push, no per-app), since the image isn't
in ghcr until the merge lands.

## The image: `ghcr.io/stable-haskell/miso-wasm-demo`

Published as a multi-arch manifest (`linux/amd64` + `linux/arm64`).
Ships:

| component                       | version                          |
| ------------------------------- | -------------------------------- |
| base                            | `ubuntu:24.04`                   |
| node                            | `22.x` (NodeSource)              |
| ghcup                           | latest                           |
| GHC (multi-target)              | `multi-9.14.0.stable.1` — native + `wasm32-unknown-wasi` + `javascript-unknown-ghcjs` |
| cabal (dual-compiler)           | `cabal-3.17.0.0.stable.0`        |
| wasi-sdk                        | `haskell-wasm/ghc-wasm-bindists@20251219T213239` |
| libffi-wasm                     | `haskell-wasm/ghc-wasm-bindists@20250310T060803` |

The container's entrypoint takes the name of a haskell-miso example
app to build:

```sh
docker run --rm -v "$PWD/out:/home/builder/out" \
    ghcr.io/stable-haskell/miso-wasm-demo chess
#    -> $PWD/out/chess/{app.wasm, ghc_wasm_jsffi.js, index.html, ...}
```

Supported app names: `chess`, `solitaire`, `both`.

## How the apps build

`build-miso-app.sh` writes a `cabal.project.local` next to the upstream
project that routes the build through the stable-haskell dual-compiler:

```cabal
with-build-compiler: ghc                       -- native, for Setup.hs and host tools
with-compiler:       wasm32-unknown-wasi-ghc   -- cross, for the actual app
with-hc-pkg:         wasm32-unknown-wasi-ghc-pkg

if arch(wasm32)
  shared: True                                 -- required for wasm TH evaluation
```

then runs `cabal build app`. No `wasm32-wasi-cabal` wrapper, no
`ghc-wasm-meta` — the stable-haskell cabal handles the build-vs-host
toolchain split internally.

After the build, `post-link.mjs` from the wasm GHC's libdir generates
the JSFFI glue (`ghc_wasm_jsffi.js`), and the script stages the
upstream `static/` directory alongside the new `app.wasm`.

## Smoke-testing in CI

The per-app workflows don't just compile the .wasm — they actually
*run* it:

1. Serve the built bundle with `python3 -m http.server`.
2. Launch headless chromium via [playwright](https://playwright.dev/).
3. Wait for the wasm module to instantiate and for miso to mount
   into `<body>`.
4. Fail if there are any unhandled `pageerror`s or fatal
   `console.error` lines.
5. Capture a screenshot and upload it as a workflow artefact.

So a green run means the app *runs*, not just *compiles*.

## Local development

```sh
# In the miso-wasm-demo/ directory:
make image          # one-time, ~5 min
make chess          # -> out/chess/
make solitaire      # -> out/solitaire/
make serve-chess    # http://localhost:8080
```
