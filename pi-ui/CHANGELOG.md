# Changelog

## [0.2.0](https://github.com/FedericoPartesano/pi-claude/compare/pi-ui-v0.1.0...pi-ui-v0.2.0) (2026-10-08)


### Features

* **goal:** see whether a goal runs, what it does and how far it is; fix(pi-ui): typing lag ([c73ba72](https://github.com/FedericoPartesano/pi-claude/commit/c73ba724bf789f8159183b726f896172d493b62b))
* **goal:** visible state and progress; fix(pi-ui): typing lag ([69da00b](https://github.com/FedericoPartesano/pi-claude/commit/69da00bbaa3f62146ab6437bd72ead810f9985d3))
* **memory:** a more structured, professional /memory dashboard ([eec7c9d](https://github.com/FedericoPartesano/pi-claude/commit/eec7c9def5926c4efe3355f392b469e0ac8bb752))
* **pi-ui:** /riavvia full restart on the same conversation, memory in the footer ([9dfe5cb](https://github.com/FedericoPartesano/pi-claude/commit/9dfe5cba146bdad7f52f6a8cb885eddc1a765809))
* **pi-ui:** always-visible side panel; fix(goal): no more closing unfinished goals ([c3fe9b0](https://github.com/FedericoPartesano/pi-claude/commit/c3fe9b0f0c3254ecfbeded6842a91771e3059271))
* **pi-ui:** animated intro when pi-full starts ([a0ba3d3](https://github.com/FedericoPartesano/pi-claude/commit/a0ba3d3e83754513d2059641a15bf0da42ac448d))
* **pi-ui:** animated PI//CLAUDE intro when pi-full starts ([cb848df](https://github.com/FedericoPartesano/pi-claude/commit/cb848df398e0b40c23a46b2ea7925efb3fae3925))
* **pi-ui:** charts drawn in the terminal ([5ef7151](https://github.com/FedericoPartesano/pi-claude/commit/5ef7151c1742ccd0700b18ffd6eb6229eaab1059))
* **pi-ui:** compact step list with phrases, diffs and test results ([aa4bbc8](https://github.com/FedericoPartesano/pi-claude/commit/aa4bbc83af4f54603b18ffc6ccbb685e8ab19cc9))
* **pi-ui:** image thumbnails, /img gallery and VS Code links in answers ([c3293f3](https://github.com/FedericoPartesano/pi-claude/commit/c3293f3d073cf2578220e0ba07e882e463db2a83))
* **pi-ui:** lilla theme from the user's WezTerm pastels ([0fbe867](https://github.com/FedericoPartesano/pi-claude/commit/0fbe867172380fa2a29ed54219c04f1a37665d5e))
* **pi-ui:** live thinking box, animated status bar, step durations ([d140661](https://github.com/FedericoPartesano/pi-claude/commit/d1406617961ac81108586732172efdf0a9a619ac))
* **pi-ui:** Neon Night status bar, prompt frame and footer ([975eca9](https://github.com/FedericoPartesano/pi-claude/commit/975eca9138cc29e61c2a68a12d84537e0c4538bf))
* **pi-ui:** Night City cyberpunk theme with HUD style, and an icon set ([f4d6f27](https://github.com/FedericoPartesano/pi-claude/commit/f4d6f2753b07f3dd974482b10e9c68f51aedb6ac))
* **pi-ui:** Night City theme and icons; docs: eval round 2 spec and plan ([fe2dd42](https://github.com/FedericoPartesano/pi-claude/commit/fe2dd42508479c176aba352c9dca0523f6ed4127))
* **pi-ui:** PI_UI_TRACE records the terminal byte stream to replay rendering glitches ([9986da3](https://github.com/FedericoPartesano/pi-claude/commit/9986da32deae3c3c3617813cfde642029450c470))
* **pi-ui:** richer session panel ([7e7ca1b](https://github.com/FedericoPartesano/pi-claude/commit/7e7ca1b70577a3122acfcab511448bc3cbddc878))
* **pi-ui:** session panel on Alt+I and startup banner ([47be3d2](https://github.com/FedericoPartesano/pi-claude/commit/47be3d27e2edb67ffff72ec987759181e426c281))
* **pi-ui:** sub-agents in the session panel ([76ca971](https://github.com/FedericoPartesano/pi-claude/commit/76ca971f00d6b29fd254156941199f27da287ac0))
* **pi-ui:** suggestions, dangerous-command question in the status bar, notifications ([b50dd62](https://github.com/FedericoPartesano/pi-claude/commit/b50dd624631e1b5c3d3578f084be7d1b44e70f55))
* **pi-ui:** the session panel as an always-visible side column, with plan, intent and savings ([f0e7435](https://github.com/FedericoPartesano/pi-claude/commit/f0e7435e0aed5acf0a2362a243d82b43ac198dc2))


### Bug Fixes

* duplicated lines behind ConPTY, queued messages after compaction, recall framing ([0446700](https://github.com/FedericoPartesano/pi-claude/commit/044670020ff4c7b9ec9015bd371bbfc27abdf74c))
* **pi-ui,pi-picker:** keys that komorebi/whkd do not take ([5e4c4d4](https://github.com/FedericoPartesano/pi-claude/commit/5e4c4d4b511f776fc8c69d59ff24ad0d77c66c1a))
* **pi-ui:** charts asked for explicitly always use the grafico block ([588fd35](https://github.com/FedericoPartesano/pi-claude/commit/588fd35afdf4c67a1558620e19d596afc6675cd5))
* **pi-ui:** fullscreen by default everywhere; behind ConPTY images open with /img ([146dd2a](https://github.com/FedericoPartesano/pi-claude/commit/146dd2a29aa8f1ce3215cdf71e437b0515ab5393))
* **pi-ui:** issues found in the live run, docs ([cb2c245](https://github.com/FedericoPartesano/pi-claude/commit/cb2c24519b709e6500a914be5ec59b70d176c8f3))
* **pi-ui:** plain icons behind ConPTY, where Nerd glyphs drift the cursor ([d5fa2a7](https://github.com/FedericoPartesano/pi-claude/commit/d5fa2a77d8d604e3004616c4a35a122967e9b2e7))
* **pi-ui:** real images next to the side panel, and bigger ([fbafe54](https://github.com/FedericoPartesano/pi-claude/commit/fbafe54705b56c3eccea5dd538c7ceeb10f2bae0))
* **pi-ui:** real images next to the side panel, and bigger ([48dea79](https://github.com/FedericoPartesano/pi-claude/commit/48dea792831ca014fe4b8db8d49c923baf8aaca8))
* **pi-ui:** real images on terminals that support them, sharper thumbnails elsewhere ([369d93c](https://github.com/FedericoPartesano/pi-claude/commit/369d93c7e51e71bd22a42b2b73e6a3852a7c425c))
* **pi-ui:** resumed sessions, overlay color bleed, one-step turns ([1996e25](https://github.com/FedericoPartesano/pi-claude/commit/1996e254af0d6dbc25e10fab3258e8a5b516e3fa))
* **pi-ui:** sharp images in WezTerm on Windows and WSL (iTerm2 protocol, regular mode) ([0593287](https://github.com/FedericoPartesano/pi-claude/commit/05932876a4fb28799f16ea3ef77dc01505affa78))
* **pi-ui:** sharp images in WezTerm on Windows/WSL ([be39bf2](https://github.com/FedericoPartesano/pi-claude/commit/be39bf2d9a6b4ad0b3af25dcc65233095fe564cd))
* **pi-ui:** stop one column short behind ConPTY so redraws don't leave stale copies ([6fb402e](https://github.com/FedericoPartesano/pi-claude/commit/6fb402e251b9316bea9eee48955410fe5384eb8c))
* queued messages no longer fail after compaction; recalled memories are not a request ([d4a1d50](https://github.com/FedericoPartesano/pi-claude/commit/d4a1d50a8f4677418a239d09663453d02d1a1659))


### Performance Improvements

* **pi-ui:** cap streaming redraws at 30 fps ([f53b7fa](https://github.com/FedericoPartesano/pi-claude/commit/f53b7faca4cae196606a2e7365e1a6a2d772694e))
* **pi-ui:** cap throttled redraws at 30 fps ([da3a9a8](https://github.com/FedericoPartesano/pi-claude/commit/da3a9a81e88c55fc27094f3222049152f46248c8))
* **pi-ui:** decode thumbnails in a worker thread, with an animated loading line ([8612709](https://github.com/FedericoPartesano/pi-claude/commit/86127094c0da353ce991806818784cb1e3bce032))
* **pi-ui:** panel on data change, fewer frames ([ef3b3cb](https://github.com/FedericoPartesano/pi-claude/commit/ef3b3cb226557a4e1237d8241949d2d6e361dea8))
* **pi-ui:** panel rebuilt only when its data changes, fewer frames while working ([b425720](https://github.com/FedericoPartesano/pi-claude/commit/b425720e14df228b47e68551efb7768e971697d0))
* **pi-ui:** thumbnails decoded in a worker, animated loading ([5e52cfb](https://github.com/FedericoPartesano/pi-claude/commit/5e52cfba20d363dbe1e6b7add78571b8a7cc8997))
