import subprocess
import os

java_home = os.path.expandvars(r'%LOCALAPPDATA%\Android\jdk-17.0.12')
sdk_root = os.path.expandvars(r'%LOCALAPPDATA%\Android')
sdkmanager = os.path.join(sdk_root, 'cmdline-tools', 'latest', 'bin', 'sdkmanager.bat')

env = os.environ.copy()
env['JAVA_HOME'] = java_home
env['PATH'] = java_home + r'\bin;' + env['PATH']

# Accept licenses
print("Accepting SDK licenses...")
proc = subprocess.run([sdkmanager, '--sdk_root=' + sdk_root, '--licenses'],
                      input=b'y\ny\ny\ny\ny\ny\ny\ny\ny\ny\ny\ny\ny\ny\ny\ny\n',
                      capture_output=True, env=env, timeout=120)
print(proc.stdout.decode('utf-8', errors='ignore')[-300:])

# Install SDK components
print("\nInstalling build-tools and platform...")
proc2 = subprocess.run([sdkmanager, '--sdk_root=' + sdk_root, 'build-tools;34.0.0', 'platforms;android-34'],
                       capture_output=True, env=env, timeout=300)
print(proc2.stdout.decode('utf-8', errors='ignore')[-500:])
print(proc2.stderr.decode('utf-8', errors='ignore')[-300:])
