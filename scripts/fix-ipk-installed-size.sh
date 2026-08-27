#!/usr/bin/env bash
# Patches the built .ipk to add an `Installed-Size` field to its control file.
#
# @webosbrew/webos-packager-plugin (as of 2.0.4, the latest release) never writes
# Installed-Size into the control section, and offers no public option to inject one
# (appendControlSection's `overrides` param is private and always called with no
# arguments). webosbrew/apps-repo's own submission linter requires this field to read
# the IPK's appinfo.json, so without it every PR against apps-repo fails CI. This
# works around the upstream gap until the plugin fixes it, by unpacking the ipk's ar
# archive, adding the field to the control file, and repacking it.
set -euo pipefail

IPK="$1"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

cp "$IPK" "$WORKDIR/orig.ipk"
cd "$WORKDIR"
ar x orig.ipk

mkdir -p control_extract data_extract
tar xzf control.tar.gz -C control_extract
tar xzf data.tar.gz -C data_extract

INSTALLED_SIZE="$(du -sk data_extract | cut -f1)"
echo "Computed Installed-Size: ${INSTALLED_SIZE} KiB"

sed -i "/^Architecture:/a Installed-Size: ${INSTALLED_SIZE}" control_extract/control

rm -f control.tar.gz
tar czf control.tar.gz -C control_extract control

rm -f patched.ipk
ar rc patched.ipk debian-binary control.tar.gz data.tar.gz

cp patched.ipk "$IPK"
echo "Patched $IPK in place."
