"""Compile actual patched C++ event-sender helper on Linux and verify fail-open."""
from pathlib import Path
import importlib.util
import os
import shutil
import socket
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]


class NativeFailOpenHostContract(unittest.TestCase):
    def test_sender_requires_fresh_lease_and_live_local_receiver(self):
        if not shutil.which('g++') or os.name != 'posix':
            self.skipTest('Requires a POSIX host g++')
        spec = importlib.util.spec_from_file_location('patch_inputhook', ROOT / 'native/patch-inputhook.py')
        patcher = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(patcher)
        ipc_cpp = next(
            c for c in patcher.patch.__code__.co_consts
            if isinstance(c, str) and 'static bool homebackEmitEvent' in c
        )
        with tempfile.TemporaryDirectory(prefix='homeback-ipc-cpp-') as td:
            base = Path(td)
            lease = base / 'lease'
            sock_path = base / 'events.sock'
            cpp = ipc_cpp.replace('/tmp/homeback-remote-ipc/lease', str(lease))
            cpp = cpp.replace('/tmp/homeback-remote-ipc/events.sock', str(sock_path))
            src = base / 'main.cpp'
            exe = base / 'sender'
            src.write_text(
                '#include <cstdint>\n#include <sys/stat.h>\n'
                + cpp + '\n'
                + 'int main() { return homebackEmitEvent(773, 1) ? 0 : 7; }\n'
            )
            subprocess.run([
                'g++', '-std=c++20', '-Wall', '-Wextra', '-Werror',
                str(src), '-o', str(exe),
            ], check=True, capture_output=True, text=True)
            def run():
                return subprocess.run([str(exe)], check=False, capture_output=True).returncode

            self.assertEqual(run(), 7, 'no heartbeat: original key must pass')
            lease.write_text('123\n')
            self.assertEqual(run(), 7, 'no event listener: original key must pass')
            server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            try:
                server.bind(str(sock_path))
                server.listen(2)
                server.settimeout(1.0)
                self.assertEqual(run(), 0, 'fresh lease + socket: remote event delivered')
                peer, _ = server.accept()
                try:
                    self.assertEqual(peer.recv(64), b'773 1\n')
                finally:
                    peer.close()

                old = time.time() - 5
                os.utime(lease, (old, old))
                self.assertEqual(run(), 7, 'stale event-loop heartbeat must fail open')
            finally:
                server.close()
            self.assertEqual(run(), 7, 'closed listener must fail open')


if __name__ == '__main__':
    unittest.main()
