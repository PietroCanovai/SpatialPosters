// SpatialPosters portable launcher.
//
// electron-builder's "portable" target re-extracts the whole app (~110 MB) to
// %TEMP% on every launch, which made startup take 10+ seconds. This launcher
// carries the app as a zip appended to its own exe and extracts it ONCE to
// %LOCALAPPDATA%\SpatialPosters\app\<payload hash>\. Every later launch starts
// the cached copy directly. A new build has a new hash, so it extracts fresh
// and old versions are deleted.
//
// Layout of the final exe:  [launcher exe][app.zip][trailer]
// trailer (48 bytes) = zip offset (int64 LE) + zip length (int64 LE)
//                      + payload id (24 ASCII bytes) + magic "SPPAYLD1"
//
// Built by desktop/scripts/build-portable.mjs with the C# compiler that ships
// with Windows (.NET Framework 4.8), so no extra toolchain is needed.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("SpatialPosters")]
[assembly: System.Reflection.AssemblyProduct("SpatialPosters")]

static class Launcher
{
    const string AppExe = "SpatialPosters.exe";
    const string Magic = "SPPAYLD1";
    const int TrailerSize = 8 + 8 + 24 + 8;

    [STAThread]
    static int Main(string[] args)
    {
        try
        {
            string self = Process.GetCurrentProcess().MainModule.FileName;
            long zipOffset, zipLength;
            string payloadId;
            ReadTrailer(self, out zipOffset, out zipLength, out payloadId);

            string root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SpatialPosters", "app");
            string target = Path.Combine(root, payloadId);
            string marker = Path.Combine(target, ".complete");

            if (!File.Exists(marker))
            {
                Extract(self, zipOffset, zipLength, root, target, marker);
                CleanupOldVersions(root, payloadId);
            }

            var psi = new ProcessStartInfo(Path.Combine(target, AppExe))
            {
                Arguments = string.Join(" ", args.Select(Quote)),
                WorkingDirectory = target,
                UseShellExecute = false,
            };
            Process.Start(psi);
            return 0;
        }
        catch (Exception e)
        {
            MessageBox.Show("SpatialPosters could not start:\n\n" + e.Message, "SpatialPosters", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    static void ReadTrailer(string self, out long zipOffset, out long zipLength, out string payloadId)
    {
        using (var fs = new FileStream(self, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
        {
            if (fs.Length < TrailerSize) throw new InvalidDataException("Launcher has no app payload.");
            fs.Seek(-TrailerSize, SeekOrigin.End);
            var br = new BinaryReader(fs);
            zipOffset = br.ReadInt64();
            zipLength = br.ReadInt64();
            payloadId = Encoding.ASCII.GetString(br.ReadBytes(24)).TrimEnd('\0', ' ');
            string magic = Encoding.ASCII.GetString(br.ReadBytes(8));
            if (magic != Magic || zipOffset <= 0 || zipLength <= 0 || zipOffset + zipLength > fs.Length - TrailerSize)
                throw new InvalidDataException("Launcher payload is missing or corrupt. Rebuild with npm run dist.");
            if (payloadId.Length == 0 || payloadId.Any(c => !char.IsLetterOrDigit(c)))
                throw new InvalidDataException("Launcher payload id is invalid.");
        }
    }

    static void Extract(string self, long zipOffset, long zipLength, string root, string target, string marker)
    {
        Directory.CreateDirectory(root);
        string temp = target + ".partial-" + Process.GetCurrentProcess().Id;
        if (Directory.Exists(temp)) Directory.Delete(temp, true);

        Exception failure = null;
        var form = new ProgressForm();
        var worker = new Thread(() =>
        {
            try
            {
                using (var fs = new FileStream(self, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                using (var slice = new SubStream(fs, zipOffset, zipLength))
                using (var zip = new ZipArchive(slice, ZipArchiveMode.Read))
                {
                    int total = zip.Entries.Count, done = 0;
                    string tempFull = Path.GetFullPath(temp) + Path.DirectorySeparatorChar;
                    foreach (var entry in zip.Entries)
                    {
                        string dest = Path.GetFullPath(Path.Combine(temp, entry.FullName));
                        if (!dest.StartsWith(tempFull, StringComparison.OrdinalIgnoreCase))
                            throw new InvalidDataException("Unsafe path in payload: " + entry.FullName);
                        if (entry.FullName.EndsWith("/"))
                        {
                            Directory.CreateDirectory(dest);
                        }
                        else
                        {
                            Directory.CreateDirectory(Path.GetDirectoryName(dest));
                            entry.ExtractToFile(dest, true);
                        }
                        done++;
                        if (done % 25 == 0 || done == total) form.SetProgress(done, total);
                    }
                }
                File.WriteAllText(Path.Combine(temp, ".complete"), DateTime.UtcNow.ToString("o"));
                if (Directory.Exists(target)) Directory.Delete(target, true);
                Directory.Move(temp, target);
            }
            catch (Exception e)
            {
                failure = e;
                try { if (Directory.Exists(temp)) Directory.Delete(temp, true); } catch { }
            }
            finally
            {
                form.CloseSafe();
            }
        });
        worker.IsBackground = true;
        form.Shown += (s, e) => worker.Start();
        Application.EnableVisualStyles();
        Application.Run(form);
        worker.Join();
        if (failure != null) throw new IOException("Unpacking failed: " + failure.Message, failure);
        if (!File.Exists(marker)) throw new IOException("Unpacking did not complete.");
    }

    static void CleanupOldVersions(string root, string keep)
    {
        foreach (var dir in Directory.GetDirectories(root))
        {
            if (string.Equals(Path.GetFileName(dir), keep, StringComparison.OrdinalIgnoreCase)) continue;
            try { Directory.Delete(dir, true); } catch { /* in use by a running old version */ }
        }
    }

    static string Quote(string a)
    {
        return a.IndexOfAny(new[] { ' ', '\t', '"' }) < 0 ? a : "\"" + a.Replace("\"", "\\\"") + "\"";
    }
}

/// Read-only view of a byte range of another stream (the appended zip).
class SubStream : Stream
{
    readonly Stream inner; readonly long start, length; long pos;
    public SubStream(Stream inner, long start, long length) { this.inner = inner; this.start = start; this.length = length; }
    public override bool CanRead { get { return true; } }
    public override bool CanSeek { get { return true; } }
    public override bool CanWrite { get { return false; } }
    public override long Length { get { return length; } }
    public override long Position { get { return pos; } set { pos = value; } }
    public override int Read(byte[] buffer, int offset, int count)
    {
        long left = length - pos;
        if (left <= 0) return 0;
        if (count > left) count = (int)left;
        inner.Seek(start + pos, SeekOrigin.Begin);
        int n = inner.Read(buffer, offset, count);
        pos += n;
        return n;
    }
    public override long Seek(long offset, SeekOrigin origin)
    {
        if (origin == SeekOrigin.Begin) pos = offset;
        else if (origin == SeekOrigin.Current) pos += offset;
        else pos = length + offset;
        return pos;
    }
    public override void Flush() { }
    public override void SetLength(long value) { throw new NotSupportedException(); }
    public override void Write(byte[] buffer, int offset, int count) { throw new NotSupportedException(); }
}

class ProgressForm : Form
{
    readonly ProgressBar bar = new ProgressBar();
    public ProgressForm()
    {
        Text = "SpatialPosters";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false; MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(360, 90);
        BackColor = Color.FromArgb(9, 9, 11);
        ForeColor = Color.Gainsboro;
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
        var label = new Label { Text = "Setting up SpatialPosters (first launch only)...", AutoSize = true, Location = new Point(16, 18) };
        bar.SetBounds(16, 48, 328, 18);
        Controls.Add(label);
        Controls.Add(bar);
    }
    public void SetProgress(int done, int total)
    {
        if (!IsHandleCreated) return;
        BeginInvoke((Action)(() => { bar.Maximum = total; bar.Value = Math.Min(done, total); }));
    }
    public void CloseSafe()
    {
        if (IsHandleCreated) BeginInvoke((Action)Close);
    }
}
