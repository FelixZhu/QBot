#!/usr/bin/env bash
# Install the debug APK on the booted emulator and run the Maestro flows.
# The debug build loads JS from Metro. No upload keystore and no EXPO_TOKEN.
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$APP/e2e/artifacts"
APK="$APP/android/app/build/outputs/apk/debug/app-debug.apk"
METRO_LOG="${RUNNER_TEMP:-/tmp}/metro.log"
BUNDLE="${RUNNER_TEMP:-/tmp}/android-bundle.js"
BUNDLE_URL="http://127.0.0.1:8081/.expo/.virtual-metro-entry.bundle?platform=android&dev=true&lazy=true&minify=false&app=io.github.felixzhu.qiandrive&modulesOnly=false&runModule=true"
export PATH="$PATH:${HOME}/.maestro/bin"
mkdir -p "$OUT"

dump() {
  adb logcat -d -t 8000 > "$OUT/logcat.txt" 2>/dev/null || true
  if [[ -f "$METRO_LOG" ]]; then
    cp "$METRO_LOG" "$OUT/metro.log" || true
  fi
}
trap dump EXIT

if [[ ! -f "$APK" ]]; then
  echo "debug apk missing: $APK"
  exit 1
fi

adb wait-for-device
boot=""
for _ in $(seq 1 30); do
  boot="$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
  if [[ "$boot" == "1" ]]; then
    break
  fi
  sleep 2
done
echo "boot_completed=${boot}"

{
  echo "sdk=$(adb shell getprop ro.build.version.sdk | tr -d '\r')"
  adb shell wm size
  adb shell wm density
} | tee "$OUT/device.txt"

adb reverse tcp:8081 tcp:8081
adb reverse tcp:8799 tcp:8799
adb shell cmd overlay disable com.android.internal.systemui.navbar.gestural || true
adb shell cmd overlay enable com.android.internal.systemui.navbar.threebutton || true
adb shell cmd uimode night no || true
# A hardware keyboard hides the soft keyboard. The chat check needs the IME on screen.
adb shell settings put secure show_ime_with_hard_keyboard 1 || true
# Scoped storage often rejects a shell redirect. A failed push must not stop the run.
printf '%s\n' 'local-only' > "$OUT/qbot-local.txt"
adb shell mkdir -p /sdcard/Download >/dev/null 2>&1 || true
adb push "$OUT/qbot-local.txt" /sdcard/Download/qbot-local.txt >/dev/null 2>&1 || true
adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Download/qbot-local.txt >/dev/null 2>&1 || true

if ! curl -sf http://127.0.0.1:8081/status >/dev/null; then
  echo "starting metro"
  (
    cd "$APP"
    setsid npx expo start --localhost --port 8081 > "$METRO_LOG" 2>&1 < /dev/null &
  )
  ready=0
  for _ in $(seq 1 60); do
    if curl -sf http://127.0.0.1:8081/status >/dev/null; then
      ready=1
      break
    fi
    sleep 2
  done
  if [[ "$ready" != "1" ]]; then
    echo "metro did not start"
    cat "$METRO_LOG" || true
    exit 1
  fi
fi
echo "metro ready"

# The warmed bundle has no server origin. Restart Metro against the local
# fixture so the chat interactions run. The fixture is not a model.
pkill -f "expo start" || true
pkill -f "virtual-metro-entry.bundle" || true
sleep 1
node "$APP/e2e/fixture-chat.mjs" > "$OUT/fixture.log" 2>&1 &
fixture_ready=0
for _ in $(seq 1 50); do
  if curl -sf http://127.0.0.1:8799/health >/dev/null; then
    fixture_ready=1
    break
  fi
  sleep 0.2
done
if [[ "$fixture_ready" != "1" ]]; then
  echo "fixture did not start"
  cat "$OUT/fixture.log" || true
  exit 1
