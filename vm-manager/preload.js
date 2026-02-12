const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // VM Management
  getVMs: () => ipcRenderer.invoke("get-vms"),
  getVMStats: (vmName) => ipcRenderer.invoke("get-vm-stats", vmName),
  startVM: (name) => ipcRenderer.invoke("start-vm", name),
  stopVM: (name) => ipcRenderer.invoke("stop-vm", name),
  restartVM: (name) => ipcRenderer.invoke("restart-vm", name),
  deleteVM: (name) => ipcRenderer.invoke("delete-vm", name),

  // VM Creation
  getISOs: () => ipcRenderer.invoke("get-isos"),
  getVMPath: () => ipcRenderer.invoke("get-vm-path"),
  createVM: (config) => ipcRenderer.invoke("create-vm", config),

  // Network Management
  getSwitches: () => ipcRenderer.invoke("get-switches"),
  getVMNetworks: () => ipcRenderer.invoke("get-vm-networks"),
  getNetworkAdapters: () => ipcRenderer.invoke("get-network-adapters"),
  createNATSwitch: (config) => ipcRenderer.invoke("create-nat-switch", config),
  createExternalSwitch: (config) => ipcRenderer.invoke("create-external-switch", config),
  connectVMSwitch: (vmName, switchName) => ipcRenderer.invoke("connect-vm-switch", vmName, switchName),

  // Port Forwarding
  getPortRules: () => ipcRenderer.invoke("get-port-rules"),
  addPortRule: (config) => ipcRenderer.invoke("add-port-rule", config),
  removePortRule: (externalPort, protocol) => ipcRenderer.invoke("remove-port-rule", externalPort, protocol),

  // Remote Connection
  connectRDP: (ip, username) => ipcRenderer.invoke("connect-rdp", ip, username),
  getSSHCommand: (ip, username, port) => ipcRenderer.invoke("get-ssh-command", ip, username, port),

  // Host Info
  getHostInfo: () => ipcRenderer.invoke("get-host-info"),

  // Config
  getConfig: () => ipcRenderer.invoke("get-config")
});
