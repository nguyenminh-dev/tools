const { exec } = require("child_process");

function execPowerShell(command) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(command, "utf16le").toString("base64");
    console.log("Encoded length:", encoded.length);
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

async function test() {
  console.log("\n=== Test 1: Simple Get-VM ===");
  try {
    const result = await execPowerShell("Get-VM");
    console.log("Result length:", result.length);
    console.log("First 200 chars:", result.substring(0, 200));
  } catch (error) {
    console.error("Error:", error);
  }

  console.log("\n=== Test 2: Get-VM | ConvertTo-Json -Compress ===");
  try {
    const result = await execPowerShell("Get-VM | ConvertTo-Json -Compress");
    console.log("Result:", result);
    if (result) {
      const parsed = JSON.parse(result);
      console.log("Parsed count:", Array.isArray(parsed) ? parsed.length : 1);
    }
  } catch (error) {
    console.error("Error:", error);
  }

  console.log("\n=== Test 3: Full command from main.js ===");
  try {
    const result = await execPowerShell(
      `$vms = Get-VM; $vms | ForEach-Object { $vm = $_; $stateStr = if ($vm.State -eq 1) { "Running" } elseif ($vm.State -eq 2 -or $vm.State -eq 3) { "Off" } elseif ($vm.State -eq 4) { "Paused" } elseif ($vm.State -eq 5) { "Saved" } elseif ($vm.State -eq 6) { "Starting" } elseif ($vm.State -eq 7) { "Saving" } elseif ($vm.State -eq 8) { "Stopping" } elseif ($vm.State -eq 9) { "Resetting" } elseif ($vm.State -eq 10) { "Pausing" } elseif ($vm.State -eq 11) { "Resuming" } else { "Other" }; $netAdapter = Get-VMNetworkAdapter -VMName $vm.Name -ErrorAction SilentlyContinue | Select-Object -First 1; $ip = ""; if ($netAdapter) { $ip = (Get-VMNetworkAdapter -VMName $vm.Name | Select-Object -ExpandProperty IPAddresses -ErrorAction SilentlyContinue) -join ", " }; $memGB = if ($vm.State -eq 1) { [math]::Round($vm.MemoryAssigned / 1GB, 2) } else { [math]::Round($vm.MemoryStartup / 1GB, 2) }; [PSCustomObject]@{ Name = $vm.Name; State = $stateStr; CPU = $vm.ProcessorCount; MemoryGB = $memGB; Status = $vm.Status; IP = $ip; SwitchName = if ($netAdapter) { $netAdapter.SwitchName } else { "" }; Id = $vm.Id } } | ConvertTo-Json -Compress`
    );
    console.log("Result length:", result.length);
    console.log("Result:", result);
    if (result) {
      const parsed = JSON.parse(result);
      console.log("Parsed count:", Array.isArray(parsed) ? parsed.length : 1);
      if (Array.isArray(parsed)) {
        parsed.forEach(vm => console.log(`  - ${vm.Name}: ${vm.State}`));
      }
    }
  } catch (error) {
    console.error("Error:", error);
  }

  console.log("\n=== Test 4: Shorter version without -Compress ===");
  try {
    const result = await execPowerShell(
      `Get-VM | Select-Object Name, State, ProcessorCount, MemoryStartup | ConvertTo-Json`
    );
    console.log("Result:", result);
    if (result) {
      const parsed = JSON.parse(result);
      console.log("Parsed count:", Array.isArray(parsed) ? parsed.length : 1);
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

test();
