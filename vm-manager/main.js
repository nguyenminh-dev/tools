const path = require("path");
const { exec } = require("child_process");
const fs = require("fs");

// Import Electron modules
const { app, BrowserWindow, ipcMain } = require("electron");

// Load config
const configPath = path.join(__dirname, "config.json");
let config = {
  limits: {
    maxVMs: 5,
    perVM: { maxMemoryGB: 16, maxCPU: 8, maxDiskGB: 500 },
    total: { maxMemoryGB: 32, maxCPU: 16 },
    maxRunningVMs: 3
  }
};
if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (e) {
    console.error("Error loading config:", e);
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  win.loadFile("index.html");
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Helper function to execute PowerShell
function execPowerShell(command) {
  return new Promise((resolve, reject) => {

    // PowerShell yêu cầu UTF-16LE khi encode
    const encoded = Buffer.from(command, "utf16le").toString("base64");

    exec(
      `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`,
      { maxBuffer: 1024 * 1024 * 50, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          console.error("PowerShell Error:", err.message, stderr);
          return reject({ error: err.message, stderr });
        }
        resolve(stdout.trim());
      }
    );
  });
}

// ==================== VM Management ====================

// Get config (for UI to show limits)
ipcMain.handle("get-config", async () => {
  return config;
});

// Helper: Calculate total resources used by running VMs
async function getTotalUsedResources() {
  try {
    const result = await execPowerShell(
      `$vms = Get-VM | Where-Object { $_.State -eq "Running" }; $totalCPU = ($vms | Measure-Object -Property ProcessorCount -Sum).Sum; $totalMem = ($vms | Measure-Object -Property MemoryStartup -Sum).Sum; [PSCustomObject]@{ CPU = if ($totalCPU) { $totalCPU } else { 0 }; MemoryGB = [math]::Round($totalMem / 1GB, 2); RunningCount = $vms.Count; TotalCount = (Get-VM).Count } | ConvertTo-Json -Compress`
    );
    if (!result || result.trim() === "") {
      return { CPU: 0, MemoryGB: 0, RunningCount: 0, TotalCount: 0 };
    }
    return JSON.parse(result);
  } catch (error) {
    return { CPU: 0, MemoryGB: 0, RunningCount: 0, TotalCount: 0 };
  }
}

// Get all VMs with detailed info
ipcMain.handle("get-vms", async () => {
  try {
    const result = await execPowerShell(`
      $vms = Get-VM
      $vms | ForEach-Object {
        $vm = $_
        $stateStr = if ($vm.State -eq 2) { "Running" } else { "Off" }

        [PSCustomObject]@{
          Name = $vm.Name
          State = $stateStr
          CPU = $vm.ProcessorCount
          MemoryGB = [math]::Round($vm.MemoryStartup / 1GB, 2)
        }
      } | ConvertTo-Json -Compress
    `);

    if (!result || result.trim() === "") return [];

    const parsed = JSON.parse(result);

    // 🔥 FIX QUAN TRỌNG
    return Array.isArray(parsed) ? parsed : [parsed];

  } catch (error) {
    console.error("Error getting VMs:", error);
    return [];
  }
});

// Get VM detailed statistics
ipcMain.handle("get-vm-stats", async (_, vmName) => {
  try {
    const result = await execPowerShell(
      `$vm = Get-VM -Name "${vmName}" -ErrorAction Stop; $stateStr = if ($vm.State -eq 1) { "Running" } elseif ($vm.State -eq 2 -or $vm.State -eq 3) { "Off" } elseif ($vm.State -eq 4) { "Paused" } elseif ($vm.State -eq 5) { "Saved" } elseif ($vm.State -eq 6) { "Starting" } elseif ($vm.State -eq 7) { "Saving" } elseif ($vm.State -eq 8) { "Stopping" } elseif ($vm.State -eq 9) { "Resetting" } elseif ($vm.State -eq 10) { "Pausing" } elseif ($vm.State -eq 11) { "Resuming" } else { "Other" }; $cpuUsage = ($vm.CPUUsage / 10000); $memory = [math]::Round($vm.MemoryAssigned / 1GB, 2); $memoryDemand = [math]::Round($vm.MemoryDemand / 1GB, 2); $hardDrives = Get-VMHardDiskDrive -VMName $vm.Name | ForEach-Object { $file = Get-Item $_.Path -ErrorAction SilentlyContinue; [PSCustomObject]@{ Path = $_.Path; SizeGB = if ($file) { [math]::Round($file.Length / 1GB, 2) } else { 0 }; Type = $_.ControllerType } }; [PSCustomObject]@{ Name = $vm.Name; State = $stateStr; CPUUsage = $cpuUsage; MemoryAssigned = $memory; MemoryDemand = $memoryDemand; MemoryStartup = [math]::Round($vm.MemoryStartup / 1GB, 2); ProcessorCount = $vm.ProcessorCount; Uptime = if ($vm.Uptime) { $vm.Uptime.TotalHours } else { 0 }; HardDrives = $hardDrives; IntegrationServices = (Get-VMIntegrationService -VMName $vm.Name | Where-Object { $_.Enabled -eq $true -and $_.PrimaryOperationalStatus -eq "OK" } | Select-Object -ExpandProperty Name) -join ", " } | ConvertTo-Json -Compress`
    );
    if (!result || result.trim() === "") {
      return null;
    }
    return JSON.parse(result);
  } catch (error) {
    console.error("Error getting VM stats:", error);
    return null;
  }
});

