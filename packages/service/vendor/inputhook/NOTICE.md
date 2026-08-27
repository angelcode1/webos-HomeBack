# Native input-hook payload provenance

HomeBack bundles these native files:

- `ezinject`
- `libinputhookpp.so`

They were extracted from an unofficial webOS community/Telegram package commonly described as **LG Input Hook 1.5.0**. This package made remote interception work on TVs where the public LG Input Hook 1.4.0 build did not.

The exact author of the later native modifications and their corresponding modified source are not currently known. HomeBack therefore does not describe these binaries as an official Simon34545/lginputhook 1.5.0 release, and does not claim that the unknown modifications are licensed by HomeBack under GPL-2.0.

The original public project is:

- LG Input Hook: https://github.com/Simon34545/lginputhook
- Public version: 1.4.0
- Upstream license: BSD 3-Clause

A copy of that **upstream** BSD license is kept in `UPSTREAM-LICENSE.md`. It documents the license of the public LG Input Hook project; it should not be read as proof of the license status of unidentified later binary modifications.

HomeBack uses the payload only as the low-level native key-interception mechanism. HomeBack implements its own mapping policy, short/long-press state machine, application actions, ownership verification, injection/adoption lifecycle, retry handling and service integration around it.

Payload SHA-256 values:

- `ezinject`: `3a03f5ea162651315cdbe710f6da815c8dd2650ea733e401a6cdce06943741b5`
- `libinputhookpp.so`: `fc1cd1e207e9d0c1fadb3019e340c56ab68b031a77ed207cb3a55b2d8641c084`
