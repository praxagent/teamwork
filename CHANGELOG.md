# Changelog

## [0.20.0](https://github.com/praxagent/teamwork/compare/v0.19.0...v0.20.0) (2026-07-25)


### Features

* **mcp:** give the user a paste-ready skill for the agent they just connected ([#52](https://github.com/praxagent/teamwork/issues/52)) ([e4baded](https://github.com/praxagent/teamwork/commit/e4baded65b8b2b0200c218c9c77228b13349cb9c))
* **mcp:** let other agents work in TeamWork, scoped to one space ([#49](https://github.com/praxagent/teamwork/issues/49)) ([2a4c135](https://github.com/praxagent/teamwork/commit/2a4c135cf824ef15e25043320aea1ed5a8314fd4))
* **model:** put the model choice in Settings, per space, and on the message ([#51](https://github.com/praxagent/teamwork/issues/51)) ([a45141d](https://github.com/praxagent/teamwork/commit/a45141da82eba75f667b5ce2e901e22323c4a17d))
* **model:** tell the agent which space a message came from, and make the picker usable ([#50](https://github.com/praxagent/teamwork/issues/50)) ([65f5c0e](https://github.com/praxagent/teamwork/commit/65f5c0e3914eed11479af5615a204f25fa110d9a))
* **ui:** let the picker ask providers what they can serve ([#47](https://github.com/praxagent/teamwork/issues/47)) ([f2132d7](https://github.com/praxagent/teamwork/commit/f2132d7a7a74d43dfd3042809e91eec3eabebf34))

## [0.19.0](https://github.com/praxagent/teamwork/compare/v0.18.0...v0.19.0) (2026-07-25)


### Features

* blank-workspace option; disable the team-type wizard until it works ([#45](https://github.com/praxagent/teamwork/issues/45)) ([a210c23](https://github.com/praxagent/teamwork/commit/a210c232ca9defc3874a029def7165ac9fac4456))
* **ui:** model picker with providers, tier pinning and auto ([#46](https://github.com/praxagent/teamwork/issues/46)) ([9b66c3d](https://github.com/praxagent/teamwork/commit/9b66c3d93218374dcb02407969dbc9dbb4b3e98c))


### Bug Fixes

* **api:** an unreachable Prax backend is an HTTP failure, not a 200 ([#44](https://github.com/praxagent/teamwork/issues/44)) ([7b5ef94](https://github.com/praxagent/teamwork/commit/7b5ef943c6bc6a7cfe13076deeb4b5f6b9e5e47f))
* **ui:** stop one bad API field from blanking the whole app ([#42](https://github.com/praxagent/teamwork/issues/42)) ([deb3447](https://github.com/praxagent/teamwork/commit/deb344788379145590ed7f85c7b2fa19cb399099))

## [0.18.0](https://github.com/praxagent/teamwork/compare/v0.17.0...v0.18.0) (2026-07-24)


### Features

* channel membership + agent-to-agent DMs ([#39](https://github.com/praxagent/teamwork/issues/39)) ([4d70f52](https://github.com/praxagent/teamwork/commit/4d70f527ca8e55453d99c9405ebadbf99f35d615))
* run a foreign command-line agent as a TeamWork member ([#41](https://github.com/praxagent/teamwork/issues/41)) ([d7ba6e6](https://github.com/praxagent/teamwork/commit/d7ba6e67c10510a800ccee3935de138a62fbb8e0))

## [0.17.0](https://github.com/praxagent/teamwork/compare/v0.16.0...v0.17.0) (2026-07-24)


### Features

* append-only hash-chained event log + agent-first CLI ([#37](https://github.com/praxagent/teamwork/issues/37)) ([3500d7c](https://github.com/praxagent/teamwork/commit/3500d7ceea1bce1672586113b7a330d9d0d3973c))
* approval gates + agent identity docs ([#38](https://github.com/praxagent/teamwork/issues/38)) ([33a3c71](https://github.com/praxagent/teamwork/commit/33a3c71c861225d3eefb1b29ca0b918c40d74176))
* **security:** identity-scoped capabilities + Ed25519 signed envelopes ([#35](https://github.com/praxagent/teamwork/issues/35)) ([6ee6749](https://github.com/praxagent/teamwork/commit/6ee6749228502c50fcdf658906c4a1b4bd1e087a))
* **security:** per-agent credentials — identity comes from the token, not the body ([#33](https://github.com/praxagent/teamwork/issues/33)) ([c448f7a](https://github.com/praxagent/teamwork/commit/c448f7a9f2fced1eb5628873ba8eafcc78800d8b))


### Documentation

* add Buzz (block/buzz) comparison + borrow-candidates ([#31](https://github.com/praxagent/teamwork/issues/31)) ([a271336](https://github.com/praxagent/teamwork/commit/a2713369c7f8e0f1a76a5118e491e2606227c39b))

## [0.16.0](https://github.com/praxagent/teamwork/compare/v0.15.0...v0.16.0) (2026-07-03)


### Features

* request-source chip in trace graph + mobile drag-scroll fix ([#29](https://github.com/praxagent/teamwork/issues/29)) ([bba6cad](https://github.com/praxagent/teamwork/commit/bba6cadf9575ebd893ff062c7017e1102ce61730))

## [0.15.0](https://github.com/praxagent/teamwork/compare/v0.14.1...v0.15.0) (2026-06-29)


### Features

* update teamwork to work with prax-sandbox separated from prax ([5300a6a](https://github.com/praxagent/teamwork/commit/5300a6a56adad7dcf0aec01685c50c492677fc19))

## [0.14.1](https://github.com/praxagent/teamwork/compare/v0.14.0...v0.14.1) (2026-05-09)


### Bug Fixes

* add panels unintentionally excluded due to prior naming scheme ([cae2c94](https://github.com/praxagent/teamwork/commit/cae2c942b87c6117f5eb1ea156a2f4281123b110))

## [0.14.0](https://github.com/praxagent/teamwork/compare/v0.13.0...v0.14.0) (2026-04-11)


### Features

* give Prax a desktop ([1e0e4d8](https://github.com/praxagent/teamwork/commit/1e0e4d85ae4adf8eb40e46d486ea3a94ba733445))

## [0.13.0](https://github.com/praxagent/teamwork/compare/v0.12.0...v0.13.0) (2026-04-10)


### Features

* add spaces ([c210eb7](https://github.com/praxagent/teamwork/commit/c210eb79383143a539f8a3539f821b67acdcbbf0))

## [0.12.0](https://github.com/praxagent/teamwork/compare/v0.11.0...v0.12.0) (2026-04-09)


### Features

* improve context management, create spaces, various other improvements ([#22](https://github.com/praxagent/teamwork/issues/22)) ([00dd4bb](https://github.com/praxagent/teamwork/commit/00dd4bbd5a39ccc0ee8b430a996e249d63f42be7))

## [0.11.0](https://github.com/praxagent/teamwork/compare/v0.10.0...v0.11.0) (2026-04-04)


### Features

* add mobile friendly ([7941009](https://github.com/praxagent/teamwork/commit/79410095dcab829c32895b55ac7a31a1992779e5))

## [0.10.0](https://github.com/praxagent/teamwork/compare/v0.9.0...v0.10.0) (2026-04-04)


### Features

* adds cron and alarms ([fb5d3c6](https://github.com/praxagent/teamwork/commit/fb5d3c69eb6b9c9bbf07e4a52fcd7ae4d6bc208e))

## [0.9.0](https://github.com/praxagent/teamwork/compare/v0.8.0...v0.9.0) (2026-04-03)


### Features

* add interaction with coding tools ([ef8e040](https://github.com/praxagent/teamwork/commit/ef8e04072fca5a28de335d99eb0ec867e51d4cdc))

## [0.8.0](https://github.com/praxagent/teamwork/compare/v0.7.0...v0.8.0) (2026-04-03)


### Features

* add memory review page ([e39afa5](https://github.com/praxagent/teamwork/commit/e39afa504c825c605ed2d9e13b9785c6667446fa))

## [0.7.0](https://github.com/praxagent/teamwork/compare/v0.6.0...v0.7.0) (2026-04-02)


### Features

* add coaching mode ([#5](https://github.com/praxagent/teamwork/issues/5)) ([fc98be3](https://github.com/praxagent/teamwork/commit/fc98be3b0a9bff257f9e97551f0b20d42a81dbb5))
* add plugin page and observability page ([#12](https://github.com/praxagent/teamwork/issues/12)) ([7e621f3](https://github.com/praxagent/teamwork/commit/7e621f3933b513b9544bf93c9a648d2d985ff45b))
* add prax space (notes, courses) ([c317897](https://github.com/praxagent/teamwork/commit/c317897689d553056e33c6f80f9b95a7147aec51))
* allow monitoring and takeover of agent work ([#2](https://github.com/praxagent/teamwork/issues/2)) ([9d5966c](https://github.com/praxagent/teamwork/commit/9d5966cf66c1c8a5ece5a8f51371fefbadbcace3))
* better visualize agentic flow ([8b2cafa](https://github.com/praxagent/teamwork/commit/8b2cafa91c5e375acf22e9153b61397fdc301a96))
* initial commit ([4ea5e99](https://github.com/praxagent/teamwork/commit/4ea5e99fe04f94293c5952ff6378e6b9c1e09c76))
* refactor teamwork as the shell for agents, without its own agent, add browser/terminal ([#9](https://github.com/praxagent/teamwork/issues/9)) ([0804020](https://github.com/praxagent/teamwork/commit/08040201474875c069ffbfc8e92c09f99a89af56))
* refactors to integrate better with Prax ([c62140e](https://github.com/praxagent/teamwork/commit/c62140edcc7dbc33e92fe7408a4e2606c90999f9))
* streamline ui ([b58d6bb](https://github.com/praxagent/teamwork/commit/b58d6bbc9b31bfb4a02581da036fbff25ee3fe9e))

## [0.6.0](https://github.com/praxagent/teamwork/compare/v0.5.0...v0.6.0) (2026-04-02)


### Features

* add prax space (notes, courses) ([c317897](https://github.com/praxagent/teamwork/commit/c317897689d553056e33c6f80f9b95a7147aec51))

## [0.5.0](https://github.com/praxagent/teamwork/compare/v0.4.0...v0.5.0) (2026-04-01)


### Features

* better visualize agentic flow ([8b2cafa](https://github.com/praxagent/teamwork/commit/8b2cafa91c5e375acf22e9153b61397fdc301a96))

## [0.4.0](https://github.com/praxagent/teamwork/compare/v0.3.0...v0.4.0) (2026-03-31)


### Features

* refactors to integrate better with Prax ([c62140e](https://github.com/praxagent/teamwork/commit/c62140edcc7dbc33e92fe7408a4e2606c90999f9))
* streamline ui ([b58d6bb](https://github.com/praxagent/teamwork/commit/b58d6bbc9b31bfb4a02581da036fbff25ee3fe9e))

## [0.3.0](https://github.com/praxagent/teamwork/compare/v0.2.0...v0.3.0) (2026-03-29)


### Features

* add plugin page and observability page ([#12](https://github.com/praxagent/teamwork/issues/12)) ([7e621f3](https://github.com/praxagent/teamwork/commit/7e621f3933b513b9544bf93c9a648d2d985ff45b))

## [0.2.0](https://github.com/praxagent/teamwork/compare/v0.1.0...v0.2.0) (2026-03-27)


### Features

* refactor teamwork as the shell for agents, without its own agent, add browser/terminal ([#9](https://github.com/praxagent/teamwork/issues/9)) ([0804020](https://github.com/praxagent/teamwork/commit/08040201474875c069ffbfc8e92c09f99a89af56))

## 0.1.0 (2026-03-27)


### Features

* add coaching mode ([#5](https://github.com/praxagent/teamwork/issues/5)) ([fc98be3](https://github.com/praxagent/teamwork/commit/fc98be3b0a9bff257f9e97551f0b20d42a81dbb5))
* allow monitoring and takeover of agent work ([#2](https://github.com/praxagent/teamwork/issues/2)) ([9d5966c](https://github.com/praxagent/teamwork/commit/9d5966cf66c1c8a5ece5a8f51371fefbadbcace3))
* initial commit ([4ea5e99](https://github.com/praxagent/teamwork/commit/4ea5e99fe04f94293c5952ff6378e6b9c1e09c76))
