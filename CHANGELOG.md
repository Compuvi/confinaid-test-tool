## [0.5.1](https://github.com/Compuvi/confinaid-test-tool/compare/v0.5.0...v0.5.1) (2026-09-30)

### Bug Fixes

* **batch:** extract bulk testing into dedicated page with major improvements ([2b5d6eb](https://github.com/Compuvi/confinaid-test-tool/commit/2b5d6ebb30370697442f01a63c02c11cce07f227))

## [0.5.0](https://github.com/Compuvi/confinaid-test-tool/compare/v0.4.0...v0.5.0) (2026-09-29)

### Features

* add JSON syntax highlighting across all JSON editors and viewers ([656f2fd](https://github.com/Compuvi/confinaid-test-tool/commit/656f2fdfbdc9f71313f52344708af8829b11760b))
* **charts:** add hover tooltips + apply matching dark-navy style to both charts ([4304dec](https://github.com/Compuvi/confinaid-test-tool/commit/4304dec06e2a260a460b1c5dd8aee7e205a7a808)), closes [#0d1b2e](https://github.com/Compuvi/confinaid-test-tool/issues/0d1b2e) [#0d1b2e](https://github.com/Compuvi/confinaid-test-tool/issues/0d1b2e) [#0d1b2e](https://github.com/Compuvi/confinaid-test-tool/issues/0d1b2e)
* **charts:** migrate to recharts, full date range, match frontend 1:1 ([1d067bf](https://github.com/Compuvi/confinaid-test-tool/commit/1d067bf13721d13cc4040081b61a2b017980ed34)), closes [#0d1b2e](https://github.com/Compuvi/confinaid-test-tool/issues/0d1b2e) [#dc2626](https://github.com/Compuvi/confinaid-test-tool/issues/dc2626) [#5b7a9e](https://github.com/Compuvi/confinaid-test-tool/issues/5b7a9e)
* **load:** add contextual help tooltips to every input field ([a4dd7ee](https://github.com/Compuvi/confinaid-test-tool/commit/a4dd7eec4cb5bc42b17fbe05fde2198fd7203e52))
* **load:** free-form NumberInput editing + request delay field ([61a09c8](https://github.com/Compuvi/confinaid-test-tool/commit/61a09c8ef784dce2abf7ae38985bed4890ce147a))
* **monitoring:** add hover tooltip to API traffic chart ([1a947aa](https://github.com/Compuvi/confinaid-test-tool/commit/1a947aaaafd558521d27ee8b10148aa8fecac49d))
* **reports,monitoring:** add Last hour date filter preset ([1a53798](https://github.com/Compuvi/confinaid-test-tool/commit/1a53798d37df35eb900ed9c5da8aaf787de000ba))
* **reports:** add Load & Rate Limit history tab ([d5cc144](https://github.com/Compuvi/confinaid-test-tool/commit/d5cc1447afdf00c3670a57cf3ff9eb4cbd895f81))
* **reports:** redesign API Traffic chart to match frontend style ([b2939e3](https://github.com/Compuvi/confinaid-test-tool/commit/b2939e389d8aca54eac3d535137a5d7114423b17)), closes [#0d1b2e](https://github.com/Compuvi/confinaid-test-tool/issues/0d1b2e)
* **requests:** lock Token credential fields when profile is active ([2445c46](https://github.com/Compuvi/confinaid-test-tool/commit/2445c4651a83fbe71030be288e6214d4521de057))
* **suites:** data-driven testing, case import, and parallel execution ([00453ca](https://github.com/Compuvi/confinaid-test-tool/commit/00453ca6e86a72885ac65fb51cd527e729ab4a50))
* **suites:** stop button, skip/disable, bail mode, response viewer, duplicate, variable capture ([f8125f3](https://github.com/Compuvi/confinaid-test-tool/commit/f8125f331fcff6f4419952b4c807ab5ee17e3530))

### Bug Fixes

* add fs scope for user-selected paths and surface write errors with toast ([aa3f6e7](https://github.com/Compuvi/confinaid-test-tool/commit/aa3f6e7ae29aca8f76bcb8148aeffcb00f0d661f))
* **charts:** drop ChartContainer wrapper, use recharts primitives directly ([bcf7347](https://github.com/Compuvi/confinaid-test-tool/commit/bcf7347736df4b44434a90af23dc5183e6e1f1a6))
* **ci:** move @reduxjs/toolkit override to pnpm-workspace.yaml ([9feaa43](https://github.com/Compuvi/confinaid-test-tool/commit/9feaa4396b1e4a02e9758a3bbb5d5d742bf69513))
* **ci:** pin @reduxjs/toolkit to 2.12.0 to pass supply-chain policy ([81eaaf6](https://github.com/Compuvi/confinaid-test-tool/commit/81eaaf61f7e9edc21b5feb554bb7fa733ab7857a))
* **load:** persist last run stats across navigation ([f5748dc](https://github.com/Compuvi/confinaid-test-tool/commit/f5748dc7fb4fc0bf1d01d52f212fd5fca0574fdc))
* **reports:** show endpoint badge in suite run history case table ([1044aad](https://github.com/Compuvi/confinaid-test-tool/commit/1044aad9a088f6cb380360dd2a918c31bc42bba0))

## [0.4.0](https://github.com/Compuvi/confinaid-test-tool/compare/v0.3.5...v0.4.0) (2026-09-29)

### Features

* **suites,load:** gte/lte body assertions, load presets, fix default bodies ([e020ce9](https://github.com/Compuvi/confinaid-test-tool/commit/e020ce9596433d30ba67857cd9a99d12bd13da04))

## [0.3.5](https://github.com/Compuvi/confinaid-test-tool/compare/v0.3.4...v0.3.5) (2026-09-25)

### Bug Fixes

* **ci,updater:** restore productName, rename installers for CodeSignTool, smarter relaunch ([d383406](https://github.com/Compuvi/confinaid-test-tool/commit/d383406e35e701e1e20b4ae0322943248f13bcf1))

## [0.3.4](https://github.com/Compuvi/confinaid-test-tool/compare/v0.3.3...v0.3.4) (2026-09-25)

### Bug Fixes

* **ci:** harden Windows signing — fail-fast, verbose output, upload fallback ([3765b4f](https://github.com/Compuvi/confinaid-test-tool/commit/3765b4fc3a5dacf02d353e1d51acec232edbcbac))
* **ci:** remove spaces from productName to fix CodeSignTool argument parsing ([74e56e2](https://github.com/Compuvi/confinaid-test-tool/commit/74e56e219ca01b76c08a1eaf958c0ec8baea39cb))
* **ci:** work around CodeSignTool space-in-path bug for Windows signing ([9bad121](https://github.com/Compuvi/confinaid-test-tool/commit/9bad121148157bb114ce18c0bba60477f9d61f09))

## [0.3.3](https://github.com/Compuvi/confinaid-test-tool/compare/v0.3.2...v0.3.3) (2026-09-25)

### Bug Fixes

* **ci:** align Windows signing secret names and add APPLE_NOTARIZE_WAIT ([09a8816](https://github.com/Compuvi/confinaid-test-tool/commit/09a8816c0b2934e05209709e2ffa781a48e71a45))
* **updater,build,installer:** registry-based MSI detection, code signing pipeline, and NSIS perMachine install ([a9eb07e](https://github.com/Compuvi/confinaid-test-tool/commit/a9eb07e7586d87ea7fafdec8768656976d925836))

## [0.3.2](https://github.com/Compuvi/confinaid-test-tool/compare/v0.3.1...v0.3.2) (2026-09-22)

### Bug Fixes

* **playground,requests,settings,splash:** add graphrag API, token meter, auto-rewrite, and UX polish ([fa5fdab](https://github.com/Compuvi/confinaid-test-tool/commit/fa5fdabd6c2589c0a5e1713a0a388a2fffd44d34))

## [0.3.1](https://github.com/Compuvi/confinaid-test-tool/compare/v0.3.0...v0.3.1) (2026-09-22)

### Bug Fixes

* **docs:** update README to reflect v0.3.0 fully-implemented feature set ([19d244f](https://github.com/Compuvi/confinaid-test-tool/commit/19d244fe88812b951a83e696745dfe807cae865e))
* **load:** correct Analyze/Rewrite default bodies and add multi-sample response panel ([b6a764e](https://github.com/Compuvi/confinaid-test-tool/commit/b6a764edafebdb614fc8fe5679fe6dfb0dbf3b8e))
* **load:** replace native number spinners, fix download dialog, correct Analyze body ([b7f92a4](https://github.com/Compuvi/confinaid-test-tool/commit/b7f92a41a439c495f44cc830554012445c300e15))

## [0.3.0](https://github.com/Compuvi/confinaid-test-tool/compare/v0.2.3...v0.3.0) (2026-09-21)

### Features

* implement Load & Rate Limit page ([9c35f84](https://github.com/Compuvi/confinaid-test-tool/commit/9c35f848413512495909be521225b9844c448a79))

### Bug Fixes

* add UAC elevation for MSI update path ([618d2c5](https://github.com/Compuvi/confinaid-test-tool/commit/618d2c53779807c39900fa4e8fe855dc52b9217b))
* relaunch app after silent installer and suppress console window ([2327b0e](https://github.com/Compuvi/confinaid-test-tool/commit/2327b0e79a6e0520af61c498fe7eef3baaab8d00))
* show response body in suite case card on failure ([fb4461e](https://github.com/Compuvi/confinaid-test-tool/commit/fb4461e8812f3a7bc00dc4914c68e1d373baf8db))
* **ui:** sidebar centering, active highlight, reports date-range filter, connections cleanup, playground token note, and client-secret rename ([0d99c63](https://github.com/Compuvi/confinaid-test-tool/commit/0d99c634ee286ea70b7ab98f8523dbd672af893d))

## [0.2.3](https://github.com/Compuvi/confinaid-test-tool/compare/v0.2.2...v0.2.3) (2026-09-20)

### Bug Fixes

* add contents:write permission to build workflow for release asset upload ([6b3f8b9](https://github.com/Compuvi/confinaid-test-tool/commit/6b3f8b9768e5e4001795d770258dd1c69f14ef85))

## [0.2.2](https://github.com/Compuvi/confinaid-test-tool/compare/v0.2.1...v0.2.2) (2026-09-20)

### Bug Fixes

* correct artifact paths and Rust cache workspace in build workflow ([341ec6d](https://github.com/Compuvi/confinaid-test-tool/commit/341ec6d240175814d0805c7e73635e4e11363c94))

## [0.2.1](https://github.com/Compuvi/confinaid-test-tool/compare/v0.2.0...v0.2.1) (2026-09-20)

### Bug Fixes

* correct tauri build --bundles flag syntax and drop deprecated baseUrl ([3882168](https://github.com/Compuvi/confinaid-test-tool/commit/38821687625883c953c6acf42b203f5887774adb))

## [0.2.0](https://github.com/Compuvi/confinaid-test-tool/compare/v0.1.2...v0.2.0) (2026-09-20)

### Features

* splash screen with startup update check, auto-install, and settings toggles ([d62c202](https://github.com/Compuvi/confinaid-test-tool/commit/d62c20254f1d778b7e8da35541b454e647498f77))
* suites, bulk import, auto-update, custom UI, and UX polish ([4bb92dd](https://github.com/Compuvi/confinaid-test-tool/commit/4bb92dd000adc514c75cd55c145b4289720b12b9))

### Bug Fixes

* **i18n:** add full multi-language support with Settings language selector ([df0f094](https://github.com/Compuvi/confinaid-test-tool/commit/df0f0941df9b19216119e67cbf48129614c5fd08))

## [0.1.2](https://github.com/Compuvi/confinaid-test-tool/compare/v0.1.1...v0.1.2) (2026-09-08)

### Bug Fixes

* **ci:** trigger installer build on release, not tag push ([620317e](https://github.com/Compuvi/confinaid-test-tool/commit/620317ed4566a19936358e1b7693f18266fa95da))

## [0.1.1](https://github.com/Compuvi/confinaid-test-tool/compare/v0.1.0...v0.1.1) (2026-09-08)

### Bug Fixes

* **release:** drop cargo from sync-version so releases stop failing ([cb7ee9c](https://github.com/Compuvi/confinaid-test-tool/commit/cb7ee9cb9192428a9b06e7ddcf434cbac3f5ef53))
