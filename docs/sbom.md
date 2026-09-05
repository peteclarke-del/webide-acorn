# Software bill of materials

Generated from the lockfile rather than written, because a hand-maintained
inventory is out of date the first time anyone installs and nobody notices
until it matters. Regenerate it with `npm run sbom`.

What ships and what does not are counted separately. A development
dependency is not distributed, so its licence constrains the people building
this product and not the people running it; reporting both in one list is
how a project ends up believing it has a hundred licence obligations when it
has four.

## Counts

| Measure | Count |
| --- | --- |
| Packages installed | 583 |
| Of those, distributed with the product | 91 |
| Development only | 232 |
| Installed but not distributed, with the reason recorded | 260 |
| Shipped under a permissive licence | 90 |
| Shipped under a copyleft licence | 1 |
| Shipped with an unrecognised licence expression | 0 |
| Shipped with no licence recorded | 0 |
| Installed without a verifiable integrity hash | 0 |

## Known vulnerabilities

| Severity | Count |
| --- | --- |
| info | 0 |
| low | 0 |
| moderate | 0 |
| high | 0 |
| critical | 0 |
| total | 0 |

## Shipped packages whose licence needs a person

| Package | Version | Licence | Why it is listed |
| --- | --- | --- | --- |
| jsbeeb | 1.19.1 | GPL-3.0-or-later | Copyleft: conditions apply to distributing a built artifact |

## Backend dependencies

The PHP service is distributed as its own image, so its dependencies are
conveyed with it and their licences constrain that distribution.

| Measure | Count |
| --- | --- |
| Packages | 62 |
| Permissive | 62 |
| Copyleft | 0 |
| Unrecognised or unrecorded | 0 |

| Package | Licence |
| --- | --- |
| masterminds/html5 | MIT |
| myclabs/deep-copy | MIT |
| nikic/php-parser | BSD-3-Clause |
| phar-io/manifest | BSD-3-Clause |
| phar-io/version | BSD-3-Clause |
| phpunit/php-code-coverage | BSD-3-Clause |
| phpunit/php-file-iterator | BSD-3-Clause |
| phpunit/php-invoker | BSD-3-Clause |
| phpunit/php-text-template | BSD-3-Clause |
| phpunit/php-timer | BSD-3-Clause |
| phpunit/phpunit | BSD-3-Clause |
| psr/cache | MIT |
| psr/container | MIT |
| psr/event-dispatcher | MIT |
| psr/log | MIT |
| sebastian/cli-parser | BSD-3-Clause |
| sebastian/code-unit | BSD-3-Clause |
| sebastian/code-unit-reverse-lookup | BSD-3-Clause |
| sebastian/comparator | BSD-3-Clause |
| sebastian/complexity | BSD-3-Clause |
| sebastian/diff | BSD-3-Clause |
| sebastian/environment | BSD-3-Clause |
| sebastian/exporter | BSD-3-Clause |
| sebastian/global-state | BSD-3-Clause |
| sebastian/lines-of-code | BSD-3-Clause |
| sebastian/object-enumerator | BSD-3-Clause |
| sebastian/object-reflector | BSD-3-Clause |
| sebastian/recursion-context | BSD-3-Clause |
| sebastian/type | BSD-3-Clause |
| sebastian/version | BSD-3-Clause |
| staabm/side-effects-detector | MIT |
| symfony/browser-kit | MIT |
| symfony/cache | MIT |
| symfony/cache-contracts | MIT |
| symfony/config | MIT |
| symfony/console | MIT |
| symfony/css-selector | MIT |
| symfony/dependency-injection | MIT |
| symfony/deprecation-contracts | MIT |
| symfony/dom-crawler | MIT |
| symfony/error-handler | MIT |
| symfony/event-dispatcher | MIT |
| symfony/event-dispatcher-contracts | MIT |
| symfony/filesystem | MIT |
| symfony/finder | MIT |
| symfony/framework-bundle | MIT |
| symfony/http-foundation | MIT |
| symfony/http-kernel | MIT |
| symfony/polyfill-ctype | MIT |
| symfony/polyfill-intl-grapheme | MIT |
| symfony/polyfill-intl-normalizer | MIT |
| symfony/polyfill-mbstring | MIT |
| symfony/polyfill-php85 | MIT |
| symfony/process | MIT |
| symfony/routing | MIT |
| symfony/runtime | MIT |
| symfony/service-contracts | MIT |
| symfony/string | MIT |
| symfony/var-dumper | MIT |
| symfony/var-exporter | MIT |
| symfony/yaml | MIT |
| theseer/tokenizer | BSD-3-Clause |

