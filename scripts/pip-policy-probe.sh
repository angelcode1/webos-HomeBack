#!/bin/sh
set -u

APP_INFO_URI='luna://com.webos.service.applicationmanager/getAppInfo'
APP_RUNNING_URI='luna://com.webos.service.applicationmanager/running'
WAM_RUNNING_URI='luna://com.webos.service.webappmanager/listRunningApps'
SURFACE_FG_URI='luna://com.webos.surfacemanager/getForegroundAppInfo'

echo '=== HomeBack Multi View policy / runtime probe ==='
echo "uid=$(id -u 2>/dev/null || echo unknown)"
echo

echo '--- current Surface Manager state ---'
luna-send -n 1 -f "$SURFACE_FG_URI" '{"subscribe":false}' || true

echo

echo '--- complete appInfo snapshots ---'
for app_id in com.homebrew.homeback com.webos.app.browser youtube.leanback.v4 amazon; do
	echo
	echo "[getAppInfo: $app_id]"
	luna-send -n 1 -f "$APP_INFO_URI" "{\"id\":\"$app_id\"}" || true
done

echo

echo '--- Application Manager running apps ---'
luna-send -n 1 -f "$APP_RUNNING_URI" '{"subscribe":false}' || true

echo

echo '--- Web App Manager running apps ---'
luna-send -n 1 -f "$WAM_RUNNING_URI" '{"subscribe":false}' || true

echo

echo '--- LS2 registration / role references for multiviewcontroller ---'
for root in \
	/usr/share/luna-service2 \
	/etc/palm \
	/usr/palm/services \
	/mnt/otncabi/usr/palm/services; do
	if [ -d "$root" ]; then
		echo "[search root: $root]"
		grep -R -n -I 'com.webos.service.multiviewcontroller' "$root" 2>/dev/null | head -80 || true
	fi
done

if command -v ls-monitor >/dev/null 2>&1; then
	echo
	echo '--- ls-monitor registrations containing multiview ---'
	ls-monitor -l 2>/dev/null | grep -i 'multiview' | head -80 || true
fi

echo

echo '--- filesystem names containing multiview / mvpip ---'
for root in \
	/usr/palm \
	/usr/share \
	/etc/palm \
	/mnt/otncabi/usr/palm \
	/media/cryptofs/apps/usr/palm; do
	if [ -d "$root" ]; then
		echo "[find root: $root]"
		find "$root" -maxdepth 7 \( -iname '*multiview*' -o -iname '*mvpip*' \) -print 2>/dev/null | head -120 || true
	fi
done

echo

echo '--- multiview-related processes ---'
ps 2>/dev/null | grep -i '[m]ultiview' || true

echo

echo '--- recent relevant logs (best effort) ---'
if command -v journalctl >/dev/null 2>&1; then
	journalctl --no-pager -n 1200 2>/dev/null \
		| grep -Ei 'multiview|mvpip|homeback|webappmgr|webappmanager|surfacemanager' \
		| tail -220 || true
fi
for log in /var/log/messages /var/log/messages.0 /var/log/pm-log-daemon.log; do
	if [ -f "$log" ]; then
		echo "[log: $log]"
		tail -1200 "$log" 2>/dev/null \
			| grep -Ei 'multiview|mvpip|homeback|webappmgr|webappmanager|surfacemanager' \
			| tail -220 || true
	fi
done

echo
cat <<'EOF'
=== Interpretation ===
Keep this output together with a known-browser and a HomeBack-sub run.

- Browser PiP succeeds, HomeBack PiP never appears, and HomeBack is present in
  WAM/running: investigate LG app-eligibility metadata or an allowlist/policy.
- Browser and HomeBack both fail as sub while YouTube succeeds: firmware likely
  limits PiP combinations more tightly than the OSE Surface Manager examples.
- HomeBack is absent from WAM/running: investigate launch/runtime failure before
  touching Multi View policy.
- HomeBack appears in WAM/running but never in Surface Manager: launch succeeded
  but no composited PiP surface was admitted/created.
EOF
