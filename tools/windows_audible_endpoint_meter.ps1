param(
  [ValidateRange(1, 600)]
  [int]$DurationSeconds = 15,
  [ValidateRange(20, 2000)]
  [int]$SampleMilliseconds = 100,
  [string]$OutputPath = '',
  [string]$StopPath = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace LoudEase.AudioEndpoint {
  enum EDataFlow { Render = 0, Capture = 1, All = 2 }
  enum ERole { Console = 0, Multimedia = 1, Communications = 2 }

  [ComImport]
  [Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  class MMDeviceEnumerator { }

  [ComImport]
  [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
  interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(EDataFlow dataFlow, uint stateMask, out object devices);
    [PreserveSig] int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice endpoint);
    [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice endpoint);
    [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr client);
    [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr client);
  }

  [ComImport]
  [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  [Guid("D666063F-1587-4E43-81F1-B948E807363F")]
  interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, uint classContext, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
    [PreserveSig] int OpenPropertyStore(uint access, out IntPtr properties);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetState(out uint state);
  }

  [ComImport]
  [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  [Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064")]
  interface IAudioMeterInformation {
    [PreserveSig] int GetPeakValue(out float peak);
    [PreserveSig] int GetMeteringChannelCount(out int channelCount);
    [PreserveSig] int GetChannelsPeakValues(int channelCount, [Out] float[] peaks);
    [PreserveSig] int QueryHardwareSupport(out int hardwareSupportMask);
  }

  public static class EndpointMeter {
    const uint CLSCTX_ALL = 23;
    static IAudioMeterInformation meter;

    static EndpointMeter() {
      var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
      IMMDevice endpoint;
      Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(EDataFlow.Render, ERole.Multimedia, out endpoint));
      var meterId = typeof(IAudioMeterInformation).GUID;
      object instance;
      Marshal.ThrowExceptionForHR(endpoint.Activate(ref meterId, CLSCTX_ALL, IntPtr.Zero, out instance));
      meter = (IAudioMeterInformation)instance;
    }

    public static float Peak() {
      float peak;
      Marshal.ThrowExceptionForHR(meter.GetPeakValue(out peak));
      return peak;
    }
  }
}
'@

$started = [DateTimeOffset]::UtcNow
$deadline = [DateTime]::UtcNow.AddSeconds($DurationSeconds)
$samples = [System.Collections.Generic.List[object]]::new()
while ([DateTime]::UtcNow -lt $deadline) {
  if ($StopPath -and [System.IO.File]::Exists([System.IO.Path]::GetFullPath($StopPath))) {
    break
  }
  $peak = [LoudEase.AudioEndpoint.EndpointMeter]::Peak()
  $samples.Add([pscustomobject]@{
    elapsedMs = [int]([DateTimeOffset]::UtcNow - $started).TotalMilliseconds
    peak = [double]$peak
    dbfs = if ($peak -gt 0) { [Math]::Round(20 * [Math]::Log10($peak), 3) } else { -120.0 }
  })
  Start-Sleep -Milliseconds $SampleMilliseconds
}

$result = [ordered]@{
  startedAt = $started.ToString('o')
  generatedAt = [DateTimeOffset]::UtcNow.ToString('o')
  durationSeconds = $DurationSeconds
  sampleMilliseconds = $SampleMilliseconds
  sampleCount = $samples.Count
  maxPeak = if ($samples.Count) { [double](($samples | Measure-Object peak -Maximum).Maximum) } else { 0.0 }
  samples = $samples
}
$json = $result | ConvertTo-Json -Depth 5
if ($OutputPath) {
  $resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
  [System.IO.File]::WriteAllText($resolvedOutput, $json + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
}
$json
