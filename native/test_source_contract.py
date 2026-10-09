"""Offline checks that ensure a source migration cannot silently alter a proven APK."""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class SourceBuildContract(unittest.TestCase):
    def test_source_lock_has_pinned_revisions(self):
        obj = json.loads((ROOT / 'native/source-lock.json').read_text())
        self.assertEqual(obj['source']['inputhookpp']['commit'], '9dc3cf140cb1ae1dbe059525c72710deea7ecf7d')
        self.assertEqual(obj['source']['ezinject']['commit'], '607055c06b037eadc3992008940d99bdc4a14f53')
        self.assertEqual(obj['toolchain']['sha256'], '8453e05a2e334cac891f41faa8582e43263c711b491256500d126f442c231749')

    def test_review_build_is_not_used_in_production_webpack(self):
        self.assertEqual(json.loads((ROOT / 'native/source-lock.json').read_text())['production_payload'], 'unchanged')
        workflow = (ROOT / '.github/workflows/native-inputhook.yml').read_text()
        self.assertIn('pull_request:', workflow)
        self.assertIn('workflow_dispatch:', workflow)
        self.assertNotIn('release create', workflow)
        self.assertNotIn('gh release', workflow)
        self.assertIn('c5-inputhookpp-source-candidate', workflow)
        self.assertIn('test -s packages/service/vendor/inputhook/libinputhookpp.so', workflow)

    def test_patch_preserves_event_log_contract_and_rejects_unknown_sources(self):
        patch = (ROOT / 'native/patch-inputhook.py').read_text()
        self.assertIn('Preserve upstream', patch)
        self.assertIn('INFO("write to /dev/uinput: code=%d, value=%d"', patch)
        self.assertIn('source revision mismatch', patch)
        self.assertIn('worktree must be clean', patch)
        self.assertIn('std::vector<input_event_t>', patch)
        self.assertIn('m_keybind_mutex', patch)
        self.assertIn('shellQuote(json.dump())', patch)
        self.assertIn('count % sizeof(input_event_t) == 0', patch)
        build = (ROOT / 'native/build-native.sh').read_text()
        for token in ('9dc3cf140cb1ae1dbe059525c72710deea7ecf7d', '607055c06b037eadc3992008940d99bdc4a14f53', '8453e05a2e334cac891f41faa8582e43263c711b491256500d126f442c231749'):
            self.assertIn(token, build)


# Exact-match, transactional patch smoke tests using extracted upstream call-site
# fixtures. The cross-compiler workflow still provides the authoritative build.
class CandidatePatchTests(unittest.TestCase):
    def test_known_upstream_call_sites_transform_without_changing_log_lines(self):
        import importlib.util
        import tempfile
        from unittest.mock import patch as mock_patch

        module_spec = importlib.util.spec_from_file_location('native_candidate', ROOT / 'native/patch-inputhook.py')
        candidate = importlib.util.module_from_spec(module_spec)
        module_spec.loader.exec_module(candidate)
        # Representative known upstream sites; the patch must match all of them.
        cpp = '''#include <filesystem>
                    const std::string command =
                            "luna-send -n 1 \\"luna://com.webos.applicationManager/launch\\" '" + json.dump() + "'";
    if (action == Action::REPLACE) {
        const int orig = info->keybinds[keyid].uinput_code;
    }
    if (!error && path == "/dev/uinput" && count >= 16 && events[0].type == 1) {
        INFO("write to /dev/uinput: code=%d, value=%d", events[0].code, events[0].value);
        auto [action, newKeycode] = handleKey(events[0].code, events[0].value);

        if (action == Action::REPLACE) {
            events[0].code = newKeycode;
        }

        if (action == Action::IGNORE) {
            return static_cast<ssize_t>(count);
        }
    }

    return orig_write(fd, events, count);
'''
        with tempfile.TemporaryDirectory() as td:
            path = Path(td)
            (path / 'inputhook.cpp').write_text(cpp)
            (path / 'inputhook.h').write_text('    std::mutex m_mutex{};\n')
            (path / 'CMakeLists.txt').write_text('target_link_options(inputhookpp PRIVATE "-static-libstdc++")\n')
            def command(args, text=True):
                if args[-2:] == ['rev-parse', 'HEAD']:
                    return candidate.PIN + '\n'
                if args[-2:] == ['status', '--porcelain']:
                    return ''
                raise AssertionError(args)
            with mock_patch.object(candidate.subprocess, 'check_output', side_effect=command):
                candidate.patch(path)
            output = (path / 'inputhook.cpp').read_text()
            self.assertIn('shellQuote(json.dump())', output)
            self.assertIn('std::lock_guard<std::mutex> keybindLock(m_keybind_mutex)', output)
            self.assertIn('std::vector<input_event_t> copied(', output)
            self.assertIn('INFO("write to /dev/uinput: code=%d, value=%d"', output)
            self.assertNotIn('events[0].code = newKeycode;', output)
            self.assertIn('-Wl,-Bsymbolic', (path / 'CMakeLists.txt').read_text())

    def test_missing_upstream_anchor_fails_without_partial_writes(self):
        import importlib.util
        import tempfile
        from unittest.mock import patch as mock_patch
        module_spec = importlib.util.spec_from_file_location('native_candidate', ROOT / 'native/patch-inputhook.py')
        candidate = importlib.util.module_from_spec(module_spec)
        module_spec.loader.exec_module(candidate)
        with tempfile.TemporaryDirectory() as td:
            path = Path(td)
            original = '#include <filesystem>\nno recognized hook here\n'
            (path / 'inputhook.cpp').write_text(original)
            (path / 'inputhook.h').write_text('    std::mutex m_mutex{};\n')
            (path / 'CMakeLists.txt').write_text('target_link_options(inputhookpp PRIVATE "-static-libstdc++")\n')
            with mock_patch.object(candidate.subprocess, 'check_output', side_effect=[candidate.PIN + '\n', '']):
                with self.assertRaisesRegex(ValueError, 'exactly one original site'):
                    candidate.patch(path)
            self.assertEqual((path / 'inputhook.cpp').read_text(), original)

    def test_shell_argument_quoting_compiles_and_roundtrips(self):
        import importlib.util
        import shutil
        import subprocess
        import tempfile
        import shlex
        if not shutil.which('g++'):
            self.skipTest('g++ not available for optional host-only regression')
        module_spec = importlib.util.spec_from_file_location('native_candidate', ROOT / 'native/patch-inputhook.py')
        candidate = importlib.util.module_from_spec(module_spec)
        module_spec.loader.exec_module(candidate)
        helper = next(c for c in candidate.patch.__code__.co_consts if isinstance(c, str) and 'static std::string shellQuote' in c)
        with tempfile.TemporaryDirectory() as td:
            src, binary = Path(td) / 'q.cpp', Path(td) / 'q'
            src.write_text('#include <string>\n#include <iostream>\n' + helper + '''
int main() { std::cout << shellQuote("a'b\\"$\\\\c") << "\\n"; }
''')
            subprocess.run(['g++', '-std=c++20', '-Wall', '-Wextra', '-Werror', str(src), '-o', str(binary)], check=True, capture_output=True, text=True)
            quoted = subprocess.check_output([str(binary)], text=True).strip()
            self.assertEqual(shlex.split(quoted), ["a'b\"$\\c"])


if __name__ == '__main__':
    unittest.main()
