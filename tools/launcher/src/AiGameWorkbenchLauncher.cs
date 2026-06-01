using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;

namespace AiGameWorkbenchLauncher
{
    public sealed class LauncherCommand
    {
        private LauncherCommand(string repoRoot, string scriptPath, string[] argumentList)
        {
            RepoRoot = repoRoot;
            ScriptPath = scriptPath;
            ArgumentList = argumentList;
        }

        public string RepoRoot { get; private set; }

        public string ScriptPath { get; private set; }

        public string[] ArgumentList { get; private set; }

        public static LauncherCommand Create(
            string appBaseDirectory,
            string currentDirectory,
            string[] userArguments,
            string environmentRepoRoot)
        {
            var repoRoot = FindRepoRoot(appBaseDirectory, currentDirectory, environmentRepoRoot);
            var scriptPath = Path.Combine(repoRoot, "scripts", "start-workbench.ps1");
            var arguments = new List<string>
            {
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                scriptPath
            };

            var hasOpenBrowser = false;
            var hasCheck = false;
            foreach (var argument in userArguments)
            {
                if (string.Equals(argument, "-OpenBrowser", StringComparison.OrdinalIgnoreCase))
                {
                    hasOpenBrowser = true;
                }
                if (string.Equals(argument, "-Check", StringComparison.OrdinalIgnoreCase))
                {
                    hasCheck = true;
                }
                arguments.Add(argument);
            }

            if (!hasOpenBrowser && !hasCheck)
            {
                arguments.Add("-OpenBrowser");
            }

            return new LauncherCommand(repoRoot, scriptPath, arguments.ToArray());
        }

        private static string FindRepoRoot(string appBaseDirectory, string currentDirectory, string environmentRepoRoot)
        {
            var candidates = new[] { environmentRepoRoot, appBaseDirectory, currentDirectory };
            foreach (var candidate in candidates)
            {
                var repoRoot = TryFindRepoRoot(candidate);
                if (repoRoot != null)
                {
                    return repoRoot;
                }
            }

            throw new InvalidOperationException(
                "Could not find scripts\\start-workbench.ps1. Run this launcher from inside the ai_game_workbench repository, or set AI_GAME_WORKBENCH_ROOT.");
        }

        private static string TryFindRepoRoot(string startPath)
        {
            if (string.IsNullOrWhiteSpace(startPath))
            {
                return null;
            }

            var fullPath = Path.GetFullPath(startPath);
            if (File.Exists(fullPath))
            {
                fullPath = Path.GetDirectoryName(fullPath);
            }

            var directory = new DirectoryInfo(fullPath);
            while (directory != null)
            {
                var scriptPath = Path.Combine(directory.FullName, "scripts", "start-workbench.ps1");
                if (File.Exists(scriptPath))
                {
                    return directory.FullName;
                }
                directory = directory.Parent;
            }

            return null;
        }
    }

    public static class CommandLine
    {
        public static string Join(string[] arguments)
        {
            var builder = new StringBuilder();
            for (var index = 0; index < arguments.Length; index += 1)
            {
                if (index > 0)
                {
                    builder.Append(' ');
                }
                builder.Append(Quote(arguments[index]));
            }
            return builder.ToString();
        }

        private static string Quote(string argument)
        {
            if (argument.Length == 0)
            {
                return "\"\"";
            }

            var needsQuotes = false;
            foreach (var character in argument)
            {
                if (char.IsWhiteSpace(character) || character == '"')
                {
                    needsQuotes = true;
                    break;
                }
            }

            if (!needsQuotes)
            {
                return argument;
            }

            var builder = new StringBuilder();
            builder.Append('"');
            var backslashes = 0;
            foreach (var character in argument)
            {
                if (character == '\\')
                {
                    backslashes += 1;
                    continue;
                }

                if (character == '"')
                {
                    builder.Append('\\', backslashes * 2 + 1);
                    builder.Append('"');
                    backslashes = 0;
                    continue;
                }

                builder.Append('\\', backslashes);
                backslashes = 0;
                builder.Append(character);
            }
            builder.Append('\\', backslashes * 2);
            builder.Append('"');
            return builder.ToString();
        }
    }

    public static class Program
    {
        public static int Main(string[] args)
        {
            try
            {
                var command = LauncherCommand.Create(
                    AppDomain.CurrentDomain.BaseDirectory,
                    Environment.CurrentDirectory,
                    args,
                    Environment.GetEnvironmentVariable("AI_GAME_WORKBENCH_ROOT"));

                Console.WriteLine("AI Game Workbench launcher");
                Console.WriteLine("Repository: " + command.RepoRoot);
                Console.WriteLine("Starting backend, frontend, and ngrok tunnel...");

                var processStartInfo = new ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    Arguments = CommandLine.Join(command.ArgumentList),
                    WorkingDirectory = command.RepoRoot,
                    UseShellExecute = false
                };
                var process = Process.Start(processStartInfo);
                process.WaitForExit();
                if (process.ExitCode != 0)
                {
                    Console.Error.WriteLine("Launcher failed with exit code " + process.ExitCode + ".");
                    PauseForInteractiveConsole();
                }
                return process.ExitCode;
            }
            catch (Exception error)
            {
                Console.Error.WriteLine(error.Message);
                PauseForInteractiveConsole();
                return 1;
            }
        }

        private static void PauseForInteractiveConsole()
        {
            try
            {
                if (!Console.IsInputRedirected)
                {
                    Console.Error.WriteLine("Press Enter to close.");
                    Console.ReadLine();
                }
            }
            catch
            {
            }
        }
    }
}