// Start VM
ipcMain.handle("start-vm", async (_, name) => {
  try {
    // Check max running VMs limit
    const used = await getTotalUsedResources();
    if (used.RunningCount >= config.limits.maxRunningVMs) {
      return { success: false, error: `Maximum running VMs reached (${config.limits.maxRunningVMs})` };
    }

    await execPowerShell(`Start-VM -Name "${name}"`);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.error || error.message };
  }
});

// Stop VM
ipcMain.handle("stop-vm", async (_, name) => {
  try {
    await execPowerShell(`Stop-VM -Name "${name}" -Force`);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.error || error.message };
  }
});

// Restart VM
ipcMain.handle("restart-vm", async (_, name) => {
  try {
    await execPowerShell(`Restart-VM -Name "${name}" -Force`);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.error || error.message };
  }
});

// Delete VM
ipcMain.handle("delete-vm", async (_, name) => {
  try {
    await execPowerShell(`Remove-VM -Name "${name}" -Force`);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.error || error.message };
  }
});

// ==================== VM Creation ====================

// Get available ISO files
ipcMain.handle("get-isos", async () => {
  try {
    const isoFiles = [];

    const isDev = !app.isPackaged;

    const appPath = isDev
      ? __dirname
      : path.dirname(app.getPath("exe"));

    console.log("Reading ISO from:", appPath);

    const files = fs.readdirSync(appPath);

    for (const file of files) {
      if (file.toLowerCase().endsWith(".iso")) {
        const fullPath = path.join(appPath, file);
        const stats = fs.statSync(fullPath);

        isoFiles.push({
          FullName: fullPath,
          Length: stats.size,
          LastWriteTime: stats.mtime
        });
      }
    }

    return isoFiles;
  } catch (error) {
    console.error("Error getting ISOs:", error);
    return [];
  }
});

// Get default VM path
ipcMain.handle("get-vm-path", async () => {
  try {
    const result = await execPowerShell("(Get-VMHost).VirtualMachinePath");
    return result;
  } catch (error) {
    return "C:\\ProgramData\\Microsoft\\Windows\\Hyper-V";
  }
});

