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
│   ├── index.js.patch       launcher patch (see "The index.js patch" below)
│   └── Makefile             local dev wrapper (make image, make chess, ...)
└── .github/workflows/
    ├── apps.yml             container-path orchestrator: build image + run apps
    ├── _build-app.yml       reusable container-path per-app pipeline
    ├── chess.yml            thin workflow_dispatch + cron wrapper for chess (container)
    ├── solitaire.yml        thin workflow_dispatch + cron wrapper for solitaire (container)
    ├── bare.yml             bare-runner orchestrator: matrix (app × platform)
    ├── _app-bare.yml        reusable bare-runner per-app pipeline (linux + macos)
    └── shellcheck.yml       lint every *.sh / shebang-shell file
```

### Two parallel CI paths

The repo runs the same demo apps through **two independent CI paths**:

| Path | Workflow | Triggered by | What it proves |
|---|---|---|---|
| **container** | `apps.yml` | push, PR, weekly cron, dispatch | The shipped `ghcr.io/.../miso-wasm-demo` image works end-to-end |
| **bare runner** | `bare.yml`  | push (when relevant), weekly cron, dispatch | An end-user on a stock GitHub VM (linux x86_64, linux aarch64, macos arm64) can `ghcup install` the toolchain + drop in wasi-sdk + cabal build the app — no container, no nix |

#### Container DAG (`apps.yml`)

```
       build-image (amd64) ─┐
                            ├─> merge-image ─┬─> chess
       build-image (arm64) ─┘                └─> solitaire
```

`chess` + `solitaire` here are `workflow_call`-style invocations of
`_build-app.yml` (the reusable per-app pipeline), so adding a third
demo app is one new `needs: merge-image` block, not a new ~80-line
workflow. The thin `chess.yml` / `solitaire.yml` wrappers exist so
each app gets a top-level Actions sidebar entry for ad-hoc re-runs
(`workflow_dispatch`) and per-app cron canaries.

PRs run only the image build (no push, no per-app), since the image
isn't in ghcr until the merge lands.

#### Bare-runner matrix (`bare.yml`)

```
chess     × { x86_64-linux | aarch64-linux | aarch64-darwin }
solitaire × { x86_64-linux | aarch64-linux | aarch64-darwin }
```

Each entry is one `workflow_call` invocation of `_app-bare.yml` which
does the literal end-user sequence: `apt`/`brew` deps → Node 22 →
ghcup bootstrap → add stable-haskell channels → `ghcup install ghc
multi-...` + `cabal-...` → direct `wasi-sdk` + `libffi-wasm` download
→ `git clone haskell-miso/<app>` → drop dual-compiler cabal.project.local
→ `cabal build` → apply `miso-wasm-demo/index.js.patch` → smoke-test in
headless chromium. Same patch + same smoke script as the container path.

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

## The `index.js` patch

The upstream `haskell-miso/{chess,solitaire}` launchers (`static/index.js`)
predate the miso 1.11 / GHC 9.14 RTS bring-up contract:

- They pin `@bjorn3/browser_wasi_shim@0.3.0`, but our wasm module needs
  `>= 0.4.2` — the WASI import set drifted between 0.3 and 0.4.
- They call `wasi.initialize(instance)` followed immediately by
  `hs_start()`. GHC 9.14 requires an additional
  `instance.exports.__ghc_wasm_jsffi_init()` call in between — without
  it the RTS panics with `newBoundTask: RTS is not initialised`.

Rather than rewriting `static/index.js` inline in the build script,
the fix is shipped as a real unified-diff patch next to the script —
[`miso-wasm-demo/index.js.patch`](miso-wasm-demo/index.js.patch).
`build-miso-app.sh` applies it with GNU `patch(1)` after staging the
upstream `static/` into the output directory. Once the upstream
launchers update, the patch file can be retired.

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
