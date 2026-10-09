# Experimental source-built remote-hook candidate for LG C5

**Do not install automatically.** The currently shipped HomeBack native hook and its behavior are the tested baseline. This directory adds a separate review-only build. It does not modify `webpack.config.ts`, the service's input processes, the production vendor binaries or remote mappings.

Source commits, toolchain URL and SHA256 are documented in `source-lock.json`. The workflow builds from these exact commits; a clean pinned checkout is required before the native patch applies. A build failure or unexpected function signature does not fall back to an unreviewed replacement.

The patch intentionally retains the existing log-event signatures consumed by HomeBack. It fixes shared keybind-table write serialization, input-buffer mutation, uinput write-size validation, and escaping JSON supplied to the Luna app launcher. Linker `-Bsymbolic` is an experiment addressing possible symbol interposition in another webOS generation; it is **not** evidence that the already working C5 had that problem.

The workflow publishes review artifacts only (`ezinject`, `libinputhookpp.so`, SHA256SUMS and source provenance) with a clear NOT-QUALIFIED marker. No installer/package workflow consumes these artifacts automatically.

Before considering a production swap, verify exact ABI and behavior on the user's working LG C5 device, then test structured IPC and native fail-open leases as separately gated changes. Do not infer daemon ELF class solely from the 64-bit C5 kernel. Third-party source and distribution licensing must also be reviewed: `sundermann/inputhookpp` is GPLv3 and HomeBack declares GPL-2.0-only.
