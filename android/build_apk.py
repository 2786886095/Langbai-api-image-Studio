"""Build APK from current directory — all paths ASCII"""
import subprocess, os, sys, shutil

JAVA_HOME = r'C:\Users\浪白\AppData\Local\Android\jdk-17.0.12'
BT = r'X:\build-tools\34.0.0'
PLATFORM = r'X:\platforms\android-34'
CUR = os.getcwd()

env = os.environ.copy()
env['JAVA_HOME'] = JAVA_HOME
env['PATH'] = JAVA_HOME + '\\bin;' + env['PATH']

AAPT = os.path.join(BT, 'aapt.exe')
JAVAC = os.path.join(JAVA_HOME, 'bin', 'javac.exe')
D8 = os.path.join(BT, 'd8.bat')
JAR = os.path.join(PLATFORM, 'android.jar')
ZIPALIGN = os.path.join(BT, 'zipalign.exe')
APKSIGNER = os.path.join(BT, 'apksigner.bat')
KEYTOOL = os.path.join(JAVA_HOME, 'bin', 'keytool.exe')

WORK = os.path.join(CUR, 'build_tmp')
shutil.rmtree(WORK, ignore_errors=True)
os.makedirs(os.path.join(WORK, 'gen'), exist_ok=True)
os.makedirs(os.path.join(WORK, 'classes'), exist_ok=True)

def run(cmd, desc=""):
    print(f"  [{desc}] ", end="", flush=True)
    r = subprocess.run(cmd, capture_output=True, env=env)
    if r.returncode != 0:
        print("FAIL")
        print((r.stderr+r.stdout).decode('utf-8',errors='replace')[:500])
        sys.exit(1)
    print("OK")
    return r

# Find ALL java files (source + generated R.java)
java_files = []
for r, _, fs in os.walk(os.path.join(CUR, 'java')):
    for f in fs:
        if f.endswith('.java'): java_files.append(os.path.join(r, f))
for r, _, fs in os.walk(os.path.join(WORK, 'gen')):
    for f in fs:
        if f.endswith('.java'): java_files.append(os.path.join(r, f))
print(f"Java: {len(java_files)} file(s)")

print("\n[1/5] aapt")
unsigned = os.path.join(WORK, 'unsigned.apk')
run([AAPT,'package','-f','-M',os.path.join(CUR,'AndroidManifest.xml'),
     '-S',os.path.join(CUR,'res'),'-I',JAR,
     '-J',os.path.join(WORK,'gen'),'-F',unsigned,'--auto-add-overlay'], "aapt")

print("[2/5] javac")
run([JAVAC,'-encoding','UTF-8','-d',os.path.join(WORK,'classes'),'-classpath',JAR,
     '-source','1.8','-target','1.8']+java_files, "javac")

print("[3/5] d8")
class_files = []
for r,_,fs in os.walk(os.path.join(WORK,'classes')):
    for f in fs:
        if f.endswith('.class'): class_files.append(os.path.join(r,f))
print(f"  {len(class_files)} .class files")
run(['java','-Xmx1024M','-cp',os.path.join(BT,'lib','d8.jar'),
     'com.android.tools.r8.D8','--lib',JAR,'--output',WORK,
     '--min-api','24'] + class_files, "d8")

print("[4/5] add dex+assets")
run([AAPT,'add',unsigned,os.path.join(WORK,'classes.dex')], "dex")
for r,_,fs in os.walk(os.path.join(CUR,'assets')):
    for f in fs: run([AAPT,'add',unsigned,os.path.join(r,f)], f)

print("[5/5] sign")
ks = os.path.join(WORK,'debug.jks')
run([KEYTOOL,'-genkeypair','-keystore',ks,'-alias','debug',
     '-keyalg','RSA','-keysize','2048','-validity','10000',
     '-storepass','android','-keypass','android','-dname','CN=','-noprompt'],"keytool")
aligned = os.path.join(WORK,'aligned.apk')
run([ZIPALIGN,'-f','4',unsigned,aligned], "zipalign")
out = os.path.join(CUR,'output','AI-Image-Generator.apk')
os.makedirs(os.path.dirname(out),exist_ok=True)
run(['cmd','/c',APKSIGNER,'sign','--ks',ks,'--ks-pass','pass:android',
     '--ks-key-alias','debug','--key-pass','pass:android','--out',out,aligned],"sign")
print(f"\n DONE: {out} ({os.path.getsize(out)/1024:.1f}KB)")
