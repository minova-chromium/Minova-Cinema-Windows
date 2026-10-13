using System;
using System.Collections.Concurrent;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace MinovaCinema.NativeHost
{
    internal static class LibMpvHost
    {
        private const uint WS_CHILD = 0x40000000;
        private const uint WS_VISIBLE = 0x10000000;
        private const uint WS_CLIPCHILDREN = 0x02000000;
        private const uint WS_CLIPSIBLINGS = 0x04000000;
        private const uint WS_EX_NOPARENTNOTIFY = 0x00000004;
        private const uint WS_EX_TOOLWINDOW = 0x00000080;
        private const uint WS_EX_NOACTIVATE = 0x08000000;
        private const uint SWP_NOACTIVATE = 0x0010;
        private const uint SWP_FRAMECHANGED = 0x0020;
        private const uint SWP_SHOWWINDOW = 0x0040;
        private const int SW_HIDE = 0;
        private const int SW_SHOWNA = 8;
        private const uint WM_DESTROY = 0x0002;
        private const uint WM_APP_COMMAND = 0x8001;
        private const uint WM_APP_SHUTDOWN = 0x8002;
        private const int BLACK_BRUSH = 4;
        private const int MPV_EVENT_SHUTDOWN = 1;

        private static readonly ConcurrentQueue<string> Commands = new ConcurrentQueue<string>();
        private static readonly WndProc WindowProcedure = HandleWindowMessage;
        private static IntPtr HostWindow = IntPtr.Zero;
        private static IntPtr ParentWindow = IntPtr.Zero;
        private static IntPtr Mpv = IntPtr.Zero;
        private static Thread MpvThread;
        private static volatile bool Closing;

        private delegate IntPtr WndProc(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct WndClassEx
        {
            public uint size;
            public uint style;
            public WndProc windowProcedure;
            public int classExtra;
            public int windowExtra;
            public IntPtr instance;
            public IntPtr icon;
            public IntPtr cursor;
            public IntPtr background;
            public string menuName;
            public string className;
            public IntPtr smallIcon;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct Message
        {
            public IntPtr hwnd;
            public uint message;
            public IntPtr wParam;
            public IntPtr lParam;
            public uint time;
            public int x;
            public int y;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MpvEvent
        {
            public int eventId;
            public int error;
            public ulong replyUserdata;
            public IntPtr data;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct Rect
        {
            public int left;
            public int top;
            public int right;
            public int bottom;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr GetModuleHandle(string moduleName);

        [DllImport("gdi32.dll")]
        private static extern IntPtr GetStockObject(int objectIndex);

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern ushort RegisterClassEx(ref WndClassEx windowClass);

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateWindowEx(
            uint extendedStyle, string className, string windowName, uint style,
            int x, int y, int width, int height, IntPtr parent, IntPtr menu,
            IntPtr instance, IntPtr parameter);

        [DllImport("user32.dll")]
        private static extern IntPtr DefWindowProc(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern bool DestroyWindow(IntPtr hwnd);

        [DllImport("user32.dll")]
        private static extern void PostQuitMessage(int exitCode);

        [DllImport("user32.dll")]
        private static extern sbyte GetMessage(out Message message, IntPtr hwnd, uint minimum, uint maximum);

        [DllImport("user32.dll")]
        private static extern bool TranslateMessage(ref Message message);

        [DllImport("user32.dll")]
        private static extern IntPtr DispatchMessage(ref Message message);

        [DllImport("user32.dll")]
        private static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hwnd, int command);

        [DllImport("user32.dll")]
        private static extern bool GetWindowRect(IntPtr hwnd, out Rect rectangle);

        [DllImport("libmpv-2.dll", CallingConvention = CallingConvention.Cdecl)]
        private static extern IntPtr mpv_create();

        [DllImport("libmpv-2.dll", CallingConvention = CallingConvention.Cdecl)]
        private static extern int mpv_set_option_string(IntPtr mpv, IntPtr name, IntPtr value);

        [DllImport("libmpv-2.dll", CallingConvention = CallingConvention.Cdecl)]
        private static extern int mpv_initialize(IntPtr mpv);

        [DllImport("libmpv-2.dll", CallingConvention = CallingConvention.Cdecl)]
        private static extern IntPtr mpv_wait_event(IntPtr mpv, double timeout);

        [DllImport("libmpv-2.dll", CallingConvention = CallingConvention.Cdecl)]
        private static extern int mpv_command_string(IntPtr mpv, IntPtr command);

        [DllImport("libmpv-2.dll", CallingConvention = CallingConvention.Cdecl)]
        private static extern void mpv_terminate_destroy(IntPtr mpv);

        [DllImport("libmpv-2.dll", CallingConvention = CallingConvention.Cdecl)]
        private static extern IntPtr mpv_error_string(int error);

        private static IntPtr Utf8(string value)
        {
            byte[] bytes = Encoding.UTF8.GetBytes((value ?? string.Empty) + "\0");
            IntPtr pointer = Marshal.AllocHGlobal(bytes.Length);
            Marshal.Copy(bytes, 0, pointer, bytes.Length);
            return pointer;
        }

        private static int SetOption(string name, string value)
        {
            IntPtr namePointer = Utf8(name);
            IntPtr valuePointer = Utf8(value);
            try { return mpv_set_option_string(Mpv, namePointer, valuePointer); }
            finally
            {
                Marshal.FreeHGlobal(namePointer);
                Marshal.FreeHGlobal(valuePointer);
            }
        }

        private static int Command(string command)
        {
            if (Mpv == IntPtr.Zero) return -1;
            IntPtr commandPointer = Utf8(command);
            try { return mpv_command_string(Mpv, commandPointer); }
            finally { Marshal.FreeHGlobal(commandPointer); }
        }

        private static string ErrorText(int error)
        {
            IntPtr pointer = mpv_error_string(error);
            return pointer == IntPtr.Zero ? "unknown libmpv error" : Marshal.PtrToStringAnsi(pointer);
        }

        private static bool ConfigureMpv(IntPtr hwnd, string pipeName, string shaderCache)
        {
            string[,] options = new string[,]
            {
                { "config", "no" }, { "idle", "yes" }, { "force-window", "yes" },
                { "keep-open", "no" }, { "terminal", "no" }, { "osc", "no" },
                { "input-default-bindings", "no" }, { "input-vo-keyboard", "no" },
                { "border", "no" }, { "wid", hwnd.ToInt64().ToString() },
                { "input-ipc-server", pipeName }, { "vo", "gpu-next" },
                { "gpu-api", "d3d11" }, { "hwdec", "auto-safe" },
                { "video-sync", "audio" }, { "initial-audio-sync", "yes" },
                { "video-latency-hacks", "yes" }, { "framedrop", "vo" },
                { "audio-pitch-correction", "yes" }, { "interpolation", "no" },
                { "audio-client-name", "Minova Cinema" }, { "gpu-shader-cache-dir", shaderCache },
            };
            for (int index = 0; index < options.GetLength(0); index++)
            {
                int result = SetOption(options[index, 0], options[index, 1]);
                if (result < 0)
                {
                    Console.Error.WriteLine("libmpv option " + options[index, 0] + " failed: " + ErrorText(result));
                    return false;
                }
            }
            return true;
        }

        private static int ReadInt(string[] values, int index)
        {
            int parsed;
            return index < values.Length && int.TryParse(values[index], out parsed) ? parsed : 0;
        }

        private static void SetBounds(string[] fields)
        {
            int width = Math.Max(1, ReadInt(fields, 3));
            int height = Math.Max(1, ReadInt(fields, 4));
            ShowWindow(HostWindow, SW_SHOWNA);
            SetWindowPos(HostWindow, IntPtr.Zero, 0, 0, width, height,
                SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW);
        }

        private static void RequestShutdown()
        {
            if (Closing) return;
            Closing = true;
            Command("quit");
        }

        private static void CaptureParent(string outputPath)
        {
            Rect rectangle;
            if (string.IsNullOrWhiteSpace(outputPath) || !GetWindowRect(ParentWindow, out rectangle)) return;
            int width = Math.Max(1, rectangle.right - rectangle.left);
            int height = Math.Max(1, rectangle.bottom - rectangle.top);
            string directory = Path.GetDirectoryName(outputPath);
            if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
            using (Bitmap bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb))
            using (Graphics graphics = Graphics.FromImage(bitmap))
            {
                graphics.CopyFromScreen(rectangle.left, rectangle.top, 0, 0, new Size(width, height));
                bitmap.Save(outputPath, ImageFormat.Png);
            }
            Console.WriteLine("CAPTURED\t" + outputPath);
            Console.Out.Flush();
        }

        private static void ProcessCommands()
        {
            string line;
            while (Commands.TryDequeue(out line))
            {
                string[] fields = line.Split('\t');
                string command = fields.Length > 0 ? fields[0] : string.Empty;
                if (command == "bounds" || command == "top") SetBounds(fields);
                else if (command == "hide") ShowWindow(HostWindow, SW_HIDE);
                else if (command == "show") ShowWindow(HostWindow, SW_SHOWNA);
                else if (command == "capture" && fields.Length > 1) CaptureParent(fields[1]);
                else if (command == "quit") RequestShutdown();
            }
        }

        private static IntPtr HandleWindowMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam)
        {
            if (message == WM_APP_COMMAND)
            {
                ProcessCommands();
                return IntPtr.Zero;
            }
            if (message == WM_APP_SHUTDOWN)
            {
                DestroyWindow(hwnd);
                return IntPtr.Zero;
            }
            if (message == WM_DESTROY)
            {
                RequestShutdown();
                PostQuitMessage(0);
                return IntPtr.Zero;
            }
            return DefWindowProc(hwnd, message, wParam, lParam);
        }

        private static void ReadCommands()
        {
            try
            {
                string line;
                while (!Closing && (line = Console.ReadLine()) != null)
                {
                    Commands.Enqueue(line);
                    PostMessage(HostWindow, WM_APP_COMMAND, IntPtr.Zero, IntPtr.Zero);
                }
            }
            catch { }
            if (!Closing)
            {
                Commands.Enqueue("quit");
                PostMessage(HostWindow, WM_APP_COMMAND, IntPtr.Zero, IntPtr.Zero);
            }
        }

        private static void PumpMpvEvents()
        {
            try
            {
                while (Mpv != IntPtr.Zero)
                {
                    IntPtr pointer = mpv_wait_event(Mpv, 0.25);
                    if (pointer == IntPtr.Zero) continue;
                    MpvEvent current = (MpvEvent)Marshal.PtrToStructure(pointer, typeof(MpvEvent));
                    if (current.eventId == MPV_EVENT_SHUTDOWN) break;
                }
            }
            catch (Exception error)
            {
                Console.Error.WriteLine(error.ToString());
            }
            IntPtr handle = Mpv;
            Mpv = IntPtr.Zero;
            if (handle != IntPtr.Zero) mpv_terminate_destroy(handle);
            PostMessage(HostWindow, WM_APP_SHUTDOWN, IntPtr.Zero, IntPtr.Zero);
        }

        public static int Main(string[] args)
        {
            long parentValue;
            int width;
            int height;
            if (args.Length < 5 || !long.TryParse(args[0], out parentValue) ||
                !int.TryParse(args[1], out width) || !int.TryParse(args[2], out height)) return 2;
            string pipeName = args[3];
            string shaderCache = args[4];
            ParentWindow = new IntPtr(parentValue);

            IntPtr instance = GetModuleHandle(null);
            string className = "MinovaCinemaLibMpvHost_" + System.Diagnostics.Process.GetCurrentProcess().Id;
            WndClassEx windowClass = new WndClassEx
            {
                size = (uint)Marshal.SizeOf(typeof(WndClassEx)), windowProcedure = WindowProcedure,
                instance = instance, background = GetStockObject(BLACK_BRUSH), className = className,
            };
            if (RegisterClassEx(ref windowClass) == 0)
            {
                Console.Error.WriteLine("RegisterClassEx failed: " + Marshal.GetLastWin32Error());
                return 3;
            }

            HostWindow = CreateWindowEx(
                WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_NOPARENTNOTIFY,
                className, "Minova Cinema Embedded Video",
                WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN | WS_CLIPSIBLINGS,
                0, 0, Math.Max(1, width), Math.Max(1, height),
                ParentWindow, IntPtr.Zero, instance, IntPtr.Zero);
            if (HostWindow == IntPtr.Zero)
            {
                Console.Error.WriteLine("CreateWindowEx failed: " + Marshal.GetLastWin32Error());
                return 4;
            }

            Mpv = mpv_create();
            if (Mpv == IntPtr.Zero)
            {
                Console.Error.WriteLine("libmpv could not create a playback context.");
                return 5;
            }
            if (!ConfigureMpv(HostWindow, pipeName, shaderCache))
            {
                mpv_terminate_destroy(Mpv);
                Mpv = IntPtr.Zero;
                return 6;
            }
            int initializeResult = mpv_initialize(Mpv);
            if (initializeResult < 0)
            {
                Console.Error.WriteLine("libmpv initialization failed: " + ErrorText(initializeResult));
                mpv_terminate_destroy(Mpv);
                Mpv = IntPtr.Zero;
                return 7;
            }

            Console.OutputEncoding = Encoding.UTF8;
            Console.WriteLine("READY\t" + HostWindow.ToInt64());
            Console.Out.Flush();

            Thread reader = new Thread(ReadCommands) { IsBackground = true, Name = "MinovaLibMpvInput" };
            reader.Start();
            MpvThread = new Thread(PumpMpvEvents) { IsBackground = true, Name = "MinovaLibMpvEvents" };
            MpvThread.Start();

            Message message;
            while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0)
            {
                TranslateMessage(ref message);
                DispatchMessage(ref message);
            }
            RequestShutdown();
            if (MpvThread != null && MpvThread.IsAlive) MpvThread.Join(3000);
            return 0;
        }
    }
}
