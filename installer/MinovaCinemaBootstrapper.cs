using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Effects;
using System.Windows.Media.Imaging;
using Microsoft.Win32;
using Forms = System.Windows.Forms;

namespace Minova.Cinema.Bootstrapper
{
    internal enum InstallMode { Fresh, Update }

    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            InstallerOptions options = InstallerOptions.Parse(args);
            ExistingInstall existing = ExistingInstall.Detect();
            if (options.ForceFresh) existing = null;
            if (options.ForceUpdate && existing == null)
            {
                existing = new ExistingInstall(BootstrapperEngine.DefaultInstallDirectory, "1.0.5");
            }
            if (existing != null)
            {
                options.Mode = InstallMode.Update;
                options.InstallDirectory = existing.Directory;
                options.InstalledVersion = existing.Version;
            }

            if (options.Silent)
            {
                try { BootstrapperEngine.Install(options, null); }
                catch (Exception error) { BootstrapperEngine.WriteLog(error); Environment.ExitCode = 1; }
                return;
            }

            Application application = new Application();
            application.ShutdownMode = ShutdownMode.OnMainWindowClose;
            application.Run(new InstallerWindow(options));
        }
    }

    internal sealed class InstallerOptions
    {
        internal bool Silent;
        internal bool TestMode;
        internal bool ForceFresh;
        internal bool ForceUpdate;
        internal bool DesktopShortcut = true;
        internal bool StartMenuShortcut = true;
        internal bool LaunchAfterInstall = true;
        internal InstallMode Mode = InstallMode.Fresh;
        internal string InstalledVersion = "";
        internal string InstallDirectory = BootstrapperEngine.DefaultInstallDirectory;

        internal static InstallerOptions Parse(string[] args)
        {
            InstallerOptions result = new InstallerOptions();
            foreach (string raw in args)
            {
                string value = raw ?? "";
                if (String.Equals(value, "/S", StringComparison.OrdinalIgnoreCase) ||
                    String.Equals(value, "/silent", StringComparison.OrdinalIgnoreCase)) result.Silent = true;
                else if (String.Equals(value, "/test", StringComparison.OrdinalIgnoreCase)) result.TestMode = true;
                else if (String.Equals(value, "/fresh", StringComparison.OrdinalIgnoreCase)) result.ForceFresh = true;
                else if (String.Equals(value, "/update", StringComparison.OrdinalIgnoreCase)) result.ForceUpdate = true;
                else if (String.Equals(value, "/noDesktopShortcut", StringComparison.OrdinalIgnoreCase)) result.DesktopShortcut = false;
                else if (String.Equals(value, "/noStartMenuShortcut", StringComparison.OrdinalIgnoreCase)) result.StartMenuShortcut = false;
                else if (value.StartsWith("/installDir=", StringComparison.OrdinalIgnoreCase))
                    result.InstallDirectory = value.Substring("/installDir=".Length).Trim('"');
            }
            return result;
        }
    }

    internal sealed class ReleaseInfo
    {
        internal string Version = "1.0.6";
        internal string SetupFileName = "Minova-Cinema-Core.exe";
        internal string SetupSha256 = "";
        internal long SetupBytes;

        internal static ReleaseInfo Load()
        {
            ReleaseInfo result = new ReleaseInfo();
            using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("minova.cinema.bootstrapper"))
            {
                if (stream == null) return result;
                using (StreamReader reader = new StreamReader(stream))
                {
                    while (!reader.EndOfStream)
                    {
                        string line = reader.ReadLine() ?? "";
                        int separator = line.IndexOf('=');
                        if (separator < 1) continue;
                        string key = line.Substring(0, separator).Trim();
                        string value = line.Substring(separator + 1).Trim();
                        if (key == "version") result.Version = value;
                        else if (key == "setupFileName") result.SetupFileName = value;
                        else if (key == "setupSha256") result.SetupSha256 = value;
                        else if (key == "setupBytes") long.TryParse(value, out result.SetupBytes);
                    }
                }
            }
            return result;
        }
    }

    internal sealed class ExistingInstall
    {
        internal readonly string Directory;
        internal readonly string Version;

        internal ExistingInstall(string directory, string version)
        {
            Directory = directory;
            Version = String.IsNullOrWhiteSpace(version) ? "Installed" : version;
        }

        internal static ExistingInstall Detect()
        {
            const string uninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\5a97384b-a65f-520d-b1b6-0fe6fca644df";
            ExistingInstall found = ReadRegistry(Registry.CurrentUser, uninstallKey);
            if (found == null) found = ReadRegistry(Registry.LocalMachine, uninstallKey);
            if (found != null) return found;

            string fallback = BootstrapperEngine.DefaultInstallDirectory;
            if (File.Exists(Path.Combine(fallback, "Minova Cinema.exe"))) return new ExistingInstall(fallback, "Installed");
            return null;
        }

        private static ExistingInstall ReadRegistry(RegistryKey root, string path)
        {
            try
            {
                using (RegistryKey key = root.OpenSubKey(path))
                {
                    if (key == null) return null;
                    string location = Convert.ToString(key.GetValue("InstallLocation"));
                    string version = Convert.ToString(key.GetValue("DisplayVersion"));
                    if (String.IsNullOrWhiteSpace(location)) return null;
                    return new ExistingInstall(location.TrimEnd('\\', '/'), version);
                }
            }
            catch { return null; }
        }
    }

    internal sealed class InstallProgress
    {
        internal readonly string Message;
        internal readonly int Percentage;
        internal InstallProgress(string message, int percentage) { Message = message; Percentage = percentage; }
    }

    internal static class BootstrapperEngine
    {
        private static readonly ReleaseInfo Release = ReleaseInfo.Load();
        internal static readonly string DefaultInstallDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Minova Cinema");
        internal static ReleaseInfo CurrentRelease { get { return Release; } }

        internal static void Install(InstallerOptions options, Action<InstallProgress> report)
        {
            string destination = NormalizeDirectory(options.InstallDirectory);
            EnsureFreeSpace(destination);
            string temporaryRoot = Path.Combine(Path.GetTempPath(), "MinovaCinemaSetup", Release.Version, Guid.NewGuid().ToString("N"));
            string setupPath = Path.Combine(temporaryRoot, Release.SetupFileName);
            try
            {
                Report(report, options.Mode == InstallMode.Update ? "Preparing your update" : "Preparing Minova Cinema", 3);
                Directory.CreateDirectory(temporaryRoot);
                ExtractSetup(setupPath);
                VerifySetup(setupPath);
                Report(report, "Package verified", 12);
                if (options.TestMode) { Simulate(options, report); return; }

                ProcessStartInfo start = new ProcessStartInfo();
                start.FileName = setupPath;
                start.Arguments = BuildArguments(options, destination);
                start.WorkingDirectory = temporaryRoot;
                start.UseShellExecute = false;
                start.CreateNoWindow = true;
                Report(report, options.Mode == InstallMode.Update ? "Updating the application" : "Installing the application", 18);
                using (Process process = Process.Start(start))
                {
                    if (process == null) throw new InvalidOperationException("Windows could not start the Minova Cinema package.");
                    int percentage = 18;
                    while (!process.WaitForExit(350))
                    {
                        percentage = Math.Min(88, percentage + Math.Max(1, (94 - percentage) / 14));
                        Report(report, ProgressMessage(options.Mode, percentage), percentage);
                    }
                    if (process.ExitCode != 0)
                        throw new InvalidOperationException("Minova Cinema Setup stopped with installer code " + process.ExitCode + ".");
                }

                Report(report, options.Mode == InstallMode.Update ? "Keeping your preferences" : "Creating Windows shortcuts", 92);
                if (!options.StartMenuShortcut) RemoveStartMenuShortcut();
                Validate(destination);
                Report(report, options.Mode == InstallMode.Update ? "You are now up to date" : "Minova Cinema is ready", 100);
            }
            catch (Exception error) { WriteLog(error); throw; }
            finally { TryDelete(temporaryRoot); }
        }

        internal static void Launch(string directory)
        {
            string executable = Path.Combine(NormalizeDirectory(directory), "Minova Cinema.exe");
            if (!File.Exists(executable)) executable = Path.Combine(DefaultInstallDirectory, "Minova Cinema.exe");
            if (!File.Exists(executable)) throw new FileNotFoundException("The installed Minova Cinema executable could not be found.", executable);
            Process.Start(new ProcessStartInfo(executable) { UseShellExecute = true });
        }

        internal static void WriteLog(Exception error)
        {
            try
            {
                File.AppendAllText(Path.Combine(Path.GetTempPath(), "MinovaCinemaSetup.log"),
                    DateTime.UtcNow.ToString("o") + " " + error + Environment.NewLine + Environment.NewLine, Encoding.UTF8);
            }
            catch { }
        }

        private static string BuildArguments(InstallerOptions options, string destination)
        {
            StringBuilder arguments = new StringBuilder("/S");
            if (options.Mode == InstallMode.Update) arguments.Append(" --updated");
            if (!options.DesktopShortcut) arguments.Append(" --no-desktop-shortcut");
            arguments.Append(" /D=").Append(destination);
            return arguments.ToString();
        }

        private static void ExtractSetup(string destination)
        {
            using (Stream input = Assembly.GetExecutingAssembly().GetManifestResourceStream("minova.cinema.setup"))
            {
                if (input == null) throw new InvalidOperationException("The embedded Minova Cinema package is missing.");
                using (FileStream output = File.Create(destination)) input.CopyTo(output);
            }
        }

        private static void VerifySetup(string path)
        {
            FileInfo file = new FileInfo(path);
            if (Release.SetupBytes > 0 && file.Length != Release.SetupBytes) throw new InvalidDataException("The setup package size is invalid.");
            using (SHA256 sha = SHA256.Create())
            using (FileStream stream = File.OpenRead(path))
            {
                string actual = BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
                if (!String.IsNullOrWhiteSpace(Release.SetupSha256) && !String.Equals(actual, Release.SetupSha256, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("The setup package failed its security check.");
            }
        }

        private static void Simulate(InstallerOptions options, Action<InstallProgress> report)
        {
            int[] values = { 22, 36, 51, 68, 82, 93, 100 };
            foreach (int value in values)
            {
                Thread.Sleep(190);
                Report(report, value == 100 ? (options.Mode == InstallMode.Update ? "You are now up to date" : "Minova Cinema is ready") : ProgressMessage(options.Mode, value), value);
            }
        }

        private static string ProgressMessage(InstallMode mode, int percentage)
        {
            if (percentage < 42) return mode == InstallMode.Update ? "Updating application files" : "Installing application files";
            if (percentage < 76) return mode == InstallMode.Update ? "Preserving your Plex connection" : "Adding native playback components";
            if (percentage < 93) return mode == InstallMode.Update ? "Keeping your preferences" : "Finishing Windows integration";
            return "Running final checks";
        }

        private static string NormalizeDirectory(string value)
        {
            if (String.IsNullOrWhiteSpace(value)) return DefaultInstallDirectory;
            return Path.GetFullPath(Environment.ExpandEnvironmentVariables(value.Trim().Trim('"'))).TrimEnd('\\', '/');
        }

        private static void EnsureFreeSpace(string destination)
        {
            string root = Path.GetPathRoot(destination);
            if (String.IsNullOrWhiteSpace(root)) return;
            DriveInfo drive = new DriveInfo(root);
            long required = Math.Max(Release.SetupBytes * 3, 300L * 1024L * 1024L);
            if (drive.AvailableFreeSpace < required) throw new IOException("There is not enough free space to install Minova Cinema.");
        }

        private static void Validate(string destination)
        {
            if (!File.Exists(Path.Combine(destination, "Minova Cinema.exe")))
                throw new FileNotFoundException("Setup finished, but Minova Cinema could not be found.");
        }

        private static void RemoveStartMenuShortcut()
        {
            try
            {
                string link = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs", "Minova Cinema.lnk");
                if (File.Exists(link)) File.Delete(link);
            }
            catch { }
        }

        private static void TryDelete(string directory)
        {
            try { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
            catch { }
        }

        private static void Report(Action<InstallProgress> report, string message, int percentage)
        {
            if (report != null) report(new InstallProgress(message, Math.Max(0, Math.Min(100, percentage))));
        }
    }

    internal sealed class InstallerWindow : Window
    {
        private static readonly Color Ink = Color.FromRgb(5, 10, 17);
        private static readonly Color Panel = Color.FromRgb(10, 17, 27);
        private static readonly Color Surface = Color.FromRgb(17, 28, 41);
        private static readonly Color Line = Color.FromRgb(34, 50, 66);
        private static readonly Color White = Color.FromRgb(246, 249, 252);
        private static readonly Color Muted = Color.FromRgb(145, 164, 183);
        private static readonly Color Cyan = Color.FromRgb(22, 216, 228);
        private static readonly Color Blue = Color.FromRgb(38, 132, 255);

        private readonly InstallerOptions options;
        private readonly Grid contentHost;
        private readonly TextBlock footerStatus;
        private TextBox installPath;
        private OptionToggle desktopToggle;
        private OptionToggle startMenuToggle;
        private OptionToggle launchToggle;
        private Border progressTrack;
        private Border progressFill;
        private int currentProgress;
        private TextBlock progressPercent;
        private TextBlock progressMessage;
        private bool busy;

        internal InstallerWindow(InstallerOptions installerOptions)
        {
            options = installerOptions;
            Title = options.Mode == InstallMode.Update ? "Update Minova Cinema" : "Install Minova Cinema";
            Width = 960;
            Height = 640;
            MinWidth = 960;
            MinHeight = 640;
            MaxWidth = 960;
            MaxHeight = 640;
            WindowStyle = WindowStyle.None;
            AllowsTransparency = true;
            Background = Brushes.Transparent;
            ResizeMode = ResizeMode.NoResize;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;

            Border shell = new Border();
            shell.CornerRadius = new CornerRadius(18);
            shell.Background = new SolidColorBrush(Panel);
            shell.BorderBrush = new SolidColorBrush(Line);
            shell.BorderThickness = new Thickness(1);
            shell.ClipToBounds = true;
            shell.Effect = new DropShadowEffect { BlurRadius = 34, ShadowDepth = 8, Opacity = .45, Color = Colors.Black };
            Content = shell;

            Grid frame = new Grid();
            frame.RowDefinitions.Add(new RowDefinition { Height = new GridLength(46) });
            frame.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            shell.Child = frame;
            frame.Children.Add(BuildTitleBar());

            Grid body = new Grid();
            body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(328) });
            body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            Grid.SetRow(body, 1);
            frame.Children.Add(body);
            body.Children.Add(BuildBrandPanel());

            Grid right = new Grid();
            right.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            right.RowDefinitions.Add(new RowDefinition { Height = new GridLength(44) });
            Grid.SetColumn(right, 1);
            body.Children.Add(right);
            contentHost = new Grid { Margin = new Thickness(54, 34, 54, 12) };
            right.Children.Add(contentHost);
            footerStatus = Text("MINOVA CINEMA  •  WINDOWS  •  " + BootstrapperEngine.CurrentRelease.Version, 11, Muted, FontWeights.SemiBold);
            footerStatus.Margin = new Thickness(54, 0, 0, 18);
            Grid.SetRow(footerStatus, 1);
            right.Children.Add(footerStatus);
            ShowReady();
        }

        private UIElement BuildTitleBar()
        {
            Grid bar = new Grid { Background = new SolidColorBrush(Color.FromRgb(7, 13, 21)) };
            bar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            bar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(46) });
            bar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(46) });
            bar.MouseLeftButtonDown += delegate { if (Mouse.LeftButton == MouseButtonState.Pressed) DragMove(); };
            StackPanel identity = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(18, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center };
            Border dot = new Border { Width = 24, Height = 24, CornerRadius = new CornerRadius(7), Background = new SolidColorBrush(Color.FromRgb(11, 35, 52)) };
            dot.Child = Text("M", 14, Cyan, FontWeights.Bold, HorizontalAlignment.Center, VerticalAlignment.Center);
            identity.Children.Add(dot);
            TextBlock name = Text("MINOVA CINEMA SETUP", 11, Muted, FontWeights.Bold);
            name.Margin = new Thickness(10, 0, 0, 0);
            identity.Children.Add(name);
            bar.Children.Add(identity);
            Button minimize = TitleButton("—");
            minimize.Click += delegate { WindowState = WindowState.Minimized; };
            Grid.SetColumn(minimize, 1);
            bar.Children.Add(minimize);
            Button close = TitleButton("×");
            close.Click += delegate { if (!busy) Close(); };
            close.MouseEnter += delegate { close.Background = new SolidColorBrush(Color.FromRgb(187, 44, 59)); };
            close.MouseLeave += delegate { close.Background = Brushes.Transparent; };
            Grid.SetColumn(close, 2);
            bar.Children.Add(close);
            return bar;
        }

        private UIElement BuildBrandPanel()
        {
            Grid panel = new Grid { ClipToBounds = true };
            LinearGradientBrush gradient = new LinearGradientBrush();
            gradient.StartPoint = new Point(0, 0); gradient.EndPoint = new Point(1, 1);
            gradient.GradientStops.Add(new GradientStop(Color.FromRgb(7, 32, 48), 0));
            gradient.GradientStops.Add(new GradientStop(Color.FromRgb(4, 13, 24), .58));
            gradient.GradientStops.Add(new GradientStop(Color.FromRgb(7, 27, 34), 1));
            panel.Background = gradient;

            Canvas art = new Canvas { IsHitTestVisible = false, Opacity = .72 };
            AddRing(art, -105, -90, 350, Color.FromArgb(42, 38, 132, 255), 2);
            AddRing(art, 142, 278, 250, Color.FromArgb(48, 22, 216, 228), 2);
            AddGlow(art, -80, -100, 360, Color.FromArgb(28, 38, 132, 255));
            AddGlow(art, 170, 270, 280, Color.FromArgb(24, 22, 216, 228));
            panel.Children.Add(art);

            StackPanel copy = new StackPanel { Margin = new Thickness(38, 56, 36, 36) };
            Image logo = LoadLogo();
            logo.Width = 74; logo.Height = 74; logo.HorizontalAlignment = HorizontalAlignment.Left;
            copy.Children.Add(logo);
            TextBlock brand = Text("MINOVA\nCINEMA", 32, White, FontWeights.Bold);
            brand.LineHeight = 32; brand.Margin = new Thickness(0, 20, 0, 0);
            copy.Children.Add(brand);
            TextBlock strap = Text("Your library.\nYour screen.\nBeautifully yours.", 17, Muted, FontWeights.Normal);
            strap.LineHeight = 26; strap.Margin = new Thickness(0, 20, 0, 0);
            copy.Children.Add(strap);
            Border badge = new Border { Background = new SolidColorBrush(Color.FromArgb(28, 22, 216, 228)), BorderBrush = new SolidColorBrush(Color.FromArgb(100, 22, 216, 228)), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(14), Padding = new Thickness(13, 8, 13, 8), Margin = new Thickness(0, 46, 0, 0), HorizontalAlignment = HorizontalAlignment.Left };
            badge.Child = Text(options.Mode == InstallMode.Update ? "●  UPDATE DETECTED" : "●  READY FOR WINDOWS", 10, Cyan, FontWeights.Bold);
            copy.Children.Add(badge);
            panel.Children.Add(copy);
            return panel;
        }

        private void ShowReady()
        {
            contentHost.Children.Clear();
            StackPanel page = new StackPanel();
            contentHost.Children.Add(page);
            bool update = options.Mode == InstallMode.Update;
            page.Children.Add(Eyebrow(update ? "UPDATE READY" : "WELCOME TO MINOVA"));
            TextBlock title = Text(update ? "Update Minova Cinema" : "Install Minova Cinema", 31, White, FontWeights.Bold);
            title.Margin = new Thickness(0, 10, 0, 0); page.Children.Add(title);
            TextBlock subtitle = Text(update ? "A new version is ready. Your Plex connection, settings, and library stay exactly where they are." : "Set up the native Windows experience for your Plex library.", 14, Muted, FontWeights.Normal);
            subtitle.TextWrapping = TextWrapping.Wrap; subtitle.LineHeight = 21; subtitle.Margin = new Thickness(0, 10, 0, 0); page.Children.Add(subtitle);

            if (update) BuildUpdateSummary(page); else BuildFreshOptions(page);
            Button primary = PrimaryButton(update ? "Update Minova Cinema" : "Install Minova Cinema");
            primary.Margin = new Thickness(0, 28, 0, 0);
            primary.Click += delegate { BeginInstall(); };
            page.Children.Add(primary);
            Button cancel = LinkButton("Not now");
            cancel.Margin = new Thickness(0, 10, 0, 0);
            cancel.Click += delegate { Close(); };
            page.Children.Add(cancel);
        }

        private void BuildUpdateSummary(StackPanel page)
        {
            Border card = Card(); card.Margin = new Thickness(0, 26, 0, 0);
            StackPanel stack = new StackPanel { Margin = new Thickness(18) };
            card.Child = stack;
            stack.Children.Add(Text("VERSION", 10, Muted, FontWeights.Bold));
            Grid versions = new Grid { Margin = new Thickness(0, 9, 0, 0) };
            versions.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            versions.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            versions.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            TextBlock oldVersion = Text(options.InstalledVersion, 18, White, FontWeights.SemiBold); versions.Children.Add(oldVersion);
            TextBlock arrow = Text("→", 20, Cyan, FontWeights.Bold); arrow.Margin = new Thickness(22, 0, 22, 0); Grid.SetColumn(arrow, 1); versions.Children.Add(arrow);
            TextBlock newVersion = Text(BootstrapperEngine.CurrentRelease.Version, 18, Cyan, FontWeights.Bold); newVersion.HorizontalAlignment = HorizontalAlignment.Right; Grid.SetColumn(newVersion, 2); versions.Children.Add(newVersion);
            stack.Children.Add(versions);
            page.Children.Add(card);
            StackPanel assurances = new StackPanel { Margin = new Thickness(2, 20, 0, 0) };
            assurances.Children.Add(InfoRow("✓", "Keeps your Plex sign-in and server connection"));
            assurances.Children.Add(InfoRow("✓", "Keeps playback, subtitle, and interface preferences"));
            assurances.Children.Add(InfoRow("✓", "Installs into your existing Minova Cinema folder"));
            page.Children.Add(assurances);
        }

        private void BuildFreshOptions(StackPanel page)
        {
            TextBlock destination = Text("INSTALL LOCATION", 10, Muted, FontWeights.Bold);
            destination.Margin = new Thickness(0, 25, 0, 8); page.Children.Add(destination);
            Grid location = new Grid();
            location.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            location.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            installPath = new TextBox { Text = options.InstallDirectory, Height = 44, Padding = new Thickness(13, 11, 8, 8), FontSize = 12, FontFamily = new FontFamily("Segoe UI"), Foreground = new SolidColorBrush(White), Background = new SolidColorBrush(Surface), BorderBrush = new SolidColorBrush(Line), BorderThickness = new Thickness(1), CaretBrush = new SolidColorBrush(Cyan), SelectionBrush = new SolidColorBrush(Color.FromArgb(120, 22, 216, 228)), VerticalContentAlignment = VerticalAlignment.Center };
            location.Children.Add(installPath);
            Button browse = SecondaryButton("Browse"); browse.Margin = new Thickness(10, 0, 0, 0);
            browse.Click += delegate { Browse(); }; Grid.SetColumn(browse, 1); location.Children.Add(browse);
            page.Children.Add(location);
            TextBlock optionsLabel = Text("SETUP OPTIONS", 10, Muted, FontWeights.Bold); optionsLabel.Margin = new Thickness(0, 22, 0, 9); page.Children.Add(optionsLabel);
            desktopToggle = new OptionToggle("Create a desktop shortcut", options.DesktopShortcut); page.Children.Add(desktopToggle);
            startMenuToggle = new OptionToggle("Add Minova Cinema to the Start menu", options.StartMenuShortcut); startMenuToggle.Margin = new Thickness(0, 9, 0, 0); page.Children.Add(startMenuToggle);
        }

        private void BeginInstall()
        {
            if (busy) return;
            if (options.Mode == InstallMode.Fresh)
            {
                options.InstallDirectory = installPath.Text;
                options.DesktopShortcut = desktopToggle.IsChecked;
                options.StartMenuShortcut = startMenuToggle.IsChecked;
            }
            busy = true;
            ShowProgress();
            Task.Factory.StartNew(delegate
            {
                try
                {
                    BootstrapperEngine.Install(options, delegate(InstallProgress progress)
                    {
                        Dispatcher.BeginInvoke(new Action(delegate { UpdateProgress(progress); }));
                    });
                    Dispatcher.BeginInvoke(new Action(ShowComplete));
                }
                catch (Exception error)
                {
                    Dispatcher.BeginInvoke(new Action(delegate { ShowError(error); }));
                }
            });
        }

        private void ShowProgress()
        {
            contentHost.Children.Clear();
            StackPanel page = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
            contentHost.Children.Add(page);
            page.Children.Add(Eyebrow(options.Mode == InstallMode.Update ? "UPDATING" : "INSTALLING"));
            TextBlock title = Text(options.Mode == InstallMode.Update ? "Bringing Minova up to date" : "Making Minova yours", 31, White, FontWeights.Bold);
            title.Margin = new Thickness(0, 10, 0, 0); page.Children.Add(title);
            progressMessage = Text(options.Mode == InstallMode.Update ? "Preparing your update" : "Preparing Minova Cinema", 14, Muted, FontWeights.Normal);
            progressMessage.Margin = new Thickness(0, 12, 0, 0); page.Children.Add(progressMessage);
            currentProgress = 2;
            progressTrack = new Border { Height = 8, Margin = new Thickness(0, 34, 0, 0), Background = new SolidColorBrush(Surface), CornerRadius = new CornerRadius(4), ClipToBounds = true };
            progressFill = new Border { Height = 8, Width = 10, HorizontalAlignment = HorizontalAlignment.Left, Background = new SolidColorBrush(Cyan), CornerRadius = new CornerRadius(4) };
            progressTrack.Child = progressFill;
            progressTrack.SizeChanged += delegate { ResizeProgressFill(); };
            page.Children.Add(progressTrack);
            progressPercent = Text("2%", 13, White, FontWeights.Bold); progressPercent.HorizontalAlignment = HorizontalAlignment.Right; progressPercent.Margin = new Thickness(0, 10, 0, 0); page.Children.Add(progressPercent);
            Border note = Card(); note.Margin = new Thickness(0, 34, 0, 0); note.Padding = new Thickness(18);
            note.Child = Text("Keep this window open. Minova Cinema will handle the rest automatically.", 13, Muted, FontWeights.Normal);
            page.Children.Add(note);
        }

        private void UpdateProgress(InstallProgress progress)
        {
            currentProgress = progress.Percentage;
            ResizeProgressFill();
            progressPercent.Text = progress.Percentage + "%";
            progressMessage.Text = progress.Message;
        }

        private void ShowComplete()
        {
            busy = false;
            contentHost.Children.Clear();
            StackPanel page = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
            contentHost.Children.Add(page);
            Border check = new Border { Width = 64, Height = 64, CornerRadius = new CornerRadius(32), Background = new SolidColorBrush(Color.FromArgb(30, 22, 216, 228)), BorderBrush = new SolidColorBrush(Cyan), BorderThickness = new Thickness(1), HorizontalAlignment = HorizontalAlignment.Left };
            check.Child = Text("✓", 30, Cyan, FontWeights.Bold, HorizontalAlignment.Center, VerticalAlignment.Center); page.Children.Add(check);
            TextBlock title = Text(options.Mode == InstallMode.Update ? "You're now up to date" : "Minova Cinema is ready", 31, White, FontWeights.Bold);
            title.Margin = new Thickness(0, 22, 0, 0); page.Children.Add(title);
            TextBlock copy = Text(options.Mode == InstallMode.Update ? "Minova Cinema " + BootstrapperEngine.CurrentRelease.Version + " is installed. Your Plex connection and preferences were preserved." : "Everything is installed. Connect to Plex and start watching on Windows.", 14, Muted, FontWeights.Normal);
            copy.TextWrapping = TextWrapping.Wrap; copy.LineHeight = 21; copy.Margin = new Thickness(0, 11, 0, 0); page.Children.Add(copy);
            launchToggle = new OptionToggle("Launch Minova Cinema", !options.TestMode); launchToggle.Margin = new Thickness(0, 28, 0, 0); page.Children.Add(launchToggle);
            Button finish = PrimaryButton("Finish"); finish.Margin = new Thickness(0, 30, 0, 0);
            finish.Click += delegate
            {
                try { if (launchToggle.IsChecked && !options.TestMode) BootstrapperEngine.Launch(options.InstallDirectory); }
                catch (Exception error) { BootstrapperEngine.WriteLog(error); }
                Close();
            };
            page.Children.Add(finish);
        }

        private void ShowError(Exception error)
        {
            busy = false;
            contentHost.Children.Clear();
            StackPanel page = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
            contentHost.Children.Add(page);
            page.Children.Add(Eyebrow("SETUP NEEDS ATTENTION"));
            TextBlock title = Text("We couldn’t finish setup", 31, White, FontWeights.Bold); title.Margin = new Thickness(0, 10, 0, 0); page.Children.Add(title);
            TextBlock copy = Text(error.Message, 14, Color.FromRgb(242, 132, 142), FontWeights.Normal); copy.TextWrapping = TextWrapping.Wrap; copy.LineHeight = 21; copy.Margin = new Thickness(0, 14, 0, 0); page.Children.Add(copy);
            TextBlock hint = Text("A technical log was saved to your Windows temporary folder.", 12, Muted, FontWeights.Normal); hint.Margin = new Thickness(0, 14, 0, 0); page.Children.Add(hint);
            Button retry = PrimaryButton("Try again"); retry.Margin = new Thickness(0, 30, 0, 0); retry.Click += delegate { ShowReady(); }; page.Children.Add(retry);
        }

        private void Browse()
        {
            using (Forms.FolderBrowserDialog dialog = new Forms.FolderBrowserDialog())
            {
                dialog.Description = "Choose where Minova Cinema should be installed";
                dialog.SelectedPath = installPath.Text;
                if (dialog.ShowDialog() == Forms.DialogResult.OK) installPath.Text = dialog.SelectedPath;
            }
        }

        private static Border Card()
        {
            return new Border { Background = new SolidColorBrush(Surface), BorderBrush = new SolidColorBrush(Line), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(12) };
        }

        private static UIElement InfoRow(string icon, string value)
        {
            StackPanel row = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 12) };
            TextBlock mark = Text(icon, 13, Cyan, FontWeights.Bold); mark.Width = 26; row.Children.Add(mark);
            row.Children.Add(Text(value, 13, Muted, FontWeights.Normal));
            return row;
        }

        private static TextBlock Eyebrow(string value)
        {
            return Text(value, 10, Cyan, FontWeights.Bold);
        }

        private static TextBlock Text(string value, double size, Color color, FontWeight weight)
        {
            return new TextBlock { Text = value, FontFamily = new FontFamily("Segoe UI"), FontSize = size, FontWeight = weight, Foreground = new SolidColorBrush(color), VerticalAlignment = VerticalAlignment.Center };
        }

        private static TextBlock Text(string value, double size, Color color, FontWeight weight, HorizontalAlignment horizontal, VerticalAlignment vertical)
        {
            TextBlock result = Text(value, size, color, weight); result.HorizontalAlignment = horizontal; result.VerticalAlignment = vertical; return result;
        }

        private static Button PrimaryButton(string value)
        {
            Button button = BaseButton(value);
            button.Height = 48; button.Foreground = new SolidColorBrush(Ink); button.Background = new SolidColorBrush(Cyan); button.BorderBrush = new SolidColorBrush(Cyan); button.FontWeight = FontWeights.Bold; button.Cursor = Cursors.Hand;
            button.MouseEnter += delegate { button.Background = new SolidColorBrush(Color.FromRgb(105, 238, 245)); };
            button.MouseLeave += delegate { button.Background = new SolidColorBrush(Cyan); };
            return button;
        }

        private static Button SecondaryButton(string value)
        {
            Button button = BaseButton(value); button.Height = 44; button.Padding = new Thickness(18, 0, 18, 0); button.Foreground = new SolidColorBrush(White); button.Background = new SolidColorBrush(Surface); button.BorderBrush = new SolidColorBrush(Line); return button;
        }

        private static Button LinkButton(string value)
        {
            Button button = BaseButton(value); button.Height = 30; button.Foreground = new SolidColorBrush(Muted); button.Background = Brushes.Transparent; button.BorderThickness = new Thickness(0); return button;
        }

        private static Button TitleButton(string value)
        {
            Button button = BaseButton(value); button.FontSize = 17; button.Foreground = new SolidColorBrush(Muted); button.Background = Brushes.Transparent; button.BorderThickness = new Thickness(0); return button;
        }

        private static Button BaseButton(string value)
        {
            Button button = new Button { Content = value, FontFamily = new FontFamily("Segoe UI"), FontSize = 13, BorderThickness = new Thickness(1), Cursor = Cursors.Hand, Template = BuildButtonTemplate() };
            return button;
        }

        private static ControlTemplate BuildButtonTemplate()
        {
            FrameworkElementFactory border = new FrameworkElementFactory(typeof(Border));
            border.SetValue(Border.CornerRadiusProperty, new CornerRadius(8));
            border.SetBinding(Border.BackgroundProperty, new System.Windows.Data.Binding("Background") { RelativeSource = new System.Windows.Data.RelativeSource(System.Windows.Data.RelativeSourceMode.TemplatedParent) });
            border.SetBinding(Border.BorderBrushProperty, new System.Windows.Data.Binding("BorderBrush") { RelativeSource = new System.Windows.Data.RelativeSource(System.Windows.Data.RelativeSourceMode.TemplatedParent) });
            border.SetBinding(Border.BorderThicknessProperty, new System.Windows.Data.Binding("BorderThickness") { RelativeSource = new System.Windows.Data.RelativeSource(System.Windows.Data.RelativeSourceMode.TemplatedParent) });
            FrameworkElementFactory presenter = new FrameworkElementFactory(typeof(ContentPresenter));
            presenter.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Center);
            presenter.SetValue(ContentPresenter.VerticalAlignmentProperty, VerticalAlignment.Center);
            border.AppendChild(presenter);
            return new ControlTemplate(typeof(Button)) { VisualTree = border };
        }

        private void ResizeProgressFill()
        {
            if (progressTrack == null || progressFill == null || progressTrack.ActualWidth <= 0) return;
            progressFill.Width = Math.Max(8, progressTrack.ActualWidth * currentProgress / 100.0);
        }

        private static Image LoadLogo()
        {
            Image result = new Image { Stretch = Stretch.Uniform };
            using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("minova.cinema.logo"))
            {
                if (stream == null) return result;
                BitmapImage bitmap = new BitmapImage();
                bitmap.BeginInit(); bitmap.CacheOption = BitmapCacheOption.OnLoad; bitmap.StreamSource = stream; bitmap.EndInit(); bitmap.Freeze(); result.Source = bitmap;
            }
            return result;
        }

        private static void AddRing(Canvas canvas, double left, double top, double size, Color color, double thickness)
        {
            System.Windows.Shapes.Ellipse ring = new System.Windows.Shapes.Ellipse { Width = size, Height = size, Stroke = new SolidColorBrush(color), StrokeThickness = thickness };
            Canvas.SetLeft(ring, left); Canvas.SetTop(ring, top); canvas.Children.Add(ring);
        }

        private static void AddGlow(Canvas canvas, double left, double top, double size, Color color)
        {
            RadialGradientBrush brush = new RadialGradientBrush();
            brush.GradientStops.Add(new GradientStop(color, 0)); brush.GradientStops.Add(new GradientStop(Colors.Transparent, 1));
            System.Windows.Shapes.Ellipse glow = new System.Windows.Shapes.Ellipse { Width = size, Height = size, Fill = brush };
            Canvas.SetLeft(glow, left); Canvas.SetTop(glow, top); canvas.Children.Add(glow);
        }
    }

    internal sealed class OptionToggle : Border
    {
        private readonly Border box;
        private readonly TextBlock check;
        internal bool IsChecked { get; private set; }

        internal OptionToggle(string label, bool initial)
        {
            Height = 40; Background = Brushes.Transparent; Cursor = Cursors.Hand;
            StackPanel row = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            box = new Border { Width = 22, Height = 22, CornerRadius = new CornerRadius(6), BorderThickness = new Thickness(1), Margin = new Thickness(0, 0, 11, 0) };
            check = new TextBlock { Text = "✓", FontFamily = new FontFamily("Segoe UI"), FontSize = 13, FontWeight = FontWeights.Bold, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
            box.Child = check; row.Children.Add(box);
            row.Children.Add(new TextBlock { Text = label, FontFamily = new FontFamily("Segoe UI"), FontSize = 13, Foreground = new SolidColorBrush(Color.FromRgb(210, 221, 232)), VerticalAlignment = VerticalAlignment.Center });
            Child = row; MouseLeftButtonUp += delegate { SetChecked(!IsChecked); }; SetChecked(initial);
        }

        private void SetChecked(bool value)
        {
            IsChecked = value;
            Color cyan = Color.FromRgb(22, 216, 228);
            box.Background = new SolidColorBrush(value ? cyan : Color.FromRgb(17, 28, 41));
            box.BorderBrush = new SolidColorBrush(value ? cyan : Color.FromRgb(55, 72, 90));
            check.Foreground = new SolidColorBrush(value ? Color.FromRgb(5, 10, 17) : Colors.Transparent);
        }
    }
}
