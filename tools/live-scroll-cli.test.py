import ast
import subprocess
import time
import unittest
from pathlib import Path
from unittest.mock import patch

class CliRecovery(unittest.TestCase):
    def invoke(self, command):
        source = ast.parse(Path(__file__).with_name('live-scroll.py').read_text())
        function = next(node for node in source.body if isinstance(node, ast.FunctionDef) and node.name == 'cli')
        namespace = dict(subprocess=subprocess, time=time)
        exec(compile(ast.Module(body=[function], type_ignores=[]), 'live-scroll.py', 'exec'), namespace)
        failed = subprocess.CompletedProcess(['bb'], 1, '', 'Host is not connected')
        success = subprocess.CompletedProcess(['bb'], 0, 'ok\n', '')
        with patch('subprocess.run', side_effect=[failed, success]) as run, patch('subprocess.check_output', side_effect=subprocess.CalledProcessError(1, ['bb'], stderr='Host is not connected')) as output, patch('time.sleep'):
            if command[0:2] == ('thread', 'tell'):
                with self.assertRaises(subprocess.CalledProcessError): namespace['cli'](*command)
                self.assertEqual(run.call_count + output.call_count, 1)
            else:
                self.assertEqual(namespace['cli'](*command), 'ok\n')
                self.assertEqual(run.call_count + output.call_count, 2)

    def test_artifact_upload_recovers(self):
        self.invoke(('own-chrome', 'run', '--script', 'upload'))

    def test_posts_never_repeat(self):
        self.invoke(('thread', 'tell', 'test', 'message'))

if __name__ == '__main__':
    unittest.main()
