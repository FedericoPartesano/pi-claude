# Changelog

## [0.2.0](https://github.com/FedericoPartesano/pi-claude/compare/pi-memory-v0.1.0...pi-memory-v0.2.0) (2026-10-08)


### Features

* deep recall memory (local embeddings, hybrid recall, bounded injection) ([3140b37](https://github.com/FedericoPartesano/pi-claude/commit/3140b3706d2471f7dbdaf751ac716f13a5acfa4b))
* **memory:** /memoria dashboard, lasting /dream summary, memory status ([95aa76c](https://github.com/FedericoPartesano/pi-claude/commit/95aa76c2256f7866a39033ccec14c8a89abe28b9))
* **memory:** a more structured, professional /memory dashboard ([eec7c9d](https://github.com/FedericoPartesano/pi-claude/commit/eec7c9def5926c4efe3355f392b469e0ac8bb752))
* **memory:** full-screen /memoria dashboard with history, recalls and questions ([a858b88](https://github.com/FedericoPartesano/pi-claude/commit/a858b882a377ad2b3fcbf0aa89e911f4b537dce5))
* **pi-memory:** stricter recall for read-only questions ([1241f12](https://github.com/FedericoPartesano/pi-claude/commit/1241f124cfb936907a9fc5a2aca37596204ede6b))


### Bug Fixes

* duplicated lines behind ConPTY, queued messages after compaction, recall framing ([0446700](https://github.com/FedericoPartesano/pi-claude/commit/044670020ff4c7b9ec9015bd371bbfc27abdf74c))
* **memory:** no recall on small talk; the recall message ends with the user's request ([22110e0](https://github.com/FedericoPartesano/pi-claude/commit/22110e09286ebaa64cc84b8a6398ee7d5654ba5c))
* queued messages no longer fail after compaction; recalled memories are not a request ([d4a1d50](https://github.com/FedericoPartesano/pi-claude/commit/d4a1d50a8f4677418a239d09663453d02d1a1659))


### Performance Improvements

* **memory:** embedder in a worker, unloaded when idle ([3881047](https://github.com/FedericoPartesano/pi-claude/commit/3881047bac7081238cbf21e84326659753630ac7))
* **memory:** embedding model in a worker thread, unloaded when idle ([7066552](https://github.com/FedericoPartesano/pi-claude/commit/7066552363408a1de16aec0d60b1501b1961850c))
