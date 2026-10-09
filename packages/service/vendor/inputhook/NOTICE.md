# Native input-hook provenance (source-built)

The build workflows now obtain executable payloads from **pinned public
source**, not from files tracked in this directory:

- `inputhookpp`: https://github.com/sundermann/inputhookpp
  pinned at `9dc3cf140cb1ae1dbe059525c72710deea7ecf7d`
- `ezinject`: https://github.com/smx-smx/ezinject
  pinned at `607055c06b037eadc3992008940d99bdc4a14f53`
- Toolchain SDK: https://github.com/sundermann/buildroot-nc4
  digest and exact archive URL in `native/source-lock.json`

Reviewable C5 source transformations and corresponding tests are in
`native/patch-inputhook.py` and `native/test_source_contract.py`. CI bundles
the modified native library with `INPUTHOOKPP-GPL-3.0.txt`, `SOURCE-LOCK.txt`
and `EZINJECT-COPYING.txt`. Original authors retain their copyrights.
The modified native library is GPL-3.0. HomeBack application code has an
existing GPL-2.0-only declaration; review compatibility before any stable
public distribution.

## Historical note

Versions up to the tested HomeBack 0.7.0 bundle contained unofficial,
modified community binaries whose precise source and license were not known.
Those historical binary hashes, the previous LGPL/InputHook claims and the
associated risk are documented in historical commits and
`THIRD_PARTY_NOTICES.md`. Do not misattribute that unknown binary to the
newly built public-source version.

The known-good 0.7.1 C5 experimental release remains available separately
for rollback. A new native IPC build requires a device-side reboot and
acceptance testing before changing the stable catalog.
