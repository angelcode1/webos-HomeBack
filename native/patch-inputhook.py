#!/usr/bin/env python3
"""Apply reviewed fail-closed, compatibility-preserving C5 candidate edits.

Applies only to the exact pinned sundermann/inputhookpp revision from source-lock.
Refuses to patch already-modified or unexpected files. Never changes the TV.
"""
from pathlib import Path
import argparse
import subprocess
import sys

PIN = '9dc3cf140cb1ae1dbe059525c72710deea7ecf7d'


def replace_once(source: str, old: str, new: str, label: str) -> str:
    occurrences = source.count(old)
    if occurrences != 1:
        raise ValueError(f'{label}: expected exactly one original site, found {occurrences}')
    return source.replace(old, new, 1)


def patch(root: Path) -> None:
    sha = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
    if sha != PIN:
        raise ValueError(f'inputhookpp source revision mismatch: expected {PIN}, found {sha}')
    if subprocess.check_output(['git', '-C', str(root), 'status', '--porcelain'], text=True).strip():
        raise ValueError('inputhookpp source worktree must be clean before applying patches')
    cpp = root / 'inputhook.cpp'
    header = root / 'inputhook.h'
    cmake = root / 'CMakeLists.txt'
    c = cpp.read_text()
    h = header.read_text()
    cm = cmake.read_text()

    # Preserve upstream's exact diagnostic strings: HomeBack's known-good
    # short/long press state machine consumes them.
    c = replace_once(c, '#include <filesystem>\n', '''#include <filesystem>
#include <vector>

// An untrusted app ID/params string must not escape luna-send's JSON argument.
static std::string shellQuote(const std::string& input) {
    std::string result("'");
    for (char value : input) {
        if (value == '\\'') result += "'\\\\''";
        else result.push_back(value);
    }
    result.push_back('\\'');
    return result;
}
''', 'safe launch JSON argument')

    old_cmd = '''                    const std::string command =
                            "luna-send -n 1 \\"luna://com.webos.applicationManager/launch\\" '" + json.dump() + "'";'''
    new_cmd = '''                    const std::string command =
                            "luna-send -n 1 \\"luna://com.webos.applicationManager/launch\\" " + shellQuote(json.dump());'''
    c = replace_once(c, old_cmd, new_cmd, 'shell-quote Luna JSON')

    h = replace_once(h, '    std::mutex m_mutex{};\n', '''    std::mutex m_mutex{};
    // Serialize temporary edits to LG's shared keybind table until original returns.
    std::mutex m_keybind_mutex{};
''', 'keybind mutex')

    c = replace_once(c, '''    if (action == Action::REPLACE) {
        const int orig = info->keybinds[keyid].uinput_code;
''', '''    if (action == Action::REPLACE) {
        std::lock_guard<std::mutex> keybindLock(m_keybind_mutex);
        const int orig = info->keybinds[keyid].uinput_code;
''', 'serialize shared keybind mutation')

    old_write = '''    if (!error && path == "/dev/uinput" && count >= 16 && events[0].type == 1) {
        INFO("write to /dev/uinput: code=%d, value=%d", events[0].code, events[0].value);
        auto [action, newKeycode] = handleKey(events[0].code, events[0].value);

        if (action == Action::REPLACE) {
            events[0].code = newKeycode;
        }

        if (action == Action::IGNORE) {
            return static_cast<ssize_t>(count);
        }
    }

    return orig_write(fd, events, count);'''
    new_write = '''    if (!error && path == "/dev/uinput" && events &&
        count >= sizeof(input_event_t) && count % sizeof(input_event_t) == 0 &&
        events[0].type == 1) {
        INFO("write to /dev/uinput: code=%d, value=%d", events[0].code, events[0].value);
        auto [action, newKeycode] = handleKey(events[0].code, events[0].value);

        if (action == Action::REPLACE && newKeycode >= 0 && newKeycode <= UINT16_MAX) {
            // Do not alter memory owned by the intercepted LG caller.
            // Retain the full original batch, including following SYN events.
            std::vector<input_event_t> copied(events, events + count / sizeof(input_event_t));
            copied[0].code = static_cast<uint16_t>(newKeycode);
            return orig_write(fd, copied.data(), count);
        }

        if (action == Action::IGNORE) {
            return static_cast<ssize_t>(count);
        }
    }

    return orig_write(fd, events, count);'''
    c = replace_once(c, old_write, new_write, 'copy raw uinput events')

    cm = replace_once(cm, 'target_link_options(inputhookpp PRIVATE "-static-libstdc++")',
                      'target_link_options(inputhookpp PRIVATE "-static-libstdc++" "-Wl,-Bsymbolic")',
                      'linker symbol binding')

    # All three files are only written after every anchor has been validated.
    cpp.write_text(c)
    header.write_text(h)
    cmake.write_text(cm)
    print('InputHook++ candidate patch applied to pinned, clean upstream tree')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source_tree', type=Path)
    args = parser.parse_args()
    try:
        patch(args.source_tree)
    except (ValueError, OSError, subprocess.CalledProcessError) as exc:
        print(f'REFUSED: {exc}', file=sys.stderr)
        sys.exit(1)