// Create new VM
ipcMain.handle("create-vm", async (_, vmConfig) => {
  const { name, memoryGB, cpuCount, diskSizeGB, isoPath, switchName, enableTPM, dynamicMemory, enhancedSession } = vmConfig;

  try {
    // === CHECK LIMITS ===

    // 1. Check per-VM limits
    if (memoryGB > config.limits.perVM.maxMemoryGB) {
      return { success: false, error: `Memory exceeds per-VM limit (${config.limits.perVM.maxMemoryGB}GB)` };
    }
    if (cpuCount > config.limits.perVM.maxCPU) {
      return { success: false, error: `CPU exceeds per-VM limit (${config.limits.perVM.maxCPU} cores)` };
    }
    if (diskSizeGB > config.limits.perVM.maxDiskGB) {
      return { success: false, error: `Disk exceeds per-VM limit (${config.limits.perVM.maxDiskGB}GB)` };
    }

    // 2. Check total VM count
    const used = await getTotalUsedResources();
    if (used.TotalCount >= config.limits.maxVMs) {
      return { success: false, error: `Maximum VM count reached (${config.limits.maxVMs})` };
    }

    // 3. Check total resources (include new VM)
    const newTotalCPU = used.CPU + cpuCount;
    const newTotalMem = used.MemoryGB + memoryGB;
    if (newTotalCPU > config.limits.total.maxCPU) {
      return { success: false, error: `Total CPU would exceed limit (${config.limits.total.maxCPU} cores). Currently using: ${used.CPU}` };
    }
    if (newTotalMem > config.limits.total.maxMemoryGB) {
      return { success: false, error: `Total Memory would exceed limit (${config.limits.total.maxMemoryGB}GB). Currently using: ${used.MemoryGB}GB` };
    }

    // Create VM with VHD
    await execPowerShell(
      `New-VM -Name "${name}" -MemoryStartupBytes ${memoryGB}GB -BootDevice VHD -NewVHDPath "C:\\ProgramData\\Microsoft\\Windows\\Hyper-V\\${name}\\${name}.vhdx" -NewVHDSizeBytes ${diskSizeGB}GB -Path "C:\\ProgramData\\Microsoft\\Windows\\Hyper-V\\" -Generation 2 -SwitchName "${switchName}"`
    );

    // Set CPU and Dynamic Memory
    if (dynamicMemory) {
      await execPowerShell(
        `Set-VM -Name "${name}" -ProcessorCount ${cpuCount} -DynamicMemory -MinimumBytes 512MB -MaximumBytes ${memoryGB * 2}GB`
      );
    } else {
      await execPowerShell(
        `Set-VM -Name "${name}" -ProcessorCount ${cpuCount} -StaticMemory`
      );
    }

    // Enable TPM 2.0 (Required for Windows 11)
    if (enableTPM) {
      await execPowerShell(
        `Set-VMKeyProtector -VMName "${name}" -NewLocalKeyProtector -ErrorAction SilentlyContinue`
      );
      await execPowerShell(
        `Enable-VMTPM -VMName "${name}" -ErrorAction SilentlyContinue`
      );
    }

    // Attach ISO if provided
    if (isoPath) {
      await execPowerShell(
        `$vmDVD = Add-VMDvdDrive -VMName "${name}" -Path "${isoPath}" -ErrorAction Stop; Set-VMFirmware -VMName "${name}" -FirstBootDevice $vmDVD`
      );
    }

    // Enable Enhanced Session Mode
    if (enhancedSession) {
      await execPowerShell(
        `Set-VM -Name "${name}" -EnhancedSessionTransportType HvSocket`
      );
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.error || error.message };
  }
});

// ==================== Network Management ====================

// Get all virtual switches
ipcMain.handle("get-switches", async () => {
  try {
    const result = await execPowerShell(
      `Get-VMSwitch | Select-Object Name, SwitchType, NetAdapterInterfaceDescription, AllowManagementOS | ConvertTo-Json -Compress`
    );
    if (!result || result.trim() === "") {
      return [];
    }
    return JSON.parse(result);
  } catch (error) {
    console.error("Error getting switches:", error);
    return [];
  }
});

// Get network adapters for all VMs
ipcMain.handle("get-vm-networks", async () => {
  try {
    const result = await execPowerShell(
      `Get-VM | Get-VMNetworkAdapter | Select-Object VMName, SwitchName, MacAddress, IPAddresses, StaticMacAddress | ConvertTo-Json -Compress`
    );
    if (!result || result.trim() === "") {
      return [];
    }
    return JSON.parse(result);
  } catch (error) {
    return [];
  }
});

// Create NAT Switch
ipcMain.handle("create-nat-switch", async (_, config) => {
  const { name, subnet } = config;

  try {
    // Create internal switch
    await execPowerShell(`New-VMSwitch -Name "${name}" -SwitchType Internal`);

    // Configure NAT network
    const gatewayIP = subnet.split("/")[0];
    const natNetwork = subnet.split("/").slice(0, 3).join(".") + ".0/24";
    const adapterName = `vEthernet (${name})`;

    // Assign IP to the vEthernet adapter
    await execPowerShell(
      `New-NetIPAddress -IPAddress ${gatewayIP} -PrefixLength 24 -InterfaceAlias "${adapterName}"`
    );

    // Create NAT
    await execPowerShell(
      `New-NetNat -Name "${name}" -InternalIPInterfaceAddressPrefix "${natNetwork}"`
    );

    return { success: true };
  } catch (error) {
    return { success: false, error: error.error || error.message };
  }
});

// Create External Switch
ipcMain.handle("create-external-switch", async (_, config) => {
  const { name, adapter } = config;

  try {
    await execPowerShell(
      `New-VMSwitch -Name "${name}" -SwitchType External -NetAdapterName "${adapter}" -AllowManagementOS $true`
    );

    return { success: true };
  } catch (error) {
    return { success: false, error: error.error || error.message };
  }
});

