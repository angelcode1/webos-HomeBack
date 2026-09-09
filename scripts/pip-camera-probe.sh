#!/bin/sh
set -eu

APP_FG_URI='luna://com.webos.service.applicationmanager/getForegroundAppInfo'
APP_STATUS_URI='luna://com.webos.service.applicationmanager/getAppStatus'
APP_INFO_URI='luna://com.webos.service.applicationmanager/getAppInfo'
APP_RUNNING_URI='luna://com.webos.service.applicationmanager/running'
WAM_RUNNING_URI='luna://com.webos.service.webappmanager/listRunningApps'
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
		main_id='com.webos.app.livetv'
		sub_id='youtube.leanback.v4'
		;;
	known-browser)
		# webOS OSE Surface Manager documentation uses Live TV + Browser as a
		# Multi View/PiP example. On LG TV firmware this is a useful general-web
		# CARD control against the HomeBack CARD probe.
		main_id='com.webos.app.livetv'
		sub_id='com.webos.app.browser'
		;;
	known-amazon)
		# Community LG-TV reports show the stock Prime Video app (id "amazon")
		# can be a PiP sub on some models. This mode is optional and harmless if
		# that app is not installed/eligible on the target TV.
		main_id='com.webos.app.livetv'
		sub_id='amazon'
		;;
	known-hdmi1)
		main_id='com.webos.app.hdmi1'
		sub_id='youtube.leanback.v4'
		;;
	homeback|livetv-homeback)
		main_id='com.webos.app.livetv'
		sub_id='com.homebrew.homeback'
		;;
	hdmi1-homeback)
		main_id='com.webos.app.hdmi1'
		sub_id='com.homebrew.homeback'
		;;
	youtube-homeback)
		main_id='youtube.leanback.v4'
		sub_id='com.homebrew.homeback'
		;;
	*)
		echo "Usage: $0 [inspect|known|known-livetv|known-browser|known-amazon|known-hdmi1|homeback|livetv-homeback|hdmi1-homeback|youtube-homeback]" >&2
		exit 2
		;;
esac

foreground_info() {
	echo '[Application Manager + extraInfo]'
	luna-send -n 1 -f "$APP_FG_URI" '{"subscribe":false,"extraInfo":true}' || true
	echo '[Surface Manager direct]'
	luna-send -n 1 -f "$SURFACE_FG_URI" '{"subscribe":false}' || true
}

surface_info() {
	luna-send -n 1 -f "$SURFACE_FG_URI" '{"subscribe":false}' || true
}

app_diagnostics() {
	app_id=$1
	echo "[App status: $app_id]"
	luna-send -n 1 -f "$APP_STATUS_URI" "{\"appId\":\"$app_id\"}" || true
	echo "[App manifest fields: $app_id]"
	luna-send -n 1 -f "$APP_INFO_URI" "{\"id\":\"$app_id\",\"properties\":[\"id\",\"type\",\"main\",\"defaultWindowType\",\"visible\",\"handlesRelaunch\",\"supportQuickStart\",\"supportGIP\",\"trustLevel\",\"vendorExtension\"]}" || true
}

running_diagnostics() {
	echo '[Application Manager running apps]'
	luna-send -n 1 -f "$APP_RUNNING_URI" '{"subscribe":false}' || true
	echo '[Web App Manager running apps]'
	luna-send -n 1 -f "$WAM_RUNNING_URI" '{"subscribe":false}' || true
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

# Poll only Surface Manager at multiple points. A single two-second snapshot can
# miss a slowly registered or short-lived sub surface; these samples distinguish
# that case from a sub app which runs in WAM but is never composited as PiP.
(
	sleep 1
	echo
	echo '--- Surface Manager t+1s ---'
	surface_info
	sleep 2
	echo
	echo '--- Surface Manager t+3s ---'
	surface_info
	sleep 3
	echo
	echo '--- Surface Manager t+6s ---'
	surface_info
	sleep 4
	echo
	echo '--- Surface Manager t+10s ---'
	surface_info
	sleep 5
	echo
	echo '--- Surface Manager t+15s ---'
	surface_info
) &
poll_pid=$!

sleep 2

echo
echo '--- foreground two seconds after request ---'
foreground_info
echo
echo '--- app diagnostics two seconds after request ---'
app_diagnostics "$main_id"
app_diagnostics "$sub_id"
echo
echo '--- running-process diagnostics two seconds after request ---'
running_diagnostics

cat <<EOF

For the next 20 seconds, test the remote without selecting the PiP window:
  1. D-pad the MAIN app.
  2. Press OK in the MAIN app.
  3. Note whether HomeBack receives/steals those actions.
  4. If LG exposes its Multi View controls, note which surface is marked active.

Expected successful PiP surface state is conceptually:
  main: primary=true,  pip=false, viewType=mvpip, CARD
  sub:  primary=false, pip=true,  viewType=mvpip, CARD

Surface polling is running at t+1/3/6/10/15 seconds (pid=$poll_pid).
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
