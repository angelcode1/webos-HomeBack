/*
 * `luna://com.webos.service.micomservice/sendKeycode` takes LG's MICOM/IR
 * command byte. `remote-buttons.json` is written in Linux input-event codes,
 * so timed mappings must translate before calling micomservice.
 *
 * The canonical mapping lives in @homeback/utils because the app keypad and
 * service action runner both consume the same MICOM byte space.
 */
export { micomKeycodeForUinput } from '@homeback/utils';