// Get physical network adapters
ipcMain.handle("get-network-adapters", async () => {
  try {
    const result = await execPowerShell(
      `Get-NetAdapter -Physical | Where-Object { $_.Status -eq "Up" } | Select-Object Name, InterfaceDescription, LinkSpeed | ConvertTo-Json -Compress`
    );
    if (!result || result.trim() === "") {
      return [];
    }
    const parsed = JSON.parse(result);
    // Handle case where result is a single object instead of array
    return Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
  } catch (error) {
    return [];
  }
});

// Connect VM to switch
ipcMain.handle("connect-vm-switch", async (_, vmName, switchName) => {
  try {
    await execPowerShell(
      `Connect-VMNetworkAdapter -VMName "${vmName}" -SwitchName "${switchName}"`
    );
    return { success: true };
  } catch (error) {
    return { success: false, error: error.error || error.message };
  }
});

// ==================== Port Forwarding ====================

// Get all NAT port forwarding rules
ipcMain.handle("get-port-rules", async () => {
  try {
    const result = await execPowerShell(
      `Get-NetNatStaticMapping | Select-Object ExternalIPAddress, ExternalPort, Protocol, InternalIPAddress, InternalPort, InternalRoutingDomainName | ConvertTo-Json -Compress`
    );
    if (!result || result.trim() === "") {
      return [];
    }
    return JSON.parse(result);
  } catch (error) {
    return [];
  }
});

// Add port forwarding rule
ipcMain.handle("add-port-rule", async (_, config) => {
  const { externalPort, internalIP, internalPort, protocol } = config;

  try {
    // Find NAT network name
    const natName = await execPowerShell("(Get-NetNat).Name");

    // Create static mapping
    await execPowerShell(
      `New-NetNatStaticMapping -NatName "${natName}" -Protocol ${protocol} -ExternalIPAddress 0.0.0.0 -ExternalPort ${externalPort} -InternalIPAddress ${internalIP} -InternalPort ${internalPort}`
    );

    // Add firewall rule
    await execPowerShell(
      `New-NetFirewallRule -DisplayName "VM NAT Port ${externalPort}" -Direction Inbound -Protocol ${protocol} -LocalPort ${externalPort} -Action Allow`
    );

    return { success: true };
  } catch (error) {
    return { success: false, error: error.error || error.message };
  }
});

// Remove port forwarding rule
ipcMain.handle("remove-port-rule", async (_, externalPort, protocol) => {
  try {
    await execPowerShell(
      `Remove-NetNatStaticMapping -ExternalPort ${externalPort} -Protocol ${protocol} -Confirm:$false`
    );
    return { success: true };
  } catch (error) {
    return { success: false, error: error.error || error.message };
  }
});

// ==================== Remote Connection ====================

// Launch RDP connection
ipcMain.handle("connect-rdp", async (_, ip, username = "") => {
  try {
    let cmd = `mstsc.exe /v:${ip}`;
    if (username) {
      cmd += ` /u:${username}`;
    }

    exec(cmd, (error) => {
      if (error) console.error("RDP error:", error);
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Generate SSH command
ipcMain.handle("get-ssh-command", async (_, ip, username = "root", port = 22) => {
  return `ssh -p ${port} ${username}@${ip}`;
});

// ==================== Host Info ====================

// Get Hyper-V host information
ipcMain.handle("get-host-info", async () => {
  try {
    const result = await execPowerShell(
      `$hostInfo = Get-VMHost; $cpus = Get-WmiObject Win32_Processor; $memory = Get-WmiObject Win32_ComputerSystem; [PSCustomObject]@{ Name = $hostInfo.Name; LogicalProcessors = $cpus.NumberOfLogicalProcessors; Cores = ($cpus.NumberOfCores | Measure-Object -Sum).Sum; MemoryGB = [math]::Round($memory.TotalPhysicalMemory / 1GB, 2); VirtualMachinePath = $hostInfo.VirtualMachinePath; MacAddressRange = $hostInfo.MacAddressRange; EnableEnhancedSessionMode = $hostInfo.EnableEnhancedSessionMode; NumaSpanningEnabled = $hostInfo.NumaSpanningEnabled } | ConvertTo-Json -Compress`
    );
    if (!result || result.trim() === "") {
      return null;
    }
    return JSON.parse(result);
  } catch (error) {
    return null;
  }
});
