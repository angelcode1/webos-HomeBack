# Third-party notices

HomeBack combines original/modified HomeBack code with work derived from or inspired by other open-source webOS projects. This file records the known licensing and provenance boundaries.

## AltHome

Project: https://github.com/kitsuned/AltHome  
License: GNU General Public License v2.0 (GPL-2.0)

HomeBack is derived from the AltHome launcher codebase. HomeBack therefore distributes its own source under GPL-2.0-only and retains the applicable GPL obligations and notices.

## LG Input Hook

Project: https://github.com/Simon34545/lginputhook  
Public upstream version: 1.4.0  
License: BSD 3-Clause

LG Input Hook is the original open-source remote-button remapping project whose native interception approach inspired HomeBack's integrated remote-input subsystem. The upstream project credits smx-smx for `ezinject` / hookfactory and Informatic for the original input-hook script.

The BSD 3-Clause license text for the public upstream project is preserved in:

```text
packages/service/vendor/inputhook/UPSTREAM-LICENSE.md
```

## Unofficial native payload bundled by HomeBack

Files:

```text
packages/service/vendor/inputhook/ezinject
packages/service/vendor/inputhook/libinputhookpp.so
```

These binaries were obtained from an unofficial community/Telegram package described as LG Input Hook 1.5.0. They are not the public 1.4.0 binaries from Simon34545/lginputhook. The identity of the person who produced the modified native build and the corresponding modified source code are not currently known.

Known SHA-256 hashes:

- `ezinject`: `3a03f5ea162651315cdbe710f6da815c8dd2650ea733e401a6cdce06943741b5`
- `libinputhookpp.so`: `fc1cd1e207e9d0c1fadb3019e340c56ab68b031a77ed207cb3a55b2d8641c084`

The public LG Input Hook project is BSD-3-Clause, but HomeBack cannot make a definitive licensing representation for unknown later modifications merely because the upstream work used BSD-3-Clause. These binaries are therefore treated as third-party material with **unverified modification provenance/license** and are not relicensed by the HomeBack GPL-2.0-only notice.

Anyone publishing HomeBack through a public repository should confirm that redistribution of these exact modified binaries is permitted, and ideally obtain or locate their corresponding source/provenance.

A community package named `org.webosbrew.inputhook_1.5.0_all.ipk` has been publicly circulated on webOS community forums, but no corresponding public modified-source repository or authoritative license statement for that community build has been located. HomeBack's `release.sh` therefore requires an explicit maintainer acknowledgement before creating public release artifacts. This is a safety gate, not a legal conclusion.

## webOS Homebrew Channel

HomeBack integrates with the webOS Homebrew Channel's root service and `/var/lib/webosbrew/init.d` boot-hook mechanism, but does not incorporate the Homebrew Channel source code into HomeBack.
