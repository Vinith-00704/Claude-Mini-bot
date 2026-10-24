// Records the default microphone as 16 kHz mono 16-bit audio, the way Whisper wants it.
// It uses the plain Windows waveIn API, so there is nothing to install. Nothing is listened
// to until Start is called, and Stop (or Dispose) closes the microphone again. The caller
// polls it from the UI timer: that keeps everything on one thread.

using System;
using System.IO;
using System.Runtime.InteropServices;

namespace MiniBot
{
    public class Recorder : IDisposable
    {
        const int SampleRate = 16000;
        const int ChunkBytes = SampleRate * 2 / 10;     // 100 ms
        const int Buffers = 8;
        const uint WHDR_DONE = 1;
        const uint WAVE_MAPPER = 0xFFFFFFFF;

        [StructLayout(LayoutKind.Sequential)]
        struct WaveFormat
        {
            public ushort FormatTag, Channels;
            public uint SamplesPerSec, AvgBytesPerSec;
            public ushort BlockAlign, BitsPerSample, Size;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct WaveHeader
        {
            public IntPtr Data;
            public uint BufferLength, BytesRecorded;
            public IntPtr User;
            public uint Flags, Loops;
            public IntPtr Next, Reserved;
        }

        [DllImport("winmm.dll")] static extern int waveInOpen(out IntPtr h, uint device, ref WaveFormat fmt, IntPtr cb, IntPtr inst, uint flags);
        [DllImport("winmm.dll")] static extern int waveInClose(IntPtr h);
        [DllImport("winmm.dll")] static extern int waveInPrepareHeader(IntPtr h, IntPtr hdr, int size);
        [DllImport("winmm.dll")] static extern int waveInUnprepareHeader(IntPtr h, IntPtr hdr, int size);
        [DllImport("winmm.dll")] static extern int waveInAddBuffer(IntPtr h, IntPtr hdr, int size);
        [DllImport("winmm.dll")] static extern int waveInStart(IntPtr h);
        [DllImport("winmm.dll")] static extern int waveInReset(IntPtr h);

        IntPtr device = IntPtr.Zero;
        readonly IntPtr[] headers = new IntPtr[Buffers];
        readonly IntPtr[] data = new IntPtr[Buffers];
        readonly MemoryStream pcm = new MemoryStream();
        readonly int headerSize = Marshal.SizeOf(typeof(WaveHeader));
        int next;

        public bool Running { get { return device != IntPtr.Zero; } }
        /// <summary>How loud the last 100 ms were, 0-100.</summary>
        public int Level;
        /// <summary>The loudest 100 ms so far, 0-100.</summary>
        public int Peak;
        public double Seconds { get { return pcm.Length / (SampleRate * 2.0); } }

        public void Start()
        {
            var fmt = new WaveFormat
            {
                FormatTag = 1, Channels = 1, SamplesPerSec = SampleRate, AvgBytesPerSec = SampleRate * 2,
                BlockAlign = 2, BitsPerSample = 16, Size = 0
            };
            if (waveInOpen(out device, WAVE_MAPPER, ref fmt, IntPtr.Zero, IntPtr.Zero, 0) != 0)
            {
                device = IntPtr.Zero;
                throw new InvalidOperationException(
                    "No microphone was found, or Windows is not letting desktop apps use it (Settings > Privacy & security > Microphone).");
            }
            for (int i = 0; i < Buffers; i++)
            {
                data[i] = Marshal.AllocHGlobal(ChunkBytes);
                headers[i] = Marshal.AllocHGlobal(headerSize);
                var hdr = new WaveHeader { Data = data[i], BufferLength = ChunkBytes };
                Marshal.StructureToPtr(hdr, headers[i], false);
                waveInPrepareHeader(device, headers[i], headerSize);
                waveInAddBuffer(device, headers[i], headerSize);
            }
            waveInStart(device);
        }

        /// <summary>Takes in what has been recorded since the last call.</summary>
        public void Poll()
        {
            if (device == IntPtr.Zero) return;
            for (int n = 0; n < Buffers; n++)
            {
                var hdr = (WaveHeader)Marshal.PtrToStructure(headers[next], typeof(WaveHeader));
                if ((hdr.Flags & WHDR_DONE) == 0) break;
                Take(hdr);
                hdr.Flags &= ~WHDR_DONE;
                hdr.BytesRecorded = 0;
                Marshal.StructureToPtr(hdr, headers[next], false);
                waveInAddBuffer(device, headers[next], headerSize);
                next = (next + 1) % Buffers;
            }
        }

        void Take(WaveHeader hdr)
        {
            int bytes = (int)hdr.BytesRecorded;
            if (bytes <= 0) return;
            var chunk = new byte[bytes];
            Marshal.Copy(hdr.Data, chunk, 0, bytes);
            pcm.Write(chunk, 0, bytes);
            double sum = 0;
            int samples = bytes / 2;
            for (int i = 0; i < samples; i++)
            {
                short s = (short)(chunk[2 * i] | (chunk[2 * i + 1] << 8));
                sum += (double)s * s;
            }
            double rms = samples > 0 ? Math.Sqrt(sum / samples) : 0;
            Level = (int)Math.Min(100.0, rms / 32768.0 * 700.0);
            if (Level > Peak) Peak = Level;
        }

        /// <summary>Closes the microphone and returns what was recorded as a WAV file's bytes.</summary>
        public byte[] Stop()
        {
            if (device != IntPtr.Zero)
            {
                waveInReset(device);        // hands back every buffer, including the half-filled one
                for (int n = 0; n < Buffers; n++)
                {
                    var hdr = (WaveHeader)Marshal.PtrToStructure(headers[next], typeof(WaveHeader));
                    if (hdr.BytesRecorded > 0) Take(hdr);
                    next = (next + 1) % Buffers;
                }
                Release();
            }
            return Wav();
        }

        byte[] Wav()
        {
            byte[] audio = pcm.ToArray();
            using (var ms = new MemoryStream())
            using (var w = new BinaryWriter(ms))
            {
                w.Write(new[] { 'R', 'I', 'F', 'F' });
                w.Write(36 + audio.Length);
                w.Write(new[] { 'W', 'A', 'V', 'E', 'f', 'm', 't', ' ' });
                w.Write(16);
                w.Write((short)1);
                w.Write((short)1);
                w.Write(SampleRate);
                w.Write(SampleRate * 2);
                w.Write((short)2);
                w.Write((short)16);
                w.Write(new[] { 'd', 'a', 't', 'a' });
                w.Write(audio.Length);
                w.Write(audio);
                return ms.ToArray();
            }
        }

        void Release()
        {
            if (device == IntPtr.Zero) return;
            for (int i = 0; i < Buffers; i++)
            {
                waveInUnprepareHeader(device, headers[i], headerSize);
                Marshal.FreeHGlobal(headers[i]);
                Marshal.FreeHGlobal(data[i]);
            }
            waveInClose(device);
            device = IntPtr.Zero;
        }

        public void Dispose()
        {
            if (device != IntPtr.Zero)
            {
                waveInReset(device);
                Release();
            }
        }
    }
}
