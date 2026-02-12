const { exec } = require("child_process");

function execPowerShell(command) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(command, "utf16le").toString("base64");
    exec(
      `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`,
      { maxBuffer: 1024 * 1024 * 10 },
      (err, stdout, stderr) => {
        if (err) {
          console.error("PowerShell Error:", stderr);
          return reject({ error: err.message, stderr });
        }
        resolve(stdout.trim());
      }
    );
  });
}

async function runTests() {
  console.log("\n" + "=".repeat(50));
  console.log("HYPER-V VM MANAGER - API TEST");
  console.log("=".repeat(50));

  // Test 1: Get VMs
  console.log("\n[1/5] Testing get-vms API...");
  try {
    const result = await execPowerShell(
      `$vms = Get-VM; $vms | ForEach-Object { $vm = $_; $stateStr = if ($vm.State -eq 1) { "Running" } elseif ($vm.State -eq 2 -or $vm.State -eq 3) { "Off" } elseif ($vm.State -eq 4) { "Paused" } elseif ($vm.State -eq 5) { "Saved" } elseif ($vm.State -eq 6) { "Starting" } elseif ($vm.State -eq 7) { "Saving" } elseif ($vm.State -eq 8) { "Stopping" } elseif ($vm.State -eq 9) { "Resetting" } elseif ($vm.State -eq 10) { "Pausing" } elseif ($vm.State -eq 11) { "Resuming" } else { "Other" }; $netAdapter = Get-VMNetworkAdapter -VMName $vm.Name -ErrorAction SilentlyContinue | Select-Object -First 1; $ip = ""; if ($netAdapter) { $ip = (Get-VMNetworkAdapter -VMName $vm.Name | Select-Object -ExpandProperty IPAddresses -ErrorAction SilentlyContinue) -join ", " }; $memGB = if ($vm.State -eq 1) { [math]::Round($vm.MemoryAssigned / 1GB, 2) } else { [math]::Round($vm.MemoryStartup / 1GB, 2) }; [PSCustomObject]@{ Name = $vm.Name; State = $stateStr; CPU = $vm.ProcessorCount; MemoryGB = $memGB; Status = $vm.Status; IP = $ip; SwitchName = if ($netAdapter) { $netAdapter.SwitchName } else { "" }; Id = $vm.Id } } | ConvertTo-Json`
    );
    const vms = JSON.parse(result || "[]");
    console.log(`  ✓ Found ${vms.length} VM(s)`);
    vms.forEach(vm => {
      console.log(`    - ${vm.Name}: ${vm.State}, ${vm.CPU} CPU, ${vm.MemoryGB}GB RAM`);
    });
  } catch (error) {
    console.log(`  ✗ Error: ${error.error || error.message}`);
  }

  // Test 2: Get Switches
  console.log("\n[2/5] Testing get-switches API...");
  try {
    const result = await execPowerShell(`Get-VMSwitch | Select-Object Name, SwitchType, NetAdapterInterfaceDescription, AllowManagementOS | ConvertTo-Json`);
    const switches = JSON.parse(result || "[]");
    console.log(`  ✓ Found ${switches.length} switch(es)`);
    switches.forEach(sw => {
      console.log(`    - ${sw.Name}: ${sw.SwitchType}`);
    });
  } catch (error) {
    console.log(`  ✗ Error: ${error.error || error.message}`);
  }

  // Test 3: Get Network Adapters
  console.log("\n[3/5] Testing get-network-adapters API...");
  try {
    const result = await execPowerShell(`Get-NetAdapter -Physical | Where-Object { $_.Status -eq "Up" } | Select-Object Name, InterfaceDescription, LinkSpeed | ConvertTo-Json`);
    const parsed = JSON.parse(result || "[]");
    const adapters = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
    console.log(`  ✓ Found ${adapters.length} adapter(s)`);
    adapters.forEach(ad => {
      console.log(`    - ${ad.Name}: ${ad.LinkSpeed}`);
    });
  } catch (error) {
    console.log(`  ✗ Error: ${error.error || error.message}`);
  }

  // Test 4: Get VM Host Info
  console.log("\n[4/5] Testing get-host-info API...");
  try {
    const result = await execPowerShell(
      `$hostInfo = Get-VMHost; $cpus = Get-WmiObject Win32_Processor; $memory = Get-WmiObject Win32_ComputerSystem; [PSCustomObject]@{ Name = $hostInfo.Name; LogicalProcessors = $cpus.NumberOfLogicalProcessors; Cores = ($cpus.NumberOfCores | Measure-Object -Sum).Sum; MemoryGB = [math]::Round($memory.TotalPhysicalMemory / 1GB, 2); VirtualMachinePath = $hostInfo.VirtualMachinePath; MacAddressRange = $hostInfo.MacAddressRange; EnableEnhancedSessionMode = $hostInfo.EnableEnhancedSessionMode; NumaSpanningEnabled = $hostInfo.NumaSpanningEnabled } | ConvertTo-Json`
    );
    const hostInfo = JSON.parse(result);
    console.log(`  ✓ Host: ${hostInfo.Name}`);
    console.log(`    - CPUs: ${hostInfo.LogicalProcessors} logical, ${hostInfo.Cores} cores`);
    console.log(`    - Memory: ${hostInfo.MemoryGB}GB`);
    console.log(`    - VM Path: ${hostInfo.VirtualMachinePath}`);
  } catch (error) {
    console.log(`  ✗ Error: ${error.error || error.message}`);
  }

  // Test 5: Get Total Resources
  console.log("\n[5/5] Testing getTotalUsedResources...");
  try {
    const result = await execPowerShell(
      `$vms = Get-VM | Where-Object { $_.State -eq "Running" }; $totalCPU = ($vms | Measure-Object -Property ProcessorCount -Sum).Sum; $totalMem = ($vms | Measure-Object -Property MemoryStartup -Sum).Sum; [PSCustomObject]@{ CPU = if ($totalCPU) { $totalCPU } else { 0 }; MemoryGB = [math]::Round($totalMem / 1GB, 2); RunningCount = $vms.Count; TotalCount = (Get-VM).Count } | ConvertTo-Json`
    );
    const resources = JSON.parse(result);
    console.log(`  ✓ Running: ${resources.RunningCount}/${resources.TotalCount} VMs`);
    console.log(`    - CPU used: ${resources.CPU} cores`);
    console.log(`    - Memory used: ${resources.MemoryGB}GB`);
  } catch (error) {
    console.log(`  ✗ Error: ${error.error || error.message}`);
  }

  console.log("\n" + "=".repeat(50));
  console.log("TEST COMPLETE");
  console.log("=".repeat(50));
}

runTests();
