# Security and transition status

This repository was extracted from Rune Realm commit
`e1dc6602f7603d6ca86f67ad1d30bd6fc5979630`. Its filtered history and current
tree were checked for RSA JWK markers; none were found. Wallet files,
environment overrides, and JWKs remain ignored.

`npm ci` reported inherited production dependency findings at extraction time:
18 low, 36 moderate, 10 high, and 3 critical. This split does not claim to
remediate them. They come from the existing application dependency graph and
must be triaged through focused dependency upgrades with browser-wallet,
signing, asset-upload, and production-build regression tests.

The local AO and orderbook clients are temporary compatibility copies. Security
fixes to those boundaries must be applied to their canonical extraction repos
and mirrored here until consumers switch; the super-repository tracks that
transition.
