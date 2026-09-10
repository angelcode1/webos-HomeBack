#!/bin/sh
set -eu

APP_FG_URI='luna://com.webos.service.applicationmanager/getForegroundAppInfo'
APP_STATUS_URI='luna://com.webos.service.applicationmanager/getAppStatus'
APP_INFO_URI='luna://com.webos.service.applicationmanager/getAppInfo'
APP_RUNNING_URI='luna://com.webos.service.applicationmanager/running'
WAM_RUNNING_URI='luna://com.webos.service.webappmanager/listRunningApps'
SURFACE_FG_URI='luna://com.webos.surfacemanager/getForegroundAppInfo'
MV_BASE='luna://com.webos.service.multiviewcontroller'
MV_URI="$MV_BASE/launchApps"
CLOSE_URI='luna://com.webos.service.applicationManager/closeByAppId'
LOG_FILE='/var/log/messages'

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
		main_id='com.webos.app.livetv'
		sub_id='com.webos.app.browser'
		;;
	known-amazon)
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
	companion|livetv-companion)
		main_id='com.webos.app.livetv'
		sub_id='com.homebrew.homeback.camera'
		;;
	hdmi1-companion)
		main_id='com.webos.app.hdmi1'
		sub_id='com.homebrew.homeback.camera'
		;;
	youtube-companion)
		main_id='youtube.leanback.v4'
		sub_id='com.homebrew.homeback.camera'
		;;
	*)
		echo "Usage: $0 [inspect|known|known-livetv|known-browser|known-amazon|known-hdmi1|homeback|livetv-homeback|hdmi1-homeback|youtube-homeback|companion|livetv-companion|hdmi1-companion|youtube-companion]" >&2
		exit 2
		;;
esac

is_homeback_camera_sub() {
	case "$sub_id" in
		com.homebrew.homeback|com.homebrew.homeback.camera) return 0 ;;
		*) return 1 ;;
	esac
}

foreground_info() {
	echo '[Application Manager + extraInfo]'
	luna-send -n 1 -f "$APP_FG_URI" '{"subscribe":false,"extraInfo":true}' || true
	echo '[Surface Manager direct]'
	luna-send -n 1 -f "$SURFACE_FG_URI" '{"subscribe":false}' || true
}

surface_info() {
	luna-send -n 1 -f "$SURFACE_FG_URI" '{"subscribe":false}' || true
}

controller_snapshot() {
	for method in getStatus getMultiviewStatus getRestrictionStatus getConfigInfo; do
		echo "[Multi View controller: $method]"
		luna-send -n 1 -f "$MV_BASE/$method" '{}' || true
	done
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

log_start_lines=0
if [ -r "$LOG_FILE" ]; then
	log_start_lines=$(wc -l < "$LOG_FILE" 2>/dev/null | tr -d ' ' || echo 0)
fi

transition_logs() {
	if [ ! -r "$LOG_FILE" ]; then
		echo '[transition log unavailable]'
		return
	fi
	log_end_lines=$(wc -l < "$LOG_FILE" 2>/dev/null | tr -d ' ' || echo 0)
	case "$log_start_lines:$log_end_lines" in
		*[!0-9:]*|'')
			echo '[transition log line count unavailable]'
			return
			;;
	esac
	log_delta=$((log_end_lines - log_start_lines))
	if [ "$log_delta" -le 0 ]; then
		echo '[no new transition log lines]'
		return
	fi
	tail -n "$log_delta" "$LOG_FILE" 2>/dev/null \
		| grep -E 'HomeBackPiPProbe|com\.homebrew\.homeback|multiviewcontroller|surface-manager|WebAppMgr|SAM .*APP_(LAUNCH|CLOSE)|SAM .*LIFE_STATUS|SAM .*RUNTIME_STATUS' \
		|| true
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

if is_homeback_camera_sub; then
	cat <<'EOF'

*** CONTROLLED INPUT TEST ***
DO NOT TOUCH THE REMOTE until this script prints:
    >>> NOW TEST D-PAD + OK <<<
The t+1/3/6/10/12 samples are therefore an IDLE retention test. Only after the
marker should you press D-pad and OK, without deliberately selecting the PiP.
The t+15 sample shows whether input caused a control/focus transition.
EOF
fi

(
	sleep 1
	echo
	echo '--- Surface Manager t+1s ---'
	surface_info
	sleep 2
	echo
	echo '--- Surface Manager t+3s ---'
	surface_info
	echo '--- Controller snapshot t+3s ---'
	controller_snapshot
	sleep 3
	echo
	echo '--- Surface Manager t+6s ---'
	surface_info
	echo '--- Controller snapshot t+6s ---'
	controller_snapshot
	sleep 4
	echo
	echo '--- Surface Manager t+10s ---'
	surface_info
	sleep 2
	echo
	echo '--- Surface Manager t+12s (pre-input) ---'
	surface_info
	if is_homeback_camera_sub; then
		echo
		echo '>>> NOW TEST D-PAD + OK <<<'
		echo 'Do not deliberately select the PiP; operate the MAIN app only.'
	fi
	sleep 3
	echo
	echo '--- Surface Manager t+15s (post-input window) ---'
	surface_info
	echo '--- Controller snapshot t+15s ---'
	controller_snapshot
	echo
	echo '--- transition logs through t+15s ---'
	transition_logs
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

if is_homeback_camera_sub; then
	cat <<EOF

Keep the remote untouched until the t+12 marker. Then test D-pad + OK on the
MAIN app only. Expected retained PiP before and after input:
  main: primary=true,  pip=false, viewType=mvpip, CARD
  sub:  primary=false, pip=true,  viewType=mvpip, CARD

Polling: t+1/3/6/10/12/15 seconds (pid=$poll_pid).
EOF
else
	cat <<EOF

Expected successful PiP surface state is conceptually:
  main: primary=true,  pip=false, viewType=mvpip, CARD
  sub:  primary=false, pip=true,  viewType=mvpip, CARD

Polling: t+1/3/6/10/12/15 seconds (pid=$poll_pid).
EOF
fi

cat <<EOF
A safety cleanup will close only the requested sub app after 20 seconds and
then print foreground state again. main=$main_id sub=$sub_id
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
