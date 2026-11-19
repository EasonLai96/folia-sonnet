param(
    [string]$Sdk = 'C:\Users\easonlai\Desktop\Folia\android-sdk',
    [string]$Jdk = 'C:\Program Files\Java\jdk-21.0.12',
    [string]$Cache = "$env:USERPROFILE\.gradle\caches\modules-2\files-2.1",
    [string]$DebugStore = "$env:USERPROFILE\.android\debug.keystore",
    [switch]$CompileOnly
)
# Offline build of the standalone, self-instrumenting snapshot player test package.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$output = Join-Path $root 'android/build/stemSnapshotPlayerCheck'
$null = New-Item -ItemType Directory -Force $output
# One private workspace per invocation, including intermediates and the verified APK.
$work = Join-Path $output ('run-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory $work
Write-Host "Build workspace: $work"
$buildTools = Join-Path $Sdk 'build-tools/36.0.0'
$android = Join-Path $Sdk 'platforms/android-37/android.jar'
$java = Join-Path $Jdk 'bin/java.exe'
$javac = Join-Path $Jdk 'bin/javac.exe'
# A fresh output directory also prevents removed nested test classes from leaking in.
$classes = Join-Path $work 'classes'
$lib = Join-Path $work 'lib'
New-Item -ItemType Directory -Force $classes,$lib | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Artifact($group, $name, $version, $ext = 'jar') {
    $items = @(Get-ChildItem (Join-Path $Cache "$group/$name/$version") -Recurse -File -Filter "$name-$version.$ext")
    if ($items.Count -ne 1) { throw "Expected one cached artifact: $group/$name/$version/$ext" }
    return $items[0].FullName
}
function Aar($group, $name, $version) {
    $out = Join-Path $lib "$name-$version.jar"
    $zip = [IO.Compression.ZipFile]::OpenRead((Artifact $group $name $version aar))
    try { [IO.Compression.ZipFileExtensions]::ExtractToFile($zip.GetEntry('classes.jar'), $out, $true) }
    finally { $zip.Dispose() }
    return $out
}
function Run($tool, [string[]]$arguments, [switch]$Capture) {
    $start = [Diagnostics.ProcessStartInfo]::new($tool)
    $start.UseShellExecute = $false
    $start.RedirectStandardOutput = $Capture.IsPresent
    $start.WorkingDirectory = $work
    $start.EnvironmentVariables['TEMP'] = $work
    $start.EnvironmentVariables['TMP'] = $work
    foreach ($variable in 'JAVA_TOOL_OPTIONS','JDK_JAVA_OPTIONS','_JAVA_OPTIONS') { $start.EnvironmentVariables.Remove($variable) }
    $start.Arguments = ($arguments | ForEach-Object { '"' + $_ + '"' }) -join ' '
    $process = [Diagnostics.Process]::Start($start)
    $peak = 0
    try {
        if ($Capture) { $stdout = $process.StandardOutput.ReadToEndAsync() }
        do {
            $process.Refresh()
            $peak = [Math]::Max($peak, $process.PeakWorkingSet64)
        } until ($process.WaitForExit(50))
        if ($process.ExitCode -ne 0) { throw "Failed ($($process.ExitCode)): $tool $($arguments -join ' ')" }
        Write-Host ('{0}: sampled peak working set {1:N0} MiB' -f (Split-Path $tool -Leaf), ($peak / 1MB))
        if ($Capture) { return $stdout.GetAwaiter().GetResult() }
    } finally { $process.Dispose() }
}

# Check the compiled manifest, not the source XML or the APK filename.
function AssertTestPackage([string]$manifest) {
    $package = 'top.izuna.foliamajor.stemsnapshotplayercheck'
    $escapedPackage = [regex]::Escape($package)
    $androidAttr = 'http://schemas\.android\.com/apk/res/android:'
    $application = '(?m)^ {6}E: application \(line=\d+\)\r?\n(?<attrs>(?: {8}A: [^\r\n]+(?:\r?\n|\z))*)'
    $instrumentation = $application.Replace('application', 'instrumentation')
    $applications = [regex]::Matches($manifest, $application)
    $runners = [regex]::Matches($manifest, $instrumentation)
    if ($manifest -cnotmatch ('(?m)^ +A: package="' + $escapedPackage + '"(?: |\r?$)') -or
        $applications.Count -ne 1 -or
        $applications[0].Groups['attrs'].Value -cnotmatch ('(?m)^ +A: ' + $androidAttr + 'testOnly\(0x01010272\)=true\r?$') -or
        $runners.Count -ne 1 -or
        $runners[0].Groups['attrs'].Value -cnotmatch ('(?m)^ +A: ' + $androidAttr + 'name\(0x01010003\)="(?:\.|' + $escapedPackage + '\.)StandaloneInstrumentation"(?: |\r?$)') -or
        $runners[0].Groups['attrs'].Value -cnotmatch ('(?m)^ +A: ' + $androidAttr + 'targetPackage\(0x01010021\)="' + $escapedPackage + '"(?: |\r?$)')) {
        throw "Expected testOnly package $package with exactly one self-targeting StandaloneInstrumentation runner; compiled manifest:`n$manifest"
    }
}

$stdlib = Artifact org.jetbrains.kotlin kotlin-stdlib 2.2.20
$annotations = Artifact org.jetbrains annotations 23.0.0
$program = @(
    (Aar androidx.media3 media3-common 1.11.1),
    (Aar androidx.media3 media3-datasource 1.11.1),
    (Aar androidx.media3 media3-database 1.11.1),
    (Aar androidx.media3 media3-container 1.11.1),
    (Aar androidx.media3 media3-decoder 1.11.1),
    (Aar androidx.media3 media3-extractor 1.11.1),
    (Aar androidx.media3 media3-exoplayer 1.11.1),
    (Aar androidx.exifinterface exifinterface 1.3.6),
    (Aar androidx.test.ext junit 1.3.0),
    (Aar androidx.test monitor 1.8.0),
    (Artifact androidx.annotation annotation-jvm 1.8.1),
    (Aar androidx.annotation annotation-experimental 1.4.1),
    (Artifact junit junit 4.13.2),
    (Artifact org.hamcrest hamcrest-core 1.3),
    (Artifact com.google.guava guava 33.3.1-android),
    (Artifact com.google.guava failureaccess 1.0.2),
    $stdlib,
    $annotations
)
$compiler = @(
    (Artifact org.jetbrains.kotlin kotlin-compiler-embeddable 2.2.20),
    (Artifact org.jetbrains.kotlin kotlin-stdlib 2.2.20),
    (Artifact org.jetbrains.kotlin kotlin-script-runtime 2.2.20),
    (Artifact org.jetbrains.kotlin kotlin-reflect 1.6.10),
    (Artifact org.jetbrains.kotlin kotlin-daemon-embeddable 2.2.20),
    (Artifact org.jetbrains.kotlinx kotlinx-coroutines-core-jvm 1.8.0),
    $annotations
) -join ';'
$jvm = @('-Xms24m','-Xmx256m','-XX:+UseSerialGC','-XX:ActiveProcessorCount=2','-XX:MaxMetaspaceSize=128m','-XX:ReservedCodeCacheSize=32m',"-Djava.io.tmpdir=$work")
$cp = (@($android) + $program) -join ';'
$main = Join-Path $root 'android/app/src/main/java/top/izuna/foliamajor/player/dsp'
$test = Join-Path $root 'android/app/src/androidTest/java/top/izuna/foliamajor/player/dsp'
Run $java ($jvm + @('-cp',$compiler,'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler','-Werror','-no-stdlib','-no-reflect','-jvm-target','1.8','-classpath',$cp,'-d',$classes,"$main/FourStemInputSnapshots.kt","$main/FourStemSnapshotDataSource.kt","$test/FourStemSnapshotPlayerTest.kt"))
Run $javac @('-J-Xmx96m','-J-XX:+UseSerialGC','-J-XX:ActiveProcessorCount=2','--release','8','-proc:none','-classpath',"$classes;$cp",'-d',$classes,"$PSScriptRoot/StandaloneInstrumentation.java")
if ($CompileOnly) { return }
$classFiles = @(Get-ChildItem $classes -Recurse -Filter '*.class' | ForEach-Object FullName)
Run $java ($jvm + @('-cp',"$buildTools/lib/d8.jar",'com.android.tools.r8.D8','--release','--thread-count','1','--min-api','24','--lib',$android,'--output',$work) + $classFiles + $program)

$packageJson = ConvertFrom-Json ([IO.File]::ReadAllText((Join-Path $root 'package.json')))
$versionName = if ($packageJson.displayVersion) { $packageJson.displayVersion } else { $packageJson.version }
$versionCode = $packageJson.androidVersionCode
if (!$versionCode) {
    $parts = $packageJson.version.Split('.')
    $versionCode = [int]$parts[1] * 1000000 + [Math]::Min([int]$parts[2],99) * 10000 + [Math]::Min([int]$parts[3],99)
}
$unsigned = Join-Path $work 'unsigned.apk'
$aligned = Join-Path $work 'aligned.apk'
$candidate = Join-Path $work 'signed-candidate.apk'
$signed = Join-Path $work 'folia-stem-snapshot-player-test.apk'
Run "$buildTools/aapt2.exe" @('link','-I',$android,'--manifest',"$PSScriptRoot/AndroidManifest.xml",'--min-sdk-version','24','--target-sdk-version','36','--version-code',"$versionCode",'--version-name',$versionName,'-o',$unsigned)
$apk = [IO.Compression.ZipFile]::Open($unsigned,[IO.Compression.ZipArchiveMode]::Update)
try { [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($apk,"$work/classes.dex",'classes.dex') | Out-Null }
finally { $apk.Dispose() }
Run "$buildTools/zipalign.exe" @('-f','-P','16','4',$unsigned,$aligned)
$signer = $jvm + @('-jar',"$buildTools/lib/apksigner.jar")
Run $java ($signer + @('sign','--ks',$DebugStore,'--ks-key-alias','androiddebugkey','--ks-pass','pass:android','--key-pass','pass:android','--v4-signing-enabled','false','--out',$candidate,$aligned))
Run $java ($signer + @('verify','--verbose','--print-certs',$candidate))
Run "$buildTools/zipalign.exe" @('-c','-P','16','4',$candidate)
AssertTestPackage (Run "$buildTools/aapt2.exe" @('dump','xmltree','--file','AndroidManifest.xml',$candidate) -Capture)
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $candidate).Hash
[IO.File]::Move($candidate, $signed)
Write-Host "Verified APK: $signed"
[pscustomobject]@{ Algorithm = 'SHA256'; Hash = $hash; Path = $signed }
