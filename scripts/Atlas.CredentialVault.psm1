Set-StrictMode -Version Latest

if (-not ('AtlasCredentialNative' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class AtlasCredentialNative
{
    private const int GenericCredential = 1;
    private const int PersistLocalMachine = 2;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Credential
    {
        public int Flags;
        public int Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public int CredentialBlobSize;
        public IntPtr CredentialBlob;
        public int Persist;
        public int AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredWrite(ref Credential credential, int flags);

    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(string target, int type, int flags, out IntPtr credential);

    [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredDelete(string target, int type, int flags);

    [DllImport("advapi32.dll", SetLastError = false)]
    private static extern void CredFree(IntPtr buffer);

    public static void Write(string target, string secret)
    {
        if (String.IsNullOrWhiteSpace(target) || !target.StartsWith("Atlas/", StringComparison.Ordinal))
            throw new ArgumentException("Atlas credential names must begin with Atlas/.", "target");
        if (secret == null)
            throw new ArgumentNullException("secret");

        byte[] bytes = Encoding.Unicode.GetBytes(secret);
        if (bytes.Length > 2560)
            throw new ArgumentException("Secret exceeds the Windows generic credential limit.", "secret");

        IntPtr blob = Marshal.AllocCoTaskMem(bytes.Length);
        try
        {
            Marshal.Copy(bytes, 0, blob, bytes.Length);
            Credential credential = new Credential {
                Type = GenericCredential,
                TargetName = target,
                Comment = "Atlas Home OS managed secret",
                CredentialBlobSize = bytes.Length,
                CredentialBlob = blob,
                Persist = PersistLocalMachine,
                UserName = Environment.UserName
            };
            if (!CredWrite(ref credential, 0))
                throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        finally
        {
            Array.Clear(bytes, 0, bytes.Length);
            for (int index = 0; index < bytes.Length; index++) Marshal.WriteByte(blob, index, 0);
            Marshal.FreeCoTaskMem(blob);
        }
    }

    public static string Read(string target)
    {
        IntPtr pointer;
        if (!CredRead(target, GenericCredential, 0, out pointer))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        try
        {
            Credential credential = (Credential)Marshal.PtrToStructure(pointer, typeof(Credential));
            return Marshal.PtrToStringUni(credential.CredentialBlob, credential.CredentialBlobSize / 2) ?? String.Empty;
        }
        finally { CredFree(pointer); }
    }

    public static bool Exists(string target)
    {
        IntPtr pointer;
        if (!CredRead(target, GenericCredential, 0, out pointer)) return false;
        CredFree(pointer);
        return true;
    }

    public static void Delete(string target)
    {
        if (!CredDelete(target, GenericCredential, 0))
            throw new Win32Exception(Marshal.GetLastWin32Error());
    }
}
'@
}

function Set-AtlasSecret {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidatePattern('^Atlas/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$')]
        [string]$Name,

        [Parameter(Mandatory)]
        [Security.SecureString]$Secret
    )

    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secret)
    try {
        $plainText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        [AtlasCredentialNative]::Write($Name, $plainText)
    }
    finally {
        $plainText = $null
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

function Get-AtlasSecret {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidatePattern('^Atlas/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$')]
        [string]$Name,

        [switch]$AsPlainText
    )

    $plainText = [AtlasCredentialNative]::Read($Name)
    if ($AsPlainText) { return $plainText }
    try { return ConvertTo-SecureString -String $plainText -AsPlainText -Force }
    finally { $plainText = $null }
}

function Test-AtlasSecret {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidatePattern('^Atlas/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$')]
        [string]$Name
    )
    return [AtlasCredentialNative]::Exists($Name)
}

function Remove-AtlasSecret {
    [CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
    param(
        [Parameter(Mandatory)]
        [ValidatePattern('^Atlas/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$')]
        [string]$Name
    )
    if ($PSCmdlet.ShouldProcess($Name, 'Remove Atlas credential')) {
        [AtlasCredentialNative]::Delete($Name)
    }
}

Export-ModuleMember -Function Set-AtlasSecret, Get-AtlasSecret, Test-AtlasSecret, Remove-AtlasSecret
