#!/usr/bin/env bash
# Compile review-only ARM32 candidates from pinned source. Never install on a TV.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${HOMEBACK_NATIVE_WORK:-$ROOT/.native-build}"
OUT="${HOMEBACK_NATIVE_OUT:-$ROOT/native-artifacts}"
SDK=/opt/arm-lgtv-linux-gnueabi_sdk-buildroot
TOOLCHAIN_FILE="$SDK/share/buildroot/toolchainfile.cmake"
SDK_URL=https://github.com/sundermann/buildroot-nc4/releases/download/2025.02-03/linux-intel-lgtv-sdk.tar.gz
SDK_SHA=8453e05a2e334cac891f41faa8582e43263c711b491256500d126f442c231749
INPUTHOOK_SHA=9dc3cf140cb1ae1dbe059525c72710deea7ecf7d
EZINJECT_SHA=607055c06b037eadc3992008940d99bdc4a14f53

for command in git cmake make python3 sha256sum curl tar readelf; do
  command -v "$command" >/dev/null || { echo "Missing build tool: $command" >&2; exit 1; }
done
if [[ -e "$WORK" || -e "$OUT" ]]; then
  echo "Refusing to overwrite an existing native work or output directory" >&2
  exit 1
fi
mkdir -p "$WORK" "$OUT"
if [[ ! -f "$TOOLCHAIN_FILE" ]]; then
  if [[ -e "$SDK" ]]; then
    echo "Unrecognized or incomplete SDK: $SDK" >&2
    exit 1
  fi
  curl --fail --location --retry 3 --silent --show-error "$SDK_URL" -o "$WORK/webos-sdk.tar.gz"
  echo "$SDK_SHA  $WORK/webos-sdk.tar.gz" | sha256sum --check --status
  # CI uses an ephemeral Ubuntu runner. No changes are made on an LG TV.
  sudo tar -xf "$WORK/webos-sdk.tar.gz" -C /opt
  (cd "$SDK" && sudo ./relocate-sdk.sh)
fi
[[ -f "$TOOLCHAIN_FILE" ]] || { echo 'Missing pinned SDK toolchain file' >&2; exit 1; }

# Git checkout to an exact commit, not to an unreviewed moving branch.
git clone https://github.com/smx-smx/ezinject.git "$WORK/ezinject"
git -C "$WORK/ezinject" checkout --detach "$EZINJECT_SHA"
[[ "$(git -C "$WORK/ezinject" rev-parse HEAD)" == "$EZINJECT_SHA" ]]
git -C "$WORK/ezinject" submodule update --init --recursive
cmake -S "$WORK/ezinject" -B "$WORK/ezinject-build" \
  -DEZ_LIBC=glibc -DUSE_FRIDA_GUM=1 \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$SDK/arm-lgtv-linux-gnueabi/sysroot" \
  -DCMAKE_TOOLCHAIN_FILE="$TOOLCHAIN_FILE"
cmake --build "$WORK/ezinject-build" -j "$(nproc)"
sudo cmake --install "$WORK/ezinject-build"

git clone https://github.com/sundermann/inputhookpp.git "$WORK/inputhookpp"
git -C "$WORK/inputhookpp" checkout --detach "$INPUTHOOK_SHA"
python3 "$ROOT/native/patch-inputhook.py" "$WORK/inputhookpp"
cmake -S "$WORK/inputhookpp" -B "$WORK/inputhookpp-build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_TOOLCHAIN_FILE="$TOOLCHAIN_FILE"
cmake --build "$WORK/inputhookpp-build" --target inputhookpp -j "$(nproc)"

INSTALL_BIN="$SDK/arm-lgtv-linux-gnueabi/sysroot/bin/ezinject"
INSTALL_LIB="$WORK/inputhookpp-build/libinputhookpp.so"
[[ -f "$INSTALL_BIN" && -f "$INSTALL_LIB" ]] || {
  echo "Native build did not produce the expected upstream output paths" >&2
  exit 1
}
cp -- "$INSTALL_BIN" "$OUT/ezinject"
cp -- "$INSTALL_LIB" "$OUT/libinputhookpp.so"
cp -- "$WORK/inputhookpp/LICENSE" "$OUT/INPUTHOOKPP-GPL-3.0.txt"
cp -- "$WORK/ezinject/COPYING" "$OUT/EZINJECT-COPYING.txt"
for artifact in "$OUT/ezinject" "$OUT/libinputhookpp.so"; do
  readelf -h "$artifact" | grep -Eq 'Class:[[:space:]]*ELF32' || {
    echo "Wrong ELF class: $artifact" >&2; exit 1;
  }
  readelf -h "$artifact" | grep -Eq 'Machine:[[:space:]]*ARM' || {
    echo "Wrong ELF machine: $artifact" >&2; exit 1;
  }
done
(
  cd "$OUT"
  sha256sum ezinject libinputhookpp.so > SHA256SUMS
  printf 'inputhookpp=%s\nezinject=%s\ncompiler_toolchain_sha256=%s\n' \
    "$INPUTHOOK_SHA" "$EZINJECT_SHA" "$SDK_SHA" > SOURCE-LOCK.txt
  printf 'REVIEW CANDIDATE ONLY - not validated on an LG C5.\nThe current HomeBack production APK payload remains unchanged.\n' > NOT-QUALIFIED.txt
)
echo "Created review-only candidate: $OUT"
