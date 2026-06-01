using System;
using System.IO;
using AiGameWorkbenchLauncher;

public static class LauncherCommandTests
{
    public static int Main()
    {
        var failed = 0;
        failed += Run("finds the repository root from a nested launcher folder", FindsRepoRootFromNestedLauncherFolder);
        failed += Run("builds PowerShell arguments with OpenBrowser by default", BuildsPowerShellArgumentsWithOpenBrowserByDefault);
        failed += Run("preserves explicit script arguments without duplicating OpenBrowser", PreservesExplicitScriptArgumentsWithoutDuplicatingOpenBrowser);
        failed += Run("does not add OpenBrowser when running a Check", DoesNotAddOpenBrowserWhenRunningCheck);
        return failed;
    }

    private static int Run(string name, Action test)
    {
        try
        {
            test();
            Console.WriteLine("PASS " + name);
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("FAIL " + name);
            Console.Error.WriteLine(error);
            return 1;
        }
    }

    private static void FindsRepoRootFromNestedLauncherFolder()
    {
        using (var workspace = TempWorkspace.Create())
        {
            var nestedLauncherFolder = Path.Combine(workspace.Root, "tools", "launcher", "release");
            Directory.CreateDirectory(nestedLauncherFolder);

            var command = LauncherCommand.Create(
                nestedLauncherFolder,
                Path.GetTempPath(),
                new string[0],
                null);

            AssertEqual(workspace.Root, command.RepoRoot);
            AssertEqual(Path.Combine(workspace.Root, "scripts", "start-workbench.ps1"), command.ScriptPath);
        }
    }

    private static void BuildsPowerShellArgumentsWithOpenBrowserByDefault()
    {
        using (var workspace = TempWorkspace.Create())
        {
            var command = LauncherCommand.Create(
                Path.Combine(workspace.Root, "tools", "launcher", "release"),
                workspace.Root,
                new string[0],
                null);

            AssertSequenceEqual(new[]
            {
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                Path.Combine(workspace.Root, "scripts", "start-workbench.ps1"),
                "-OpenBrowser"
            }, command.ArgumentList);
        }
    }

    private static void PreservesExplicitScriptArgumentsWithoutDuplicatingOpenBrowser()
    {
        using (var workspace = TempWorkspace.Create())
        {
            var command = LauncherCommand.Create(
                workspace.Root,
                workspace.Root,
                new[] { "-NoNgrok", "-OpenBrowser", "-WebPort", "5180" },
                null);

            AssertSequenceEqual(new[]
            {
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                Path.Combine(workspace.Root, "scripts", "start-workbench.ps1"),
                "-NoNgrok",
                "-OpenBrowser",
                "-WebPort",
                "5180"
            }, command.ArgumentList);
        }
    }

    private static void DoesNotAddOpenBrowserWhenRunningCheck()
    {
        using (var workspace = TempWorkspace.Create())
        {
            var command = LauncherCommand.Create(
                workspace.Root,
                workspace.Root,
                new[] { "-Check" },
                null);

            AssertSequenceEqual(new[]
            {
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                Path.Combine(workspace.Root, "scripts", "start-workbench.ps1"),
                "-Check"
            }, command.ArgumentList);
        }
    }

    private static void AssertEqual(string expected, string actual)
    {
        if (!string.Equals(expected, actual, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Expected '" + expected + "', got '" + actual + "'.");
        }
    }

    private static void AssertSequenceEqual(string[] expected, string[] actual)
    {
        if (expected.Length != actual.Length)
        {
            throw new InvalidOperationException("Expected " + expected.Length + " items, got " + actual.Length + ": " + string.Join(" ", actual));
        }

        for (var index = 0; index < expected.Length; index += 1)
        {
            if (!string.Equals(expected[index], actual[index], StringComparison.Ordinal))
            {
                throw new InvalidOperationException("Expected item " + index + " to be '" + expected[index] + "', got '" + actual[index] + "'.");
            }
        }
    }
}

internal sealed class TempWorkspace : IDisposable
{
    private TempWorkspace(string root)
    {
        Root = root;
        Directory.CreateDirectory(Path.Combine(root, "scripts"));
        File.WriteAllText(Path.Combine(root, "scripts", "start-workbench.ps1"), "Write-Host launcher-test");
    }

    public string Root { get; private set; }

    public static TempWorkspace Create()
    {
        return new TempWorkspace(Path.Combine(Path.GetTempPath(), "ai-game-workbench-launcher-" + Guid.NewGuid().ToString("N")));
    }

    public void Dispose()
    {
        if (Directory.Exists(Root))
        {
            Directory.Delete(Root, true);
        }
    }
}