fi
echo "fixture ready"
rm -f "$BUNDLE"
(
  cd "$APP"
  EXPO_NO_TELEMETRY=1 EXPO_NO_DOTENV=1 EXPO_NO_DEV_MENU=1 \
    EXPO_PUBLIC_QBOT_ORIGIN="http://127.0.0.1:8799" \
    setsid npx expo start --localhost --port 8081 > "$METRO_LOG" 2>&1 < /dev/null &
)
ready=0
for _ in $(seq 1 60); do
  if curl -sf http://127.0.0.1:8081/status >/dev/null; then
    ready=1
    break
  fi
  sleep 2
done
if [[ "$ready" != "1" ]]; then
  echo "metro did not restart"
  cat "$METRO_LOG" || true
  exit 1
fi

if ! grep -q '__BUNDLE_START_TIME__' "$BUNDLE" 2>/dev/null; then
  echo "requesting debug bundle"
  curl -fL --retry 3 --retry-delay 5 --max-time 180 -o "$BUNDLE" "$BUNDLE_URL"
fi
grep -q '__BUNDLE_START_TIME__' "$BUNDLE"
grep -q '127.0.0.1:8799' "$BUNDLE"
echo "bundle bytes=$(wc -c < "$BUNDLE")"

adb install -r "$APK"
adb shell appops set io.github.felixzhu.qiandrive SYSTEM_ALERT_WINDOW allow || true
# Splash is native. Capture it before Maestro replaces the activity.
adb shell am force-stop io.github.felixzhu.qiandrive || true
adb shell am start -n io.github.felixzhu.qiandrive/.MainActivity || true
sleep 0.4
adb exec-out screencap -p > "$OUT/splash.png" || true
adb shell input keyevent 3 || true
sleep 0.5
adb shell input swipe 540 1900 540 500 250 || true
sleep 0.8
adb exec-out screencap -p > "$OUT/launcher.png" || true
adb shell am force-stop com.google.android.apps.nexuslauncher || true
adb shell am force-stop com.android.launcher3 || true

set +e
light_status=0
dark_status=0
check_status=0
maestro test --no-ansi --format junit --output "$OUT/light-junit.xml" \
  --test-output-dir "$OUT/light" \
  "$APP/e2e/maestro/light.yaml" || light_status=$?
adb logcat -d | grep "QBOT_TIMING" > "$OUT/timing-light.txt" || true
# The light run filled the cache. Hold the next history read so 同步中 stays on screen.
curl -sf -X POST http://127.0.0.1:8799/e2e/hold || true
maestro test --no-ansi --format junit --output "$OUT/syncing-junit.xml" \
  --test-output-dir "$OUT/light" \
  "$APP/e2e/maestro/syncing.yaml" || light_status=$?
curl -sf -X POST http://127.0.0.1:8799/e2e/fail || true
maestro test --no-ansi --format junit --output "$OUT/stale-junit.xml" \
  --test-output-dir "$OUT/light" \
  "$APP/e2e/maestro/stale.yaml" || light_status=$?
curl -sf -X POST http://127.0.0.1:8799/e2e/ok || true
maestro test --no-ansi --format junit --output "$OUT/dark-junit.xml" \
  --test-output-dir "$OUT/dark" \
  "$APP/e2e/maestro/dark.yaml" || dark_status=$?
python3 "$APP/e2e/check_light_screenshots.py" "$OUT" || check_status=$?
{
  echo "method: API 34 emulator logcat. QBOT_TIMING is milliseconds after the JS module loaded."
  echo "cache = cold start that already had AsyncStorage. network = cold start with an empty cache."
  adb logcat -d | grep "QBOT_TIMING" || true
} > "$OUT/timing.txt" || true
echo "light=${light_status} dark=${dark_status} check=${check_status}"
if [[ "$light_status" -ne 0 || "$dark_status" -ne 0 || "$check_status" -ne 0 ]]; then
  exit 1
fi
