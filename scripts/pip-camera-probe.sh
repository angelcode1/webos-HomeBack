#!/bin/sh
set -eu

APP_FG_URI='luna://com.webos.service.applicationmanager/getForegroundAppInfo'
SURFACE_FG_URI='luna://com.webos.surfacemanager/getForegroundAppInfo'
MV_URI='luna://com.webos.service.multiviewcontroller/launchApps'
CLOSE_URI='luna://com.webos.service.applicationManager/closeByAppId'

mode="${1:-known}"
case "$mode" in
	inspect)
		main_id=''
		sub_id=''
		;;
	known|known-livetv)
		# Live TV is a control pair only, not a HomeBack production dependency.
		# The lgc5 optimizer keeps com.webos.app.livetv itself available even though
		# it logically deletes several Live-TV adjuncts and the stock Multi View UI.
		main_id='com.webos.app.livetv'
		sub_id='youtube.leanback.v4'
		;;
	known-hdmi1)
		# LG also documents HDMI + YouTube as a supported Multi View combination.
		# This avoids depending on tuner/broadcast setup, but the active HDMI signal
		# must itself be Multi View compatible (not Dolby Vision / 4K HFR, etc.).
		main_id='com.webos.app.hdmi1'
		sub_id='youtube.leanback.v4'
		;;
	homeback|livetv-homeback)
		# Eligibility test using the same Live TV control main surface.
		main_id='com.webos.app.livetv'
		sub_id='com.homebrew.homeback'
		;;
	hdmi1-homeback)
		# Production-relevant alternative: preserve HDMI1 as main and ask HomeBack
		# to become the PiP sub-surface.
		main_id='com.webos.app.hdmi1'
		sub_id='com.homebrew.homeback'
		;;
	youtube-homeback)
		# Production-relevant alternative: preserve YouTube as the main app while
		# testing HomeBack as the PiP sub-surface.
		main_id='youtube.leanback.v4'
		sub_id='com.homebrew.homeback'
		;;
	*)
		echo "Usage: $0 [inspect|known|known-livetv|known-hdmi1|homeback|livetv-homeback|hdmi1-homeback|youtube-homeback]" >&2
		exit 2
		;;
esac

foreground_info() {
	echo '[Application Manager + extraInfo]'
	luna-send -n 1 -f "$APP_FG_URI" '{"subscribe":false,"extraInfo":true}' || true
	echo '[Surface Manager direct]'
	# Surface Manager is private on stock webOS. A rooted/private-bus shell may
	# reach it directly; failure here is diagnostic rather than fatal because
	# Application Manager extraInfo proxies LSM foreground state as well.
	luna-send -n 1 -f "$SURFACE_FG_URI" '{"subscribe":false}' || true
}

echo '=== HomeBack Multi View / PiP hardware probe ==='
echo "mode=$mode"
echo "uid=$(id -u 2>/dev/null || echo unknown)"
echo

echo '--- foreground before ---'
foreground_info

if [ "$mode" = 'inspect' ]; then
	exit 0
fi

payload="{\"apps\":[{\"appId\":\"$main_id\",\"role\":\"main\",\"order\":0},{\"appId\":\"$sub_id\",\"role\":\"sub\",\"order\":1}],\"mode\":\"pip\"}"

echo
echo '--- launchApps request ---'
echo "$payload"
echo
echo '--- launchApps response ---'
set +e
luna-send -n 1 -f "$MV_URI" "$payload"
launch_status=$?
set -e
printf 'luna-send exit=%s\n' "$launch_status"

if [ "$launch_status" -ne 0 ]; then
	cat <<'EOF'
Private-bus invocation failed at the process level. On firmware where the
controller is exposed only on the public bus, repeat the same request with
`luna-send-pub` manually and retain both responses in the test log.
EOF
fi

sleep 2

echo
echo '--- foreground two seconds after request ---'
foreground_info

cat <<EOF

For the next 20 seconds, test the remote without selecting the PiP window:
  1. D-pad the MAIN app.
  2. Press OK in the MAIN app.
  3. Note whether HomeBack receives/steals those actions.
  4. If LG exposes its Multi View controls, note which surface is marked active.

Expected successful PiP surface state is conceptually:
  main: primary=true,  pip=false, viewType=mvpip, CARD
  sub:  primary=false, pip=true,  viewType=mvpip, CARD

A safety cleanup will close only the sub app after 20 seconds and then print
foreground state again. main=$main_id sub=$sub_id
EOF

(
	sleep 20
	echo
	echo '--- safety cleanup: close sub app ---'
	luna-send -n 1 -f "$CLOSE_URI" "{\"id\":\"$sub_id\"}" || true
	sleep 2
	echo
	echo '--- foreground after sub close ---'
	foreground_info
) &

echo "cleanup_pid=$!"