## Everything distributed with the product

| Package | Version | Licence |
| --- | --- | --- |
| @img/colour | 1.1.0 | MIT |
| @popperjs/core | 2.11.8 | MIT |
| @types/node | 22.20.1 | MIT |
| agent-base | 7.1.4 | MIT |
| ansi-regex | 5.0.1 | MIT |
| ansi-styles | 4.3.0 | MIT |
| argparse | 3.0.0 | Python-2.0 |
| async | 3.2.6 | MIT |
| asynckit | 0.4.0 | MIT |
| atomically | 2.1.1 | MIT |
| balanced-match | 4.0.4 | MIT |
| boolean | 3.2.0 | MIT |
| bootstrap | 5.3.8 | MIT |
| bootswatch | 5.3.8 | MIT |
| brace-expansion | 5.0.9 | MIT |
| call-bind-apply-helpers | 1.0.2 | MIT |
| color-convert | 2.0.1 | MIT |
| color-name | 1.1.4 | MIT |
| combined-stream | 1.0.8 | MIT |
| commander | 5.1.0 | MIT |
| commander | 9.5.0 | MIT |
| conf | 15.1.0 | MIT |
| cross-spawn | 7.0.6 | MIT |
| debug | 4.4.3 | MIT |
| delayed-stream | 1.0.0 | MIT |
| detect-libc | 2.1.2 | Apache-2.0 |
| dunder-proto | 1.0.1 | MIT |
| ejs | 3.1.10 | Apache-2.0 |
| electron | 43.4.1 | MIT |
| emoji-regex | 8.0.0 | MIT |
| es-define-property | 1.0.1 | MIT |
| es-errors | 1.3.0 | MIT |
| es-object-atoms | 1.1.2 | MIT |
| es-set-tostringtag | 2.1.0 | MIT |
| escalade | 3.2.0 | MIT |
| fdir | 6.5.0 | MIT |
| fflate | 0.8.2 | MIT |
| form-data | 4.0.6 | MIT |
| function-bind | 1.1.2 | MIT |
| get-intrinsic | 1.3.0 | MIT |
| get-proto | 1.0.1 | MIT |
| glob | 7.2.3 | ISC |
| gopd | 1.2.0 | MIT |
| got | 11.8.6 | MIT |
| has-flag | 4.0.0 | MIT |
| has-symbols | 1.1.0 | MIT |
| has-tostringtag | 1.0.2 | MIT |
| hasown | 2.0.4 | MIT |
| http-proxy-agent | 7.0.2 | MIT |
| https-proxy-agent | 7.0.6 | MIT |
| is-fullwidth-code-point | 3.0.0 | MIT |
| isexe | 2.0.0 | ISC |
| jsbeeb | 1.19.1 | GPL-3.0-or-later |
| json5 | 2.2.3 | MIT |
| lodash | 4.18.1 | MIT |
| math-intrinsics | 1.1.0 | MIT |
| mime | 2.6.0 | MIT |
| mime-db | 1.52.0 | MIT |
| mime-types | 2.1.35 | MIT |
| minimatch | 10.2.6 | BlueOak-1.0.0 |
| minipass | 7.1.3 | BlueOak-1.0.0 |
| ms | 2.1.3 | MIT |
| nopt | 9.0.0 | ISC |
| once | 1.4.0 | ISC |
| pako | 3.0.1 | (MIT AND Zlib) |
| path-key | 3.1.1 | MIT |
| picocolors | 1.1.1 | ISC |
| picomatch | 4.0.5 | MIT |
| progress | 2.0.3 | MIT |
| react | 19.0.0 | MIT |
| react-dom | 19.0.0 | MIT |
| retry | 0.12.0 | MIT |
| sax | 1.6.1 | BlueOak-1.0.0 |
| scheduler | 0.25.0 | MIT |
| semver | 7.8.5 | ISC |
| sharp | 0.35.3 | Apache-2.0 |
| shebang-command | 2.0.0 | MIT |
| shebang-regex | 3.0.0 | MIT |
| smoothie | 1.36.1 | MIT |
| source-map | 0.6.1 | BSD-3-Clause |
| string-width | 4.2.3 | MIT |
| strip-ansi | 6.0.1 | MIT |
| supports-color | 7.2.0 | MIT |
| tar | 7.5.22 | BlueOak-1.0.0 |
| temp | 0.9.4 | MIT |
| tinyglobby | 0.2.17 | MIT |
| tmp | 0.2.7 | MIT |
| undici-types | 6.21.0 | MIT |
| which | 2.0.2 | ISC |
| which | 5.0.0 | ISC |
| which | 6.0.1 | ISC |

## Installed but not distributed

These are installed to build or test the product and are not in what it
ships. Each says why, because an exclusion nobody can check is an
exclusion nobody should trust.

| Package | Version | Licence | Why it is not distributed |
| --- | --- | --- | --- |
| @electron-internal/extract-zip | 1.0.5 | BSD-2-Clause | an optional dependency that is absent from the built output |
| @electron/asar | 3.4.1 | MIT | an optional dependency that is absent from the built output |
| @electron/fuses | 1.8.0 | MIT | an optional dependency that is absent from the built output |
| @electron/get | 3.1.0 | MIT | an optional dependency that is absent from the built output |
| @electron/get | 5.1.0 | MIT | an optional dependency that is absent from the built output |
| @electron/notarize | 2.5.0 | MIT | an optional dependency that is absent from the built output |
| @electron/osx-sign | 1.3.3 | BSD-2-Clause | an optional dependency that is absent from the built output |
| @electron/rebuild | 4.2.0 | MIT | an optional dependency that is absent from the built output |
| @electron/universal | 2.0.3 | MIT | an optional dependency that is absent from the built output |
| @electron/windows-sign | 1.2.2 | BSD-2-Clause | an optional dependency that is absent from the built output |
| @emnapi/runtime | 1.11.3 | MIT | an optional dependency that is absent from the built output |
| @img/sharp-darwin-arm64 | 0.35.3 | Apache-2.0 | a per-platform binary, which a browser bundle cannot contain, and it is absent from the built output |
| @img/sharp-darwin-x64 | 0.35.3 | Apache-2.0 | a per-platform binary, which a browser bundle cannot contain, and it is absent from the built output |
| @img/sharp-freebsd-wasm32 | 0.35.3 | Apache-2.0 | a per-platform binary, which a browser bundle cannot contain, and it is absent from the built output |
| @img/sharp-libvips-darwin-arm64 | 1.3.2 | LGPL-3.0-or-later | a per-platform binary, which a browser bundle cannot contain, and it is absent from the built output |
| @img/sharp-libvips-darwin-x64 | 1.3.2 | LGPL-3.0-or-later | a per-platform binary, which a browser bundle cannot contain, and it is absent from the built output |
| @img/sharp-libvips-linux-arm | 1.3.2 | LGPL-3.0-or-later | a per-platform binary, which a browser bundle cannot contain, and it is absent from the built output |
| @img/sharp-libvips-linux-arm64 | 1.3.2 | LGPL-3.0-or-later | a per-platform binary, which a browser bundle cannot contain, and it is absent from the built output |
| @img/sharp-libvips-linux-ppc64 | 1.3.2 | LGPL-3.0-or-later | a per-platform binary, which a browser bundle cannot contain, and it is absent from the built output |
| @img/sharp-libvips-linux-riscv64 | 1.3.2 | LGPL-3.0-or-later | a per-platform binary, which a browser bundle cannot contain, and it is absent from the built output |
| @img/sharp-libvips-linux-s390x | 1.3.2 | LGPL-3.0-or-later | a per-platform binary, which a browser bundle cannot contain, and it is absent from the built output |
| @img/sharp-libvips-linux-x64 | 1.3.2 | LGPL-3.0-or-later | a per-platform binary, which a browser bundle cannot contain, and it is absent from the built output |
| @img/sharp-libvips-linuxmusl-arm64 | 1.3.2 | LGPL-3.0-or-later | a per-platform binary, which a browser bundle cannot contain, and it is absent from the built output |
| @img/sharp-libvips-linuxmusl-x64 | 1.3.2 | LGPL-3.0-or-later | a per-platform binary, which a browser bundle cannot contain, and it is absent from the built output |
| @img/sharp-linux-arm | 0.35.3 | Apache-2.0 | a per-platform binary, which a browser bundle cannot contain, and it is absent from the built output |
| @img/sharp-linux-arm64 | 0.35.3 | Apache-2.0 | a per-platform binary, which a browser bundle cannot contain, and it is absent from the built output |
| @img/sharp-linux-ppc64 | 0.35.3 | Apache-2.0 | a per-platform binary, which a browser bundle cannot contain, and it is absent from the built output |
| @img/sharp-linux-riscv64 | 0.35.3 | Apache-2.0 | a per-platform binary, which a browser bundle cannot contain, and it is absent from the built output |
| @img/sharp-linux-s390x | 0.35.3 | Apache-2.0 | a per-platform binary, which a browser bundle cannot contain, and it is absent from the built output |
| @img/sharp-linux-x64 | 0.35.3 | Apache-2.0 | a per-platform binary, which a browser bundle cannot contain, and it is absent from the built output |
| @img/sharp-linuxmusl-arm64 | 0.35.3 | Apache-2.0 | a per-platform binary, which a browser bundle cannot contain, and it is absent from the built output |
| @img/sharp-linuxmusl-x64 | 0.35.3 | Apache-2.0 | a per-platform binary, which a browser bundle cannot contain, and it is absent from the built output |
| @img/sharp-wasm32 | 0.35.3 | Apache-2.0 AND LGPL-3.0-or-later AND MIT | an optional dependency that is absent from the built output |
| @img/sharp-webcontainers-wasm32 | 0.35.3 | Apache-2.0 | a per-platform binary, which a browser bundle cannot contain, and it is absent from the built output |
| @img/sharp-win32-arm64 | 0.35.3 | Apache-2.0 AND LGPL-3.0-or-later | a per-platform binary, which a browser bundle cannot contain, and it is absent from the built output |
| @img/sharp-win32-ia32 | 0.35.3 | Apache-2.0 AND LGPL-3.0-or-later | a per-platform binary, which a browser bundle cannot contain, and it is absent from the built output |
| @img/sharp-win32-x64 | 0.35.3 | Apache-2.0 AND LGPL-3.0-or-later | a per-platform binary, which a browser bundle cannot contain, and it is absent from the built output |
| @isaacs/fs-minipass | 4.0.1 | ISC | an optional dependency that is absent from the built output |
| @malept/cross-spawn-promise | 2.0.0 | Apache-2.0 | an optional dependency that is absent from the built output |
| @malept/flatpak-bundler | 0.4.0 | MIT | an optional dependency that is absent from the built output |
| @noble/hashes | 1.4.0 | MIT | an optional dependency that is absent from the built output |
| @noble/hashes | 2.3.0 | MIT | an optional dependency that is absent from the built output |
| @peculiar/asn1-schema | 2.9.3 | MIT | an optional dependency that is absent from the built output |
| @peculiar/json-schema | 1.1.12 | MIT | an optional dependency that is absent from the built output |
| @peculiar/utils | 2.0.3 | MIT | an optional dependency that is absent from the built output |
| @peculiar/webcrypto | 1.7.1 | MIT | an optional dependency that is absent from the built output |
| @sindresorhus/is | 4.6.0 | MIT | an optional dependency that is absent from the built output |
| @szmarczak/http-timer | 4.0.6 | MIT | an optional dependency that is absent from the built output |
| @types/cacheable-request | 6.0.3 | MIT | an optional dependency that is absent from the built output |
| @types/debug | 4.1.13 | MIT | an optional dependency that is absent from the built output |
| @types/fs-extra | 9.0.13 | MIT | an optional dependency that is absent from the built output |
| @types/http-cache-semantics | 4.2.0 | MIT | an optional dependency that is absent from the built output |
| @types/keyv | 3.1.4 | MIT | an optional dependency that is absent from the built output |
| @types/ms | 2.1.0 | MIT | an optional dependency that is absent from the built output |
| @types/node | 24.13.3 | MIT | an optional dependency that is absent from the built output |
| @types/responselike | 1.0.3 | MIT | an optional dependency that is absent from the built output |
| @xmldom/xmldom | 0.8.14 | MIT | an optional dependency that is absent from the built output |
| abbrev | 4.0.0 | ISC | an optional dependency that is absent from the built output |
| ajv | 8.20.0 | MIT | an optional dependency that is absent from the built output |
| ajv-formats | 3.0.1 | MIT | an optional dependency that is absent from the built output |
| app-builder-lib | 26.15.3 | MIT | an optional dependency that is absent from the built output |
| argparse | 2.0.1 | Python-2.0 | an optional dependency that is absent from the built output |
| asn1js | 3.0.10 | BSD-3-Clause | an optional dependency that is absent from the built output |
| async-exit-hook | 2.0.1 | MIT | an optional dependency that is absent from the built output |
| at-least-node | 1.0.0 | ISC | an optional dependency that is absent from the built output |
| aws4 | 1.13.2 | MIT | an optional dependency that is absent from the built output |
| balanced-match | 1.0.2 | MIT | an optional dependency that is absent from the built output |
| balanced-match | 1.0.2 | MIT | an optional dependency that is absent from the built output |
| balanced-match | 1.0.2 | MIT | an optional dependency that is absent from the built output |
| balanced-match | 1.0.2 | MIT | an optional dependency that is absent from the built output |
| balanced-match | 1.0.2 | MIT | an optional dependency that is absent from the built output |
| base64-js | 1.5.1 | MIT | an optional dependency that is absent from the built output |
| bluebird | 3.7.2 | MIT | an optional dependency that is absent from the built output |
| brace-expansion | 1.1.18 | MIT | an optional dependency that is absent from the built output |
| brace-expansion | 1.1.18 | MIT | an optional dependency that is absent from the built output |
| brace-expansion | 1.1.18 | MIT | an optional dependency that is absent from the built output |
| brace-expansion | 2.1.4 | MIT | an optional dependency that is absent from the built output |
| brace-expansion | 2.1.4 | MIT | an optional dependency that is absent from the built output |
| buffer-from | 1.1.2 | MIT | an optional dependency that is absent from the built output |
| builder-util | 26.15.3 | MIT | an optional dependency that is absent from the built output |
| builder-util-runtime | 9.7.0 | MIT | an optional dependency that is absent from the built output |
| bytestreamjs | 2.0.1 | BSD-3-Clause | an optional dependency that is absent from the built output |
| cacheable-lookup | 5.0.4 | MIT | an optional dependency that is absent from the built output |
| cacheable-request | 7.0.4 | MIT | an optional dependency that is absent from the built output |
| chalk | 4.1.2 | MIT | an optional dependency that is absent from the built output |
| chalk | 4.1.2 | MIT | an optional dependency that is absent from the built output |
| chalk | 4.1.2 | MIT | an optional dependency that is absent from the built output |
| chalk | 4.1.2 | MIT | an optional dependency that is absent from the built output |
| chownr | 3.0.0 | BlueOak-1.0.0 | an optional dependency that is absent from the built output |
| chromium-pickle-js | 0.2.0 | MIT | an optional dependency that is absent from the built output |
| ci-info | 4.3.1 | MIT | an optional dependency that is absent from the built output |
| ci-info | 4.4.0 | MIT | an optional dependency that is absent from the built output |
| cliui | 8.0.1 | ISC | an optional dependency that is absent from the built output |
| clone-response | 1.0.3 | MIT | an optional dependency that is absent from the built output |
| compare-version | 0.1.2 | MIT | an optional dependency that is absent from the built output |
| concat-map | 0.0.1 | MIT | an optional dependency that is absent from the built output |
| core-util-is | 1.0.3 | MIT | an optional dependency that is absent from the built output |
| cross-dirname | 0.1.0 | MIT | an optional dependency that is absent from the built output |
| debounce-fn | 6.0.0 | MIT | an optional dependency that is absent from the built output |
| decompress-response | 6.0.0 | MIT | an optional dependency that is absent from the built output |
| defer-to-connect | 2.0.1 | MIT | an optional dependency that is absent from the built output |
| define-data-property | 1.1.4 | MIT | an optional dependency that is absent from the built output |
| define-properties | 1.2.1 | MIT | an optional dependency that is absent from the built output |
| detect-node | 2.1.0 | MIT | an optional dependency that is absent from the built output |
| dir-compare | 4.2.0 | MIT | an optional dependency that is absent from the built output |
| dmg-builder | 26.15.3 | MIT | an optional dependency that is absent from the built output |
| dot-prop | 10.2.0 | MIT | an optional dependency that is absent from the built output |
| dotenv | 16.6.1 | BSD-2-Clause | an optional dependency that is absent from the built output |
| dotenv-expand | 11.0.7 | BSD-2-Clause | an optional dependency that is absent from the built output |
| duplexer2 | 0.1.4 | BSD-3-Clause | an optional dependency that is absent from the built output |
| electron-builder | 26.15.3 | MIT | an optional dependency that is absent from the built output |
| electron-builder-squirrel-windows | 26.15.3 | MIT | an optional dependency that is absent from the built output |
| electron-publish | 26.15.3 | MIT | an optional dependency that is absent from the built output |
| electron-store | 11.0.2 | MIT | an optional dependency that is absent from the built output |
| electron-winstaller | 5.4.0 | MIT | a native module built at install time, which a browser bundle cannot contain, and it is absent from the built output |
| end-of-stream | 1.4.5 | MIT | an optional dependency that is absent from the built output |
| env-paths | 2.2.1 | MIT | an optional dependency that is absent from the built output |
| env-paths | 2.2.1 | MIT | an optional dependency that is absent from the built output |
| env-paths | 3.0.0 | MIT | an optional dependency that is absent from the built output |
| err-code | 2.0.3 | MIT | an optional dependency that is absent from the built output |
| es6-error | 4.1.1 | MIT | an optional dependency that is absent from the built output |
| escape-string-regexp | 4.0.0 | MIT | an optional dependency that is absent from the built output |
| exponential-backoff | 3.1.3 | Apache-2.0 | an optional dependency that is absent from the built output |
| fast-deep-equal | 3.1.3 | MIT | an optional dependency that is absent from the built output |
| fast-uri | 3.1.5 | BSD-3-Clause | an optional dependency that is absent from the built output |
| filelist | 1.0.6 | Apache-2.0 | an optional dependency that is absent from the built output |
| fs-extra | 10.1.0 | MIT | an optional dependency that is absent from the built output |
| fs-extra | 11.3.1 | MIT | an optional dependency that is absent from the built output |
| fs-extra | 11.4.0 | MIT | an optional dependency that is absent from the built output |
| fs-extra | 11.4.0 | MIT | an optional dependency that is absent from the built output |
| fs-extra | 7.0.1 | MIT | an optional dependency that is absent from the built output |
| fs-extra | 8.1.0 | MIT | an optional dependency that is absent from the built output |
| fs-extra | 9.1.0 | MIT | an optional dependency that is absent from the built output |
| fs-extra | 9.1.0 | MIT | an optional dependency that is absent from the built output |
| fs-extra | 9.1.0 | MIT | an optional dependency that is absent from the built output |
| fs.realpath | 1.0.0 | ISC | an optional dependency that is absent from the built output |
| get-caller-file | 2.0.5 | ISC | an optional dependency that is absent from the built output |
| get-stream | 5.2.0 | MIT | an optional dependency that is absent from the built output |
| global-agent | 3.0.0 | BSD-3-Clause | an optional dependency that is absent from the built output |
| globalthis | 1.0.4 | MIT | an optional dependency that is absent from the built output |
| graceful-fs | 4.2.11 | ISC | an optional dependency that is absent from the built output |
| has-property-descriptors | 1.0.2 | MIT | an optional dependency that is absent from the built output |
| hosted-git-info | 4.1.0 | ISC | an optional dependency that is absent from the built output |
| http-cache-semantics | 4.2.0 | BSD-2-Clause | an optional dependency that is absent from the built output |
| http2-wrapper | 1.0.3 | MIT | an optional dependency that is absent from the built output |
| inflight | 1.0.6 | ISC | an optional dependency that is absent from the built output |
| inherits | 2.0.4 | ISC | an optional dependency that is absent from the built output |
| isarray | 1.0.0 | MIT | an optional dependency that is absent from the built output |
| isbinaryfile | 4.0.10 | MIT | an optional dependency that is absent from the built output |
| isbinaryfile | 5.0.7 | MIT | an optional dependency that is absent from the built output |
| isexe | 3.1.5 | BlueOak-1.0.0 | an optional dependency that is absent from the built output |
| isexe | 4.0.0 | BlueOak-1.0.0 | an optional dependency that is absent from the built output |
| jake | 10.9.4 | Apache-2.0 | an optional dependency that is absent from the built output |
| jiti | 2.7.0 | MIT | an optional dependency that is absent from the built output |
| js-yaml | 4.3.1 | MIT | an optional dependency that is absent from the built output |
| json-buffer | 3.0.1 | MIT | an optional dependency that is absent from the built output |
| json-schema-traverse | 1.0.0 | MIT | an optional dependency that is absent from the built output |
| json-schema-typed | 8.0.2 | BSD-2-Clause | an optional dependency that is absent from the built output |
| json-stringify-safe | 5.0.1 | ISC | an optional dependency that is absent from the built output |
| jsonfile | 4.0.0 | MIT | an optional dependency that is absent from the built output |
| jsonfile | 4.0.0 | MIT | an optional dependency that is absent from the built output |
| jsonfile | 6.2.1 | MIT | an optional dependency that is absent from the built output |
| keyv | 4.5.4 | MIT | an optional dependency that is absent from the built output |
| lazy-val | 1.0.5 | MIT | an optional dependency that is absent from the built output |
| lowercase-keys | 2.0.0 | MIT | an optional dependency that is absent from the built output |
| lru-cache | 6.0.0 | ISC | an optional dependency that is absent from the built output |
| matcher | 3.0.0 | MIT | an optional dependency that is absent from the built output |
| mimic-function | 5.0.1 | MIT | an optional dependency that is absent from the built output |
| mimic-response | 1.0.1 | MIT | an optional dependency that is absent from the built output |
| mimic-response | 3.1.0 | MIT | an optional dependency that is absent from the built output |
| minimatch | 3.1.5 | ISC | an optional dependency that is absent from the built output |
| minimatch | 3.1.5 | ISC | an optional dependency that is absent from the built output |
| minimatch | 3.1.5 | ISC | an optional dependency that is absent from the built output |
| minimatch | 5.1.9 | ISC | an optional dependency that is absent from the built output |
| minimatch | 9.0.9 | ISC | an optional dependency that is absent from the built output |
| minimist | 1.2.8 | MIT | an optional dependency that is absent from the built output |
| minizlib | 3.1.0 | MIT | an optional dependency that is absent from the built output |
| mkdirp | 0.5.6 | MIT | an optional dependency that is absent from the built output |
| node-abi | 4.33.0 | MIT | an optional dependency that is absent from the built output |
| node-api-version | 0.2.1 | MIT | an optional dependency that is absent from the built output |
| node-gyp | 12.4.0 | MIT | an optional dependency that is absent from the built output |
| node-int64 | 0.4.0 | MIT | an optional dependency that is absent from the built output |
| normalize-url | 6.1.0 | MIT | an optional dependency that is absent from the built output |
| object-keys | 1.1.1 | MIT | an optional dependency that is absent from the built output |
| p-cancelable | 2.1.1 | MIT | an optional dependency that is absent from the built output |
| p-limit | 3.1.0 | MIT | an optional dependency that is absent from the built output |
| path-is-absolute | 1.0.1 | MIT | an optional dependency that is absent from the built output |
| pe-library | 0.4.1 | MIT | an optional dependency that is absent from the built output |
| pkijs | 3.4.0 | BSD-3-Clause | an optional dependency that is absent from the built output |
| plist | 3.1.0 | MIT | an optional dependency that is absent from the built output |
| postject | 1.0.0-alpha.6 | MIT | an optional dependency that is absent from the built output |
| proc-log | 6.1.0 | ISC | an optional dependency that is absent from the built output |
| process-nextick-args | 2.0.1 | MIT | an optional dependency that is absent from the built output |
| promise-retry | 2.0.1 | MIT | an optional dependency that is absent from the built output |
| proper-lockfile | 4.1.2 | MIT | an optional dependency that is absent from the built output |
| pump | 3.0.4 | MIT | an optional dependency that is absent from the built output |
| pvtsutils | 1.3.6 | MIT | an optional dependency that is absent from the built output |
| pvutils | 1.2.0 | MIT | an optional dependency that is absent from the built output |
| quick-lru | 5.1.1 | MIT | an optional dependency that is absent from the built output |
| read-binary-file-arch | 1.0.6 | MIT | an optional dependency that is absent from the built output |
| readable-stream | 2.3.8 | MIT | an optional dependency that is absent from the built output |
| require-directory | 2.1.1 | MIT | an optional dependency that is absent from the built output |
| require-from-string | 2.0.2 | MIT | an optional dependency that is absent from the built output |
| resedit | 1.7.2 | MIT | an optional dependency that is absent from the built output |
| resolve-alpn | 1.2.1 | MIT | an optional dependency that is absent from the built output |
| responselike | 2.0.1 | MIT | an optional dependency that is absent from the built output |
| rimraf | 2.6.3 | ISC | an optional dependency that is absent from the built output |
| roarr | 2.15.4 | BSD-3-Clause | an optional dependency that is absent from the built output |
| safe-buffer | 5.1.2 | MIT | an optional dependency that is absent from the built output |
| sanitize-filename | 1.6.4 | WTFPL OR ISC | an optional dependency that is absent from the built output |
| semver | 5.7.2 | ISC | an optional dependency that is absent from the built output |
| semver | 6.3.1 | ISC | an optional dependency that is absent from the built output |
| semver | 7.7.4 | ISC | an optional dependency that is absent from the built output |
| semver | 7.8.5 | ISC | an optional dependency that is absent from the built output |
| semver | 7.8.5 | ISC | an optional dependency that is absent from the built output |
| semver | 7.8.5 | ISC | an optional dependency that is absent from the built output |
| semver | 7.8.5 | ISC | an optional dependency that is absent from the built output |
| semver | 7.8.5 | ISC | an optional dependency that is absent from the built output |
| semver | 7.8.5 | ISC | an optional dependency that is absent from the built output |
| semver | 7.8.5 | ISC | an optional dependency that is absent from the built output |
| semver-compare | 1.0.0 | MIT | an optional dependency that is absent from the built output |
| serialize-error | 7.0.1 | MIT | an optional dependency that is absent from the built output |
| signal-exit | 3.0.7 | ISC | an optional dependency that is absent from the built output |
| simple-update-notifier | 2.0.0 | MIT | an optional dependency that is absent from the built output |
| source-map-support | 0.5.21 | MIT | an optional dependency that is absent from the built output |
| sprintf-js | 1.1.3 | BSD-3-Clause | an optional dependency that is absent from the built output |
| stat-mode | 1.0.0 | MIT | an optional dependency that is absent from the built output |
| string_decoder | 1.1.1 | MIT | an optional dependency that is absent from the built output |
| stubborn-fs | 2.0.0 | MIT | an optional dependency that is absent from the built output |
| stubborn-utils | 1.0.2 | MIT | an optional dependency that is absent from the built output |
| sumchecker | 3.0.1 | Apache-2.0 | an optional dependency that is absent from the built output |
| tagged-tag | 1.0.0 | MIT | an optional dependency that is absent from the built output |
| temp-file | 3.4.0 | MIT | an optional dependency that is absent from the built output |
| tiny-async-pool | 1.3.0 | MIT | an optional dependency that is absent from the built output |
| tmp-promise | 3.0.3 | MIT | an optional dependency that is absent from the built output |
| truncate-utf8-bytes | 1.0.2 | WTFPL | an optional dependency that is absent from the built output |
| tslib | 2.8.1 | 0BSD | an optional dependency that is absent from the built output |
| type-fest | 0.13.1 | (MIT OR CC0-1.0) | an optional dependency that is absent from the built output |
| type-fest | 5.8.0 | (MIT OR CC0-1.0) | an optional dependency that is absent from the built output |
| uint8array-extras | 1.5.0 | MIT | an optional dependency that is absent from the built output |
| undici | 6.28.0 | MIT | an optional dependency that is absent from the built output |
| undici | 7.29.0 | MIT | an optional dependency that is absent from the built output |
| undici-types | 7.18.2 | MIT | an optional dependency that is absent from the built output |
| universalify | 0.1.2 | MIT | an optional dependency that is absent from the built output |
| universalify | 0.1.2 | MIT | an optional dependency that is absent from the built output |
| universalify | 2.0.1 | MIT | an optional dependency that is absent from the built output |
| unzipper | 0.12.5 | MIT | an optional dependency that is absent from the built output |
| utf8-byte-length | 1.0.5 | (WTFPL OR MIT) | an optional dependency that is absent from the built output |
| util-deprecate | 1.0.2 | MIT | an optional dependency that is absent from the built output |
| webcrypto-core | 1.9.2 | MIT | an optional dependency that is absent from the built output |
| when-exit | 2.1.5 | MIT | an optional dependency that is absent from the built output |
| wrap-ansi | 7.0.0 | MIT | an optional dependency that is absent from the built output |
| wrappy | 1.0.2 | ISC | an optional dependency that is absent from the built output |
| xmlbuilder | 15.1.1 | MIT | an optional dependency that is absent from the built output |
| y18n | 5.0.8 | ISC | an optional dependency that is absent from the built output |
| yallist | 4.0.0 | ISC | an optional dependency that is absent from the built output |
| yallist | 5.0.0 | BlueOak-1.0.0 | an optional dependency that is absent from the built output |
| yargs | 17.7.3 | MIT | an optional dependency that is absent from the built output |
| yargs-parser | 21.1.1 | ISC | an optional dependency that is absent from the built output |
| yocto-queue | 0.1.0 | MIT | an optional dependency that is absent from the built output |

## What is not in this list

Vendored code — an emulator core compiled into the image rather than
installed from a registry — is not in the lockfile. It is recorded in
`docs/third-party-components.md` with its upstream revision and licence, and
the release gate verifies its checksums on every run. The ElkJS core carried
there is GPL-2.0, which is the outstanding licence position recorded in
`docs/adr/0008-elkjs-electron-adapter-and-gpl-position.md`.
